import type { ReflexStreamEvent } from '@runloop/reflex-client';
import {
  AskUserQuestionDetailSchema,
  normalizeAgentRunReferences,
  parseFileEnvelopes,
  type AskUserQuestionItem,
} from '@runloop/reflex-contract';
import type { FileChange } from './format.js';

/**
 * Live transcript engine for the TUI chat screen.
 *
 * This is the terminal counterpart of the web chat's event backbone
 * (`plugins/plugin-chat` `useSDKStream` + `claude-handler` +
 * `timeline-helpers`): the same event classification (`turn.claude.*` prefix
 * stripping, user-prompt detection, lifecycle labels) and the same turn-block
 * semantics (streaming deltas, tool status transitions with sticky cancel,
 * TodoWrite plans, AskUserQuestion / permission control requests), reduced to
 * a flat item list that a terminal can render top to bottom. Framework-free
 * like `@reflex/shared`'s `buildAgentTranscript`, but live: it tracks
 * in-flight state (streaming text, running tools, unanswered questions)
 * instead of projecting a finished run.
 *
 * Items carry a `final` flag that never unsets. The UI renders the longest
 * final prefix through Ink's `<Static>` (printed once, scrolls away like
 * normal terminal output) and re-renders only the live tail — the same
 * static-transcript / live-tail split Claude Code's own TUI uses.
 */

// --- Items ---

export type ToolStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface UserItem {
  kind: 'user';
  id: string;
  final: boolean;
  text: string;
  /** Display names of attached files (content is inlined for the agent). */
  attachments: string[];
}

export interface TextItem {
  kind: 'text';
  id: string;
  final: boolean;
  text: string;
}

export interface ThinkingItem {
  kind: 'thinking';
  id: string;
  final: boolean;
  text: string;
  /** Seconds spent thinking; null while active or when untimed. */
  durationSecs: number | null;
}

export interface ToolItem {
  kind: 'tool';
  id: string;
  final: boolean;
  toolCallId: string;
  name: string;
  input: Record<string, unknown> | null;
  status: ToolStatus;
  output: string | null;
  startedAt: number;
  durationSecs: number | null;
  /** Set while the call runs as a background task (keeps it live past turn end). */
  backgroundTaskId: string | null;
  /**
   * What a `Write` call did on disk, from its result. Null until the result
   * arrives, and for every other tool. See {@link FileChange}.
   */
  fileChange: FileChange | null;
}

export interface PlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanItem {
  kind: 'plan';
  id: string;
  final: boolean;
  entries: PlanEntry[];
}

export type QuestionOutcomeStatus = 'answered' | 'skipped' | 'dismissed' | 'expired';

export interface QuestionItem {
  kind: 'question';
  id: string;
  final: boolean;
  requestId: string;
  toolUseId: string | null;
  questions: AskUserQuestionItem[];
  outcome: { status: QuestionOutcomeStatus; answers: Record<string, string> } | null;
}

export type PermissionDecision =
  | 'allowed'
  | 'allowed-always'
  | 'denied'
  | 'interrupted'
  | 'expired';

export interface PermissionItem {
  kind: 'permission';
  id: string;
  final: boolean;
  requestId: string;
  toolUseId: string | null;
  toolName: string | null;
  input: Record<string, unknown> | null;
  decision: PermissionDecision | null;
}

export interface InitItem {
  kind: 'init';
  id: string;
  final: boolean;
  model: string | null;
  version: string | null;
  cwd: string | null;
  permissionMode: string | null;
  toolCount: number;
}

export interface SetupStep {
  id: string;
  label: string;
  status: 'running' | 'done' | 'failed';
}

export interface SetupItem {
  kind: 'setup';
  id: string;
  final: boolean;
  steps: SetupStep[];
  startedAt: number;
  completedAt: number | null;
}

export type BannerTone = 'info' | 'success' | 'warn' | 'error';

export interface BannerItem {
  kind: 'banner';
  id: string;
  final: boolean;
  tone: BannerTone;
  label: string;
  detail: string | null;
}

/** A muted broker stdout/stderr line. */
export interface LogItem {
  kind: 'log';
  id: string;
  final: boolean;
  text: string;
}

/** Rendered only for abnormal turn ends (error / user cancel). */
export interface TurnEndItem {
  kind: 'turn-end';
  id: string;
  final: boolean;
  cancelled: boolean;
  isError: boolean;
  detail: string | null;
}

export type TranscriptItem =
  | UserItem
  | TextItem
  | ThinkingItem
  | ToolItem
  | PlanItem
  | QuestionItem
  | PermissionItem
  | InitItem
  | SetupItem
  | BannerItem
  | LogItem
  | TurnEndItem;

/** The first unresolved interaction blocks the composer and gets a prompt UI. */
export type PendingInteraction = QuestionItem | PermissionItem;

// --- Pending sends (optimistic outbound messages) ---

/**
 * Status of a message the user sent that the stream has not echoed back yet.
 * Direct port of the web chat's `PendingUserMessage` machine
 * (`web/src/components/agent/pending-messages.ts`):
 *
 * - `sending` — POSTed (or about to be); waiting for the stream echo.
 * - `unconfirmed` — the HTTP send was acknowledged but no echo arrived
 *   within the timeout. Probably delivered; soft warning.
 * - `failed` — the HTTP send failed or was never acknowledged. Stays until
 *   the user retries or dismisses.
 *
 * The echoed `query` / `session/prompt` event is the only thing that creates
 * a real transcript item — a pending send is a separate strip below the
 * transcript, so a fast echo can never race the optimistic copy into a
 * duplicate.
 */
export type PendingSendStatus = 'sending' | 'unconfirmed' | 'failed';

export interface PendingSend {
  clientId: string;
  text: string;
  /** Display names of the attachments included in the send. */
  attachments: string[];
  createdAt: number;
  status: PendingSendStatus;
  /** Server returned 2xx for the send POST. */
  httpAcked: boolean;
  error: string | null;
}

/** Web-parity echo deadline: how long a send may wait for its stream echo. */
export const SEND_ECHO_TIMEOUT_MS = 20_000;

// --- Pull requests the agent opened ---

export type PrStatus = 'open' | 'merged' | 'closed' | 'checks-failed';

