import type { WorkstationToolName } from '@runloop/reflex-workstation';

/**
 * Client-side permission tiers for connect mode. The machine's owner is the
 * policy authority: read tools are always allowed inside the tool root,
 * while exec (`run_command`) and write (`write_file`) are allowed by default
 * and can be gated behind per-call interactive approval (`--ask`, optionally
 * re-allowing one category via `--allow-exec`/`--allow-write`) or shut off
 * (`--read-only`).
 */

export type ToolCategory = 'read' | 'write' | 'exec';
export type CategoryPolicy = 'allow' | 'ask' | 'deny';

export interface ToolPolicy {
  exec: CategoryPolicy;
  write: CategoryPolicy;
}

export type ApprovalDecision = 'allow-once' | 'allow-session' | 'deny';

export interface GateResult {
  allowed: boolean;
  /** Owner-facing reason relayed verbatim to the agent when denied. */
  reason?: string;
}

export interface GateInput {
  callId: string;
  tool: WorkstationToolName;
  summary: string;
  agentId?: string;
  /** Cancels an approval when its connection/call is no longer live. */
  signal?: AbortSignal;
}

export interface PendingApproval extends Omit<GateInput, 'signal'> {
  category: Exclude<ToolCategory, 'read'>;
}

export function toolCategory(tool: WorkstationToolName): ToolCategory {
  switch (tool) {
    case 'run_command':
      return 'exec';
    case 'write_file':
      return 'write';
    default:
      return 'read';
  }
}

export function describePolicy(policy: ToolPolicy): string {
  return `exec: ${policy.exec} · write: ${policy.write}`;
}

/** Unanswered approvals deny after this long so agents are never stuck forever. */
export const APPROVAL_TIMEOUT_MS = 5 * 60_000;

const DENIED_BY_OWNER = 'denied by the workstation owner';

interface QueueEntry {
  pending: PendingApproval;
  resolve: (result: GateResult) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
}

type PendingListener = (pending: PendingApproval | null) => void;

/**
 * Gates exec/write calls behind the policy, surfacing `ask` calls one at a
 * time to whichever UI is subscribed. `allow-session` upgrades the whole
 * category for the rest of the process, which also drains any queued calls
 * of that category.
 */
export class ToolApprover {
  private readonly queue: QueueEntry[] = [];
  private readonly listeners = new Set<PendingListener>();

  constructor(
    private policy: ToolPolicy,
    private readonly options: { interactive: boolean; timeoutMs?: number } = { interactive: true },
  ) {}

  getPolicy(): Readonly<ToolPolicy> {
    return this.policy;
  }

  current(): PendingApproval | null {
    return this.queue[0]?.pending ?? null;
  }

  /** Subscribe to head-of-queue changes; fires immediately with the current head. */
  subscribe(listener: PendingListener): () => void {
    this.listeners.add(listener);
    listener(this.current());
    return () => this.listeners.delete(listener);
  }

  async gate(input: GateInput): Promise<GateResult> {
    const category = toolCategory(input.tool);
    if (category === 'read') return { allowed: true };
    const policy = this.policy[category];
    if (policy === 'allow') return { allowed: true };
    if (policy === 'deny') {
      return {
        allowed: false,
        reason: `${category} tools are disabled by this workstation's policy (owner ran with --read-only)`,
      };
    }
    if (!this.options.interactive) {
      return {
        allowed: false,
        reason:
          `${category} tools require interactive approval and this workstation cannot prompt — ` +
          `ask the owner to re-run \`reflex-cli connect\` without --ask (or with --allow-${category})`,
      };
    }
    if (input.signal?.aborted) {
      return { allowed: false, reason: 'workstation call cancelled' };
    }

    return new Promise<GateResult>((resolve) => {
      const { signal, ...pending } = input;
      const entry: QueueEntry = {
        pending: { ...pending, category },
        resolve,
        timer: setTimeout(
          () => this.settle(entry, { allowed: false, reason: 'approval timed out' }),
          this.options.timeoutMs ?? APPROVAL_TIMEOUT_MS,
        ),
        signal,
      };
      entry.onAbort = () =>
        this.settle(entry, { allowed: false, reason: 'workstation call cancelled' });
      signal?.addEventListener('abort', entry.onAbort, { once: true });
      entry.timer.unref?.();
      this.queue.push(entry);
      if (this.queue.length === 1) this.notify();
    });
  }

  /** Apply the owner's decision to the current (head) approval. */
  resolveCurrent(decision: ApprovalDecision): void {
    const entry = this.queue[0];
    if (!entry) return;
    if (decision === 'allow-session') {
      this.policy = { ...this.policy, [entry.pending.category]: 'allow' };
    }
    this.settle(
      entry,
      decision === 'deny' ? { allowed: false, reason: DENIED_BY_OWNER } : { allowed: true },
    );
  }

  private settle(entry: QueueEntry, result: GateResult): void {
    const index = this.queue.indexOf(entry);
    if (index === -1) return;
    this.queue.splice(index, 1);
    clearTimeout(entry.timer);
    if (entry.onAbort) entry.signal?.removeEventListener('abort', entry.onAbort);
    entry.resolve(result);
    // A session-wide allow may have unblocked queued calls of that category.
    while (this.queue.length > 0 && this.policy[this.queue[0]!.pending.category] === 'allow') {
      const next = this.queue.shift()!;
      clearTimeout(next.timer);
      next.resolve({ allowed: true });
    }
    this.notify();
  }

  private notify(): void {
    const head = this.current();
    for (const listener of this.listeners) listener(head);
  }
}