/** A PR surfaced on the stream (`agent.pr_*`), for the open-link palette. */
export interface PrLink {
  url: string;
  number: number;
  title: string;
  repo: string;
  status: PrStatus;
}

// --- Event classification (mirrors the web's timeline-helpers) ---

const CLAUDE_PROTOCOL_TYPES = new Set([
  'system',
  'user',
  'assistant',
  'result',
  'stream_event',
  'control_request',
  'control_response',
]);

const ACP_UPDATE_TYPES = new Set([
  'session/update',
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
]);

/** Lifecycle event → banner label, ported from the web chat. */
const LIFECYCLE_BANNERS: Record<string, { label: string; tone: BannerTone }> = {
  'agent.complete': { label: 'Agent complete', tone: 'success' },
  // agent.interrupted is intentionally absent: the cancelled turn-end item
  // already renders "⊘ Interrupted"; a banner would print it twice.
  'agent.stopped': { label: 'Agent stopped', tone: 'warn' },
  'agent.killed': { label: 'Agent killed', tone: 'error' },
  'agent.error': { label: 'Agent error', tone: 'error' },
  'devbox.running': { label: 'Devbox running', tone: 'info' },
  'devbox.suspended': { label: 'Devbox suspended', tone: 'warn' },
  'devbox.shutdown': { label: 'Devbox shutdown', tone: 'warn' },
  'devbox.failed': { label: 'Devbox failed', tone: 'error' },
  'agent.source.flow': { label: 'Started from automation', tone: 'info' },
  'agent.flow_result': { label: 'Returned to automation', tone: 'info' },
  'agent.daemon_started': { label: 'Daemon started', tone: 'info' },
  'agent.performance_warning': { label: 'Performance warning', tone: 'warn' },
  'agent.credentials_refreshed': { label: 'Claude credentials refreshed', tone: 'info' },
  'agent.credentials_refresh_failed': {
    label: 'Claude credentials expired, reconnect your subscription',
    tone: 'error',
  },
  'agent.pr_created': { label: 'Pull request opened', tone: 'info' },
  'agent.pr_merged': { label: 'Pull request merged', tone: 'success' },
  'agent.pr_closed': { label: 'Pull request closed', tone: 'warn' },
  'agent.pr_checks_failed': { label: 'Checks failed', tone: 'error' },
  'agent.pr_review': { label: 'Pull request review', tone: 'info' },
};

/** Max characters of tool output kept per item (rendering clips further). */
const MAX_TOOL_OUTPUT_CHARS = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** Payloads can arrive as JSON strings across SSE/REST boundaries. */
export function parsePayload(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) return parsed;
    } catch {
      // not valid JSON — fall through
    }
  }
  return {};
}

/** Strip the `turn.claude.` wrapper the runner adds around protocol events. */
export function innerType(type: string): string {
  return type.startsWith('turn.claude.') ? type.slice('turn.claude.'.length) : type;
}

function truncate(text: string, max = MAX_TOOL_OUTPUT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
}

/** Join the `text` field of every text-typed block in a content array. */
function joinTextBlocks(content: unknown[]): string {
  return content
    .filter((b): b is Record<string, unknown> => isRecord(b) && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

function joinUserTextBlocks(payload: Record<string, unknown>): string {
  const message = payload.message;
  if (typeof message === 'string') return message;
  if (isRecord(message)) {
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return joinTextBlocks(content);
  }
  const prompt = payload.prompt;
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) return joinTextBlocks(prompt);
  if (typeof payload.text === 'string') return payload.text;
  return '';
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return joinTextBlocks(content);
  return '';
}

const CREATED_RESULT_TEXT = /^File created successfully at:/;

/** Lines in a file's contents, ignoring the empty line a trailing newline leaves behind. */
function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.replace(/\n$/, '').split('\n').length;
}

/** Added/removed lines counted off a `structuredPatch` hunk list, when the result carries one. */
function countPatchLines(patch: unknown): { added: number; removed: number } | null {
  if (!Array.isArray(patch)) return null;
  let added = 0;
  let removed = 0;
  for (const hunk of patch) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) return null;
    for (const line of hunk.lines) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) added++;
      else if (line.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

/**
 * What a completed `Write` call changed, from its result rather than its input.
 *
 * A create is the whole file added. An update is whatever its `structuredPatch`
 * says, and `'unknown'` when the result reports an update without one: the row
 * would otherwise present the entire file as new lines. Results that say
 * neither are unknown too, since assuming "new file" is exactly the wrong
 * guess for a file that already existed.
 */
function parseWriteChange(
  input: Record<string, unknown> | null,
  toolUseResult: Record<string, unknown> | null,
  outputText: string,
): FileChange {
  // One `tool_use_result` accompanies the whole message, so it only speaks for
  // this call when its file path agrees (or when it names no path at all).
  const filePath = toolUseResult?.filePath;
  const result =
    typeof filePath === 'string' && filePath !== input?.file_path ? null : toolUseResult;
  const written = [input?.content, input?.contents, result?.content].find(
    (value): value is string => typeof value === 'string',
  );
  const created = (): FileChange =>
    written === undefined
      ? 'unknown'
      : { operation: 'create', added: countLines(written), removed: 0 };

  const type = result?.type;
  if (type === 'create') return created();
  if (type === 'update') {
    const counts = countPatchLines(result?.structuredPatch);
    return counts ? { operation: 'update', ...counts } : 'unknown';
  }

  // Without a structured result, only the "created" text is specific enough to
  // count: an update says nothing about what the file held, and a result that
  // says neither could be either.
  return CREATED_RESULT_TEXT.test(outputText) ? created() : 'unknown';
}

/** Whether the event is an echoed user prompt (starts a turn). */
export function isUserPromptEvent(
  event: ReflexStreamEvent,
  type: string,
  payload: Record<string, unknown>,
): boolean {
  if (type === 'query') return true;
  if (type === 'session/prompt') return event.origin === 'USER_EVENT';
  if (type === 'message') return payload.role === 'user';
  return false;
}

function durationSecs(start: number, end: number): number {
  return Math.round(Math.max(0, end - start) / 100) / 10;
}

/** Coerce an answers map (values may be arrays for multi-select) to strings. */
function normalizeAnswers(input: Record<string, unknown>): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const [question, value] of Object.entries(input)) {
    if (typeof value === 'string') answers[question] = value;
    else if (Array.isArray(value)) answers[question] = value.map((v) => String(v)).join(', ');
    else if (value != null) answers[question] = JSON.stringify(value);
  }
  return answers;
}

// --- Engine ---

export class TranscriptEngine {
  private items: TranscriptItem[] = [];
  private listeners = new Set<() => void>();
  private seenEventIds = new Set<string>();
  private nextId = 0;

  /** Longest prefix of final items; monotonic so `<Static>` never re-prints. */
  private stableCount = 0;
  private working = false;
  /** Local receive time of the working flip, for the elapsed spinner. */
  private workingSinceMs: number | null = null;
  /** User interrupted the current turn (`agent.interrupted` seen). */
  private interrupted = false;
  /**
   * The current turn already ended. Claude turns end twice on this stream
   * (protocol `result`, then the runner's `turn.completed` — or `turn.failed`
   * after an error result), so `endTurn` is a no-op until new turn activity
   * clears the flag.
   */
  private turnEnded = false;
  /** Any text/thinking/tool content since the turn started (result fallback). */
  private turnHasContent = false;
  /** Merged TodoWrite entries across the session. */
  private planEntries: PlanEntry[] = [];
  /** Accumulating TodoWrite input while it streams. */
  private streamingTodoJson: string | null = null;
  /** Outbound messages awaiting their stream echo (or a failure verdict). */
  private pendingSends: PendingSend[] = [];
  /** PRs the agent opened, newest last; status tracks later pr_* events. */
  private prLinks: PrLink[] = [];
  private setupItem: SetupItem | null = null;
  private setupSawProtocolEvent = false;

  // --- Subscription ---

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.recomputeStable();
    for (const listener of this.listeners) listener();
  }

  // --- Reads ---

  getItems(): readonly TranscriptItem[] {
    return this.items;
  }

  /** Count of leading items that are final (safe to print permanently). */
  getStableCount(): number {
    return this.stableCount;
  }

  isWorking(): boolean {
    return this.working;
  }

  getWorkingSinceMs(): number | null {
    return this.workingSinceMs;
  }

  /** Oldest unresolved question/permission, if any. */
  getPendingInteraction(): PendingInteraction | null {
    for (const item of this.items) {
      if ((item.kind === 'question' || item.kind === 'permission') && !item.final) return item;
    }
    return null;
  }

  private recomputeStable(): void {
    let count = this.stableCount;
    while (count < this.items.length && this.items[count].final) count++;
    this.stableCount = count;
  }

  getPendingSends(): readonly PendingSend[] {
    return this.pendingSends;
  }

  /** PRs seen on this stream, for the ctrl+o open palette. */
  getPrLinks(): readonly PrLink[] {
    return this.prLinks;
  }

  /** Whether any user prompt has been echoed on the stream yet. */
  hasUserMessage(): boolean {
    return this.items.some((i) => i.kind === 'user');
  }

  // --- Local actions (the UI performs the API call; the engine records it) ---

  /**
   * Register an outbound message BEFORE the send POST goes out, so the echo
   * can reconcile it no matter which of the HTTP response or the WebSocket
   * echo arrives first.
   */
  addPendingSend(clientId: string, text: string, attachments: string[] = []): void {
    this.pendingSends.push({
      clientId,
      text,
      attachments,
      createdAt: Date.now(),
      status: 'sending',
      httpAcked: false,
      error: null,
    });
    this.notify();
  }

  /** The send POST returned 2xx (the echo may still be in flight). */
  markPendingHttpAcked(clientId: string): void {
    const pending = this.pendingSends.find((p) => p.clientId === clientId);
    if (!pending) return;
    pending.httpAcked = true;
    this.notify();
  }

  /** The send POST failed — surface the error until retried or dismissed. */
  markPendingFailed(clientId: string, error: string): void {
    const pending = this.pendingSends.find((p) => p.clientId === clientId);
    if (!pending) return;
    pending.status = 'failed';
    pending.error = error;
    this.notify();
  }

  /**
   * Reset a failed/unconfirmed entry to `sending` for a retry and return it
   * so the caller can re-POST. Returns null when the entry is gone.
   */
  resetPendingForRetry(clientId: string): PendingSend | null {
    const pending = this.pendingSends.find((p) => p.clientId === clientId);
    if (!pending) return null;
    pending.status = 'sending';
    pending.httpAcked = false;
    pending.error = null;
    pending.createdAt = Date.now();
    this.notify();
    return pending;
  }

  /** Drop failed/unconfirmed entries the user chose not to retry. */
  dismissPendingSend(clientId: string): void {
    const before = this.pendingSends.length;
    this.pendingSends = this.pendingSends.filter((p) => p.clientId !== clientId);
    if (this.pendingSends.length !== before) this.notify();
  }

  /**
   * Transition stale `sending` entries once their echo deadline passes:
   * HTTP-acked → `unconfirmed` (probably delivered), otherwise `failed`.
   * Same watchdog the web runs. Returns true when anything changed.
   */
  timeoutStalePendingSends(timeoutMs = SEND_ECHO_TIMEOUT_MS, now = Date.now()): boolean {
    let changed = false;
    for (const pending of this.pendingSends) {
      if (pending.status !== 'sending') continue;
      if (now - pending.createdAt < timeoutMs) continue;
      pending.status = pending.httpAcked ? 'unconfirmed' : 'failed';
      pending.error = pending.httpAcked
        ? 'Sent, but the agent stream has not confirmed delivery yet.'
        : 'No response from the server. The message was not delivered.';
      changed = true;
    }
    if (changed) this.notify();
    return changed;
  }

  /**
   * Drop the pending entry matching an echoed user prompt. Mirrors the web's
   * `reconcilePending`: content-equal on the trimmed text after collapsing
   * agent-run references (the server expands `@[title](agent-run:id)` markers
   * before echoing). Oldest-first so identical back-to-back messages resolve
   * in send order; `failed` entries stay until retried or dismissed, but a
   * late echo resolves an `unconfirmed` one.
   */
  private reconcilePendingSends(echoedText: string): void {
    const target = normalizeAgentRunReferences(echoedText).trim();
    for (let i = 0; i < this.pendingSends.length; i++) {
      const pending = this.pendingSends[i];
      if (pending.status === 'failed') continue;
      if (normalizeAgentRunReferences(pending.text).trim() === target) {
        this.pendingSends.splice(i, 1);
        return;
      }
    }
  }

  /** Record the user's answer to an AskUserQuestion after the POST succeeds. */
  resolveQuestionLocally(
    requestId: string,
    status: Exclude<QuestionOutcomeStatus, 'expired'>,
    answers: Record<string, string>,
  ): void {
    const item = this.items.find(
      (i): i is QuestionItem => i.kind === 'question' && i.requestId === requestId,
    );
    if (!item || item.final) return;
    item.outcome = { status, answers };
    item.final = true;
    this.notify();
  }

  /** Record the user's permission decision after the POST succeeds. */
  resolvePermissionLocally(requestId: string, decision: PermissionDecision): void {
    const item = this.items.find(
      (i): i is PermissionItem => i.kind === 'permission' && i.requestId === requestId,
    );
    if (!item || item.final) return;
    item.decision = decision;
    item.final = true;
    this.notify();
  }

  // --- Event intake ---

  handleEvent(event: ReflexStreamEvent): void {
    // Re-subscribing replays stream history; every event is processed once.
    if (this.seenEventIds.has(event.id)) return;
    this.seenEventIds.add(event.id);

    const type = innerType(event.type);
    const payload = parsePayload(event.payload);
    const ts = event.timestamp;

    if (event.type === 'agent.setup') {
      this.handleSetupEvent(payload, ts);
      this.notify();
      return;
    }
    this.markSetupCompleteOnProtocolEvent(event, ts);

    if (isUserPromptEvent(event, type, payload)) {
      this.handleUserPrompt(payload);
      this.notify();
      return;
    }

    // Generic agent-role `message` events (simple custom agents).
    if (type === 'message' && typeof payload.message === 'string') {
      this.finalizeStreamingTail(ts);
      this.turnHasContent = true;
      this.push({ kind: 'text', id: this.id('text'), final: true, text: payload.message });
      this.notify();
      return;
    }

    if (CLAUDE_PROTOCOL_TYPES.has(type)) {
      this.handleClaudeEvent(type, payload, ts, event.origin);
    } else if (type === 'session/cancel') {
      this.markInterrupted(ts);
    } else if (ACP_UPDATE_TYPES.has(type)) {
      this.handleAcpEvent(type, payload, ts);
    } else {
      this.handleSystemEvent(event.type, payload, ts);
    }
    this.notify();
  }

  // --- Setup progress (agent.setup fold) ---

  private handleSetupEvent(payload: Record<string, unknown>, ts: number): void {
    const step = typeof payload.step === 'string' ? payload.step : null;
    if (!step) return;
    if (!this.setupItem) {
      this.setupItem = {
        kind: 'setup',
        id: this.id('setup'),
        final: false,
        steps: [],
        startedAt: ts,
        completedAt: null,
      };
      this.push(this.setupItem);
    }
    if (this.setupItem.final) return;

    const detail = typeof payload.detail === 'string' ? payload.detail : null;

    // `init` / `init.append` announce the expected steps ([{id,label}] JSON).
    if (step === 'init' || step === 'init.append') {
      for (const expected of parseInitSteps(detail)) {
        if (!this.setupItem.steps.some((s) => s.id === expected.id)) {
          this.setupItem.steps.push({ id: expected.id, label: expected.label, status: 'running' });
        }
      }
      return;
    }

    let entry = this.setupItem.steps.find((s) => s.id === step);
    if (!entry) {
      entry = { id: step, label: step.replace(/_/g, ' '), status: 'running' };
      this.setupItem.steps.push(entry);
    }
    // `terminal` absent means terminal; only an explicit false keeps it running.
    if (payload.terminal === false) entry.status = 'running';
    else entry.status = detail?.startsWith('failed:') ? 'failed' : 'done';
  }

  /**
   * Setup is complete when the first real protocol event arrives — not when
   * the devbox is up (the broker still has to launch the agent). Same rule as
   * the web chat.
   */
  private markSetupCompleteOnProtocolEvent(event: ReflexStreamEvent, ts: number): void {
    if (this.setupSawProtocolEvent || !this.setupItem) return;
    if (event.type.startsWith('devbox.') || event.type.startsWith('broker.')) return;
    if (event.type === 'agent.error') {
      const payload = parsePayload(event.payload);
      if (payload.errorType === 'stderr') return;
    }
    if (event.type === 'agent.log') return;
    this.setupSawProtocolEvent = true;
    this.setupItem.completedAt = ts;
    for (const step of this.setupItem.steps) {
      if (step.status === 'running') step.status = 'done';
    }
    this.setupItem.final = true;
  }

  // --- User prompts ---

  private handleUserPrompt(payload: Record<string, unknown>): void {
    const raw = joinUserTextBlocks(payload);
    const { cleanedText, files } = parseFileEnvelopes(raw);
    if (!cleanedText && files.length === 0) return;

    // The echoed event is the single source of truth for the transcript item;
    // it also resolves the optimistic pending-send bubble, if one matches.
    this.reconcilePendingSends(cleanedText);

    this.finalizeStreamingTail(null);
    this.push({
      kind: 'user',
      id: this.id('user'),
      final: true,
      text: cleanedText,
      attachments: files.map((f) => f.name),
    });
    this.interrupted = false;
    this.setWorking(true);
  }

  // --- Claude protocol ---

  private handleClaudeEvent(
    type: string,
    payload: Record<string, unknown>,
    ts: number,
    origin: string | undefined,
  ): void {
    switch (type) {
      case 'assistant':
        this.handleAssistantMessage(payload, ts);
        break;
      case 'user':
        this.handleToolResults(payload, ts);
        break;
      case 'result':
        this.handleResult(payload, ts);
        break;
      case 'system':
        this.handleClaudeSystem(payload, ts);
        break;
      case 'control_request':
        this.handleControlRequest(payload, origin);
        break;
      case 'control_response':
        this.handleControlResponse(payload);
        break;
      case 'stream_event': {
        const inner = isRecord(payload.event) ? payload.event : null;
        if (inner) this.handleStreamEvent(inner, ts);
        break;
      }
    }
  }

  private handleAssistantMessage(payload: Record<string, unknown>, ts: number): void {
    const message = payload.message;
    const content = (isRecord(message) ? message.content : undefined) ?? payload.content;
    if (!Array.isArray(content)) return;

    this.setWorking(true);
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        this.absorbText(block.text, ts);
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        this.absorbThinking(block.thinking, ts);
      } else if (block.type === 'tool_use') {
        this.finalizeStreamingTail(ts);
        const name = typeof block.name === 'string' ? block.name : 'unknown';
        if (name === 'TodoWrite') {
          this.applyTodoWrite(isRecord(block.input) ? block.input : {});
          continue;
        }
        this.absorbToolUse(
          typeof block.id === 'string' ? block.id : '',
          name,
          isRecord(block.input) ? block.input : null,
          ts,
        );
      }
    }
  }

  /**
   * The bridge can stream partial chunks (`stream_event`) *and* publish the
   * full assistant message. Absorb the full block into an open streaming item
   * when one exists so the transcript never shows the text twice.
   */
  private absorbText(text: string, ts: number): void {
    const last = this.items[this.items.length - 1];
    if (last?.kind === 'text' && !last.final) {
      last.text = text;
      last.final = true;
      return;
    }
    this.finalizeStreamingTail(ts);
    if (!text.trim()) return;
    this.turnHasContent = true;
    this.push({ kind: 'text', id: this.id('text'), final: true, text });
  }

  private absorbThinking(text: string, ts: number): void {
    const last = this.items[this.items.length - 1];
    if (last?.kind === 'thinking' && !last.final) {
      last.text = text;
      last.final = true;
      const start = thinkingStarts.get(last);
      if (start !== undefined) last.durationSecs = durationSecs(start, ts);
      return;
    }
    this.finalizeStreamingTail(ts);
    if (!text.trim()) return;
    this.turnHasContent = true;
    this.push({
      kind: 'thinking',
      id: this.id('think'),
      final: true,
      text,
      durationSecs: null,
    });
  }

  private absorbToolUse(
    toolCallId: string,
    name: string,
    input: Record<string, unknown> | null,
    ts: number,
  ): void {
    const existing = this.items.find(
      (i): i is ToolItem => i.kind === 'tool' && i.toolCallId === toolCallId && toolCallId !== '',
    );
    if (existing) {
      // Streamed via content_block_start earlier — fill in the full input.
      if (!existing.final) {
        if (input) existing.input = input;
        if (existing.status === 'pending') existing.status = 'running';
      }
      return;
    }
    this.turnHasContent = true;
    this.push({
      kind: 'tool',
      id: this.id('tool'),
      final: false,
      toolCallId,
      name,
      input,
      status: 'running',
      output: null,
      startedAt: ts,
      durationSecs: null,
      backgroundTaskId: null,
      fileChange: null,
    });
  }

  private handleToolResults(payload: Record<string, unknown>, ts: number): void {
    const message = payload.message;
    const content = (isRecord(message) ? message.content : undefined) ?? payload.content;
    if (!Array.isArray(content)) return;

    const toolUseResult = isRecord(payload.tool_use_result) ? payload.tool_use_result : null;
    const backgroundTaskId =
      toolUseResult && typeof toolUseResult.backgroundTaskId === 'string'
        ? toolUseResult.backgroundTaskId
        : null;

    for (const block of content) {
      if (!isRecord(block) || block.type !== 'tool_result') continue;
      const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
      if (!toolUseId) continue;
      const item = this.items.find(
        (i): i is ToolItem => i.kind === 'tool' && i.toolCallId === toolUseId,
      );
      if (!item || item.final) continue;
      // Sticky cancel: the synthetic rejection result after an interrupt must
      // not flip an already-cancelled tool to "failed".
      if (item.status === 'cancelled') {
        item.final = true;
        continue;
      }
      const outputText = toolResultText(block.content);
      if (outputText) item.output = truncate(outputText);
      const isError = block.is_error === true;
      if (backgroundTaskId && !isError) {
        // Still running in the background; task_* events finish it later.
        item.status = 'running';
        item.backgroundTaskId = backgroundTaskId;
        continue;
      }
      item.status = isError ? 'failed' : 'completed';
      if (!isError && item.name === 'Write') {
        item.fileChange = parseWriteChange(item.input, toolUseResult, outputText);
      }
      item.durationSecs = durationSecs(item.startedAt, ts);
      item.final = true;
    }
  }

  private handleResult(payload: Record<string, unknown>, ts: number): void {
    // The result text usually echoes the streamed message; surface it only
    // when nothing streamed this turn (e.g. "Unknown command: /foo").
    const resultText = typeof payload.result === 'string' ? payload.result : null;
    if (resultText && !this.turnHasContent && !payload.is_error) {
      this.push({ kind: 'text', id: this.id('text'), final: true, text: resultText });
    }

    if (this.hasPendingBackgroundTasks() && payload.is_error !== true) {
      // Keep the turn live until the background task completes (web parity).
      return;
    }

    const cancelled = this.interrupted;
    const isError = !cancelled && payload.is_error === true;
    this.endTurn(ts, {
      cancelled,
      isError,
      detail: isError
        ? (resultText ?? (typeof payload.subtype === 'string' ? payload.subtype : null))
        : null,
    });
  }

  private handleClaudeSystem(payload: Record<string, unknown>, ts: number): void {
    const subtype = payload.subtype;
    if (subtype === 'init') {
      this.push({
        kind: 'init',
        id: this.id('init'),
        final: true,
        model: typeof payload.model === 'string' ? payload.model : null,
        version:
          typeof payload.claude_code_version === 'string' ? payload.claude_code_version : null,
        cwd: typeof payload.cwd === 'string' ? payload.cwd : null,
        permissionMode: typeof payload.permissionMode === 'string' ? payload.permissionMode : null,
        toolCount: Array.isArray(payload.tools) ? payload.tools.length : 0,
      });
      return;
    }

    if (subtype === 'task_started') {
      const taskId = typeof payload.task_id === 'string' ? payload.task_id : null;
      const toolUseId = typeof payload.tool_use_id === 'string' ? payload.tool_use_id : null;
      if (!taskId || !toolUseId) return;
      const item = this.items.find(
        (i): i is ToolItem => i.kind === 'tool' && i.toolCallId === toolUseId,
      );
      if (item && !item.final) {
        item.backgroundTaskId = taskId;
        item.status = 'running';
      }
      return;
    }

    if (
      subtype === 'task_completed' ||
      subtype === 'task_notification' ||
      subtype === 'task_updated'
    ) {
      const taskId = typeof payload.task_id === 'string' ? payload.task_id : null;
      if (!taskId) return;
      const patch = isRecord(payload.patch) ? payload.patch : null;
      const status =
        (patch && typeof patch.status === 'string' ? patch.status : null) ??
        (typeof payload.status === 'string' ? payload.status : null) ??
        (subtype === 'task_completed' ? 'completed' : null);
      if (status !== 'completed' && status !== 'failed' && status !== 'stopped') return;
      const item = this.items.find(
        (i): i is ToolItem => i.kind === 'tool' && i.backgroundTaskId === taskId,
      );
      if (!item || item.final) return;
      const summary = typeof payload.summary === 'string' ? payload.summary : null;
      if (summary) item.output = truncate(summary);
      item.status = status === 'completed' ? 'completed' : 'failed';
      item.durationSecs = durationSecs(item.startedAt, ts);
      item.final = true;
      if (!this.hasPendingBackgroundTasks()) this.setWorking(false);
    }
  }

  private handleControlRequest(payload: Record<string, unknown>, origin: string | undefined): void {
    if (origin === 'USER_EVENT') return;
    const requestId = typeof payload.request_id === 'string' ? payload.request_id : '';
    const request = isRecord(payload.request) ? payload.request : {};
    const subtype = typeof request.subtype === 'string' ? request.subtype : 'permission';
    if (subtype === 'interrupt' || subtype === 'initialize') return;

    const toolName = typeof request.tool_name === 'string' ? request.tool_name : null;
    const toolUseId = typeof request.tool_use_id === 'string' ? request.tool_use_id : null;
    const input = isRecord(request.input) ? request.input : null;

    if (toolName === 'AskUserQuestion') {
      const parsed = AskUserQuestionDetailSchema.safeParse(input);
      if (!parsed.success) return;
      this.push({
        kind: 'question',
        id: this.id('ask'),
        final: false,
        requestId,
        toolUseId,
        questions: parsed.data.questions,
        outcome: null,
      });
      return;
    }
    if (subtype !== 'can_use_tool') return;
    this.push({
      kind: 'permission',
      id: this.id('perm'),
      final: false,
      requestId,
      toolUseId,
      toolName,
      input,
      decision: null,
    });
  }

  /**
   * The stream echoes control responses (ours and any sent from the web), so
   * a question answered elsewhere still resolves here. Locally-answered items
   * are already final and skipped.
   */
  private handleControlResponse(payload: Record<string, unknown>): void {
    const outer = isRecord(payload.response) ? payload.response : null;
    const requestId =
      (typeof payload.request_id === 'string' && payload.request_id) ||
      (outer && typeof outer.request_id === 'string' ? outer.request_id : null);
    if (!requestId) return;

    const inner = outer && isRecord(outer.response) ? outer.response : null;
    const denied = inner?.behavior === 'deny';

    for (const item of this.items) {
      if (item.final) continue;
      if (item.kind === 'question' && item.requestId === requestId) {
        let answers: Record<string, string> = {};
        const updatedInput = inner && isRecord(inner.updatedInput) ? inner.updatedInput : null;
        if (updatedInput && isRecord(updatedInput.answers)) {
          answers = normalizeAnswers(updatedInput.answers);
        }
        item.outcome = { status: denied ? 'skipped' : 'answered', answers };
        item.final = true;
        return;
      }
      if (item.kind === 'permission' && item.requestId === requestId) {
        item.decision = denied ? 'denied' : 'allowed';
        item.final = true;
        return;
      }
    }
  }

  private handleStreamEvent(event: Record<string, unknown>, ts: number): void {
    const eventType = event.type;

    if (eventType === 'message_start') {
      this.setWorking(true);
      return;
    }

    if (eventType === 'content_block_start') {
      const block = isRecord(event.content_block) ? event.content_block : null;
      if (!block) return;
      this.setWorking(true);
      if (block.type === 'thinking') {
        this.finalizeStreamingTail(ts);
        this.turnHasContent = true;
        const item: ThinkingItem = {
          kind: 'thinking',
          id: this.id('think'),
          final: false,
          text: '',
          durationSecs: null,
        };
        thinkingStarts.set(item, ts);
        this.push(item);
      } else if (block.type === 'text') {
        this.finalizeStreamingTail(ts);
        this.turnHasContent = true;
        this.push({ kind: 'text', id: this.id('text'), final: false, text: '' });
      } else if (block.type === 'tool_use') {
        this.finalizeStreamingTail(ts);
        const name = typeof block.name === 'string' ? block.name : 'unknown';
        if (name === 'TodoWrite') {
          this.streamingTodoJson = '';
          return;
        }
        this.absorbToolUse(typeof block.id === 'string' ? block.id : '', name, null, ts);
        const pushed = this.items[this.items.length - 1];
        if (pushed.kind === 'tool' && pushed.input === null) pushed.status = 'pending';
      }
      return;
    }

    if (eventType === 'content_block_delta') {
      const delta = isRecord(event.delta) ? event.delta : null;
      if (!delta) return;
      const last = this.items[this.items.length - 1];
      if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
        if (last?.kind === 'thinking' && !last.final) last.text += delta.thinking;
      } else if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        if (last?.kind === 'text' && !last.final) last.text += delta.text;
      } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        if (this.streamingTodoJson !== null) this.streamingTodoJson += delta.partial_json;
      }
      return;
    }

    if (eventType === 'content_block_stop') {
      if (this.streamingTodoJson !== null) {
        try {
          const parsed: unknown = JSON.parse(this.streamingTodoJson);
          if (isRecord(parsed)) this.applyTodoWrite(parsed);
        } catch {
          // incomplete JSON — ignore
        }
        this.streamingTodoJson = null;
      }
      this.finalizeStreamingTail(ts);
    }
  }

  /** TodoWrite → merged plan snapshot appended as a fresh (final) plan item. */
  private applyTodoWrite(input: Record<string, unknown>): void {
    const todos = Array.isArray(input.todos) ? input.todos : null;
    if (!todos) return;
    const entries: PlanEntry[] = todos.filter(isRecord).map((t) => ({
      content: typeof t.content === 'string' ? t.content : '',
      status:
        t.status === 'in_progress' || t.status === 'completed'
          ? (t.status as PlanEntry['status'])
          : 'pending',
    }));

    if (input.merge === false) {
      this.planEntries = entries;
    } else {
      const merged = new Map<string, PlanEntry>();
      for (const entry of this.planEntries) merged.set(entry.content, entry);
      for (const entry of entries) merged.set(entry.content, entry);
      this.planEntries = [...merged.values()];
    }

    this.turnHasContent = true;
    // Terminal output is append-only, so each update prints the new snapshot
    // (the same way Claude Code re-prints its todo list).
    this.push({ kind: 'plan', id: this.id('plan'), final: true, entries: [...this.planEntries] });
  }

  // --- ACP protocol (message/thought chunks, tool calls, plans) ---

  private handleAcpEvent(type: string, payload: Record<string, unknown>, ts: number): void {
    const update = isRecord(payload.update) ? payload.update : payload;
    const kind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : type;

    switch (kind) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const content = update.content;
        const text =
          isRecord(content) && content.type === 'text' && typeof content.text === 'string'
            ? content.text
            : '';
        if (!text) return;
        this.setWorking(true);
        this.turnHasContent = true;
        const wantKind = kind === 'agent_message_chunk' ? 'text' : 'thinking';
        const last = this.items[this.items.length - 1];
        if (last?.kind === wantKind && !last.final) {
          last.text += text;
        } else {
          this.finalizeStreamingTail(ts);
          if (wantKind === 'text') {
            this.push({ kind: 'text', id: this.id('text'), final: false, text });
          } else {
            this.push({
              kind: 'thinking',
              id: this.id('think'),
              final: false,
              text,
              durationSecs: null,
            });
          }
        }
        return;
      }
      case 'tool_call': {
        this.finalizeStreamingTail(ts);
        this.setWorking(true);
        this.turnHasContent = true;
        const title = typeof update.title === 'string' && update.title ? update.title : 'tool';
        this.push({
          kind: 'tool',
          id: this.id('tool'),
          final: false,
          toolCallId: typeof update.toolCallId === 'string' ? update.toolCallId : '',
          name: title,
          input: isRecord(update.rawInput) ? update.rawInput : null,
          status: 'running',
          output: null,
          startedAt: ts,
          durationSecs: null,
          backgroundTaskId: null,
          fileChange: null,
        });
        return;
      }
      case 'tool_call_update': {
        const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : null;
        if (!toolCallId) return;
        const item = this.items.find(
          (i): i is ToolItem => i.kind === 'tool' && i.toolCallId === toolCallId,
        );
        if (!item || item.final) return;
        if (item.name === 'tool' && typeof update.title === 'string' && update.title) {
          item.name = update.title;
        }
        const output = Array.isArray(update.content) ? joinTextBlocks(update.content) : '';
        if (output) item.output = truncate(output);
        const status = typeof update.status === 'string' ? update.status : null;
        if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          if (item.status !== 'cancelled' || status === 'cancelled') {
            item.status = status;
          }
          item.durationSecs = durationSecs(item.startedAt, ts);
          item.final = true;
        }
        return;
      }
      case 'plan': {
        const entries = Array.isArray(update.entries) ? update.entries : [];
        const parsed: PlanEntry[] = entries.filter(isRecord).map((e) => ({
          content: typeof e.content === 'string' ? e.content : '',
          status:
            e.status === 'in_progress' || e.status === 'completed'
              ? (e.status as PlanEntry['status'])
              : 'pending',
        }));
        if (parsed.length === 0) return;
        this.planEntries = parsed;
        this.push({ kind: 'plan', id: this.id('plan'), final: true, entries: parsed });
        return;
      }
    }
  }

  // --- System / lifecycle events ---

  private handleSystemEvent(type: string, payload: Record<string, unknown>, ts: number): void {
    switch (type) {
      case 'turn.started':
        this.interrupted = false;
        this.turnHasContent = false;
        this.setWorking(true);
        return;
      case 'turn.completed':
      case 'turn.failed': {
        if (type !== 'turn.failed' && this.hasPendingBackgroundTasks()) return;
        const cancelled = this.interrupted;
        const errorText =
          typeof payload.error === 'string'
            ? payload.error
            : typeof payload.message === 'string'
              ? payload.message
              : null;
        this.endTurn(ts, {
          cancelled,
          isError: type === 'turn.failed' && !cancelled,
          detail: type === 'turn.failed' ? errorText : null,
        });
        return;
      }
      case 'turn.cancelled':
        this.markInterrupted(ts);
        this.endTurn(ts, { cancelled: true, isError: false, detail: null });
        return;
      case 'broker.error':
        this.endTurn(ts, {
          cancelled: false,
          isError: true,
          detail: typeof payload.message === 'string' ? payload.message : 'broker error',
        });
        return;
      case 'agent.interrupted':
        this.markInterrupted(ts);
        return;
    }

    // Broker stdout/stderr lines render as muted logs, not banners.
    const isStderr =
      (type === 'agent.error' && payload.errorType === 'stderr') ||
      (type === 'agent.log' && (payload.log_type === 'stderr' || payload.log_type === 'stdout'));
    if (isStderr) {
      const text = typeof payload.message === 'string' ? payload.message : '';
      if (text) this.push({ kind: 'log', id: this.id('log'), final: true, text });
      return;
    }
    if (type === 'agent.log') return;

    const banner = LIFECYCLE_BANNERS[type];
    if (!banner) return;

    let detail: string | null = null;
    if (type === 'agent.complete' && typeof payload.summary === 'string') detail = payload.summary;
    if (type === 'agent.error') {
      detail =
        typeof payload.error === 'string'
          ? payload.error
          : typeof payload.message === 'string'
            ? payload.message
            : null;
    }
    if (type === 'devbox.failed' && typeof payload.reason === 'string') detail = payload.reason;
    if (type.startsWith('agent.pr_')) detail = this.recordPrEvent(type, payload);
    if (type === 'agent.daemon_started') {
      const name = typeof payload.name === 'string' ? payload.name : 'daemon';
      const port = typeof payload.port === 'number' ? ` :${payload.port}` : '';
      detail = `${name}${port} — ^o to open`;
    }

    this.finalizeStreamingTail(ts);
    this.push({
      kind: 'banner',
      id: this.id('banner'),
      final: true,
      tone: banner.tone,
      label: banner.label,
      detail,
    });

    const endsTurn =
      type === 'agent.complete' ||
      type === 'agent.stopped' ||
      type === 'agent.killed' ||
      type === 'agent.error' ||
      type === 'devbox.failed' ||
      type === 'devbox.suspended' ||
      type === 'devbox.shutdown';
    if (endsTurn) {
      this.expirePendingInteractions();
      this.setWorking(false);
    }
  }

  /**
   * Track the PR behind an `agent.pr_*` event and return the banner detail
   * line (`#123 title`, with the URL on the opened banner so it lands in the
   * scrollback once).
   */
  private recordPrEvent(type: string, payload: Record<string, unknown>): string | null {
    const url = typeof payload.url === 'string' ? payload.url : null;
    const number = typeof payload.number === 'number' ? payload.number : null;
    const title = typeof payload.title === 'string' ? payload.title : '';
    if (!url || number === null) return null;

    const status: PrStatus | null =
      type === 'agent.pr_created'
        ? 'open'
        : type === 'agent.pr_merged'
          ? 'merged'
          : type === 'agent.pr_closed'
            ? 'closed'
            : type === 'agent.pr_checks_failed'
              ? 'checks-failed'
              : null;

    const existing = this.prLinks.find((pr) => pr.url === url);
    if (existing) {
      if (status) existing.status = status;
      if (title) existing.title = title;
    } else {
      this.prLinks.push({
        url,
        number,
        title,
        repo: typeof payload.repo === 'string' ? payload.repo : '',
        status: status ?? 'open',
      });
    }

    const headline = `#${number}${title ? ` ${title}` : ''}`;
    return type === 'agent.pr_created' ? `${headline}\n${url}` : headline;
  }

  // --- Turn lifecycle helpers ---

  private markInterrupted(ts: number): void {
    this.interrupted = true;
    for (const item of this.items) {
      if (item.kind === 'tool' && !item.final) {
        item.status = 'cancelled';
        item.durationSecs = durationSecs(item.startedAt, ts);
        item.final = true;
      }
    }
  }

  private endTurn(
    ts: number,
    end: { cancelled: boolean; isError: boolean; detail: string | null },
  ): void {
    if (this.turnEnded) return;
    this.turnEnded = true;
    this.finalizeStreamingTail(ts);
    if (end.cancelled) this.markInterrupted(ts);
    // Freeze everything still open (crashed tools keep their last status);
    // background tasks were already handled by the pending check upstream.
    for (const item of this.items) {
      if (item.kind === 'tool' && !item.final) item.final = true;
    }
    this.expirePendingInteractions();
    if (end.cancelled || end.isError) {
      this.push({
        kind: 'turn-end',
        id: this.id('turn'),
        final: true,
        cancelled: end.cancelled,
        isError: end.isError,
        detail: end.detail,
      });
    }
    this.interrupted = false;
    this.turnHasContent = false;
    this.setWorking(false);
  }

  /**
   * A question/permission can outlive its turn (interrupt, agent crash,
   * reconnect). The server has lost the parked request by then, so answering
   * is pointless — mark it expired so the prompt clears and the transcript
   * prefix can advance.
   */
  private expirePendingInteractions(): void {
    for (const item of this.items) {
      if (item.final) continue;
      if (item.kind === 'question') {
        item.outcome = { status: 'expired', answers: {} };
        item.final = true;
      } else if (item.kind === 'permission') {
        item.decision = 'expired';
        item.final = true;
      }
    }
  }

  /** Close the open streaming text/thinking item, if any. */
  private finalizeStreamingTail(ts: number | null): void {
    const last = this.items[this.items.length - 1];
    if (!last || last.final) return;
    if (last.kind === 'text') {
      last.final = true;
      if (!last.text.trim()) this.items.pop();
    } else if (last.kind === 'thinking') {
      last.final = true;
      const start = thinkingStarts.get(last);
      if (ts !== null && start !== undefined) last.durationSecs = durationSecs(start, ts);
      if (!last.text.trim()) this.items.pop();
    }
  }

  private hasPendingBackgroundTasks(): boolean {
    return this.items.some((i) => i.kind === 'tool' && !i.final && i.backgroundTaskId !== null);
  }

  private setWorking(working: boolean): void {
    if (working) this.turnEnded = false;
    if (this.working === working) return;
    this.working = working;
    this.workingSinceMs = working ? Date.now() : null;
  }

  private push(item: TranscriptItem): void {
    this.items.push(item);
  }

  private id(prefix: string): string {
    return `${prefix}-${++this.nextId}`;
  }
}

/** Start timestamps for live thinking items (duration on finalize). */
const thinkingStarts = new WeakMap<ThinkingItem, number>();

/** Parse the `init` step's expected-steps JSON (rich or legacy string[]). */
function parseInitSteps(detail: string | null): Array<{ id: string; label: string }> {
  if (!detail) return [];
  try {
    const parsed: unknown = JSON.parse(detail);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === 'string') return { id: entry, label: entry.replace(/_/g, ' ') };
        if (isRecord(entry) && typeof entry.id === 'string') {
          return {
            id: entry.id,
            label: typeof entry.label === 'string' ? entry.label : entry.id.replace(/_/g, ' '),
          };
        }
        return null;
      })
      .filter((s): s is { id: string; label: string } => s !== null);
  } catch {
    return [];
  }
}
