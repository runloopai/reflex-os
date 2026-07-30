import { describe, expect, it, vi } from 'vitest';
import {
  ToolApprover,
  describePolicy,
  toolCategory,
  type PendingApproval,
} from '../connect/policy.js';
import { policyFromFlags } from '../cli.js';

const EXEC_CALL = {
  callId: 'wtc_1',
  tool: 'run_command' as const,
  summary: 'pnpm test',
  agentId: 'agt_1',
};

describe('toolCategory / policyFromFlags', () => {
  it('categorizes tools', () => {
    expect(toolCategory('run_command')).toBe('exec');
    expect(toolCategory('write_file')).toBe('write');
    expect(toolCategory('read_file')).toBe('read');
    expect(toolCategory('list_directory')).toBe('read');
  });

  it('derives policy from flags', () => {
    // Full access is the default; connecting is already the opt-in.
    expect(policyFromFlags({})).toEqual({ exec: 'allow', write: 'allow' });
    // --ask restores per-call approval for both categories.
    expect(policyFromFlags({ ask: true })).toEqual({ exec: 'ask', write: 'ask' });
    // The allow flags carve a category back out of --ask.
    expect(policyFromFlags({ ask: true, 'allow-exec': true })).toEqual({
      exec: 'allow',
      write: 'ask',
    });
    expect(policyFromFlags({ ask: true, 'allow-write': true })).toEqual({
      exec: 'ask',
      write: 'allow',
    });
    // Without --ask the allow flags are redundant no-ops.
    expect(policyFromFlags({ 'allow-exec': true })).toEqual({ exec: 'allow', write: 'allow' });
    // --read-only wins over everything.
    expect(policyFromFlags({ 'read-only': true, ask: true, 'allow-exec': true })).toEqual({
      exec: 'deny',
      write: 'deny',
    });
    expect(describePolicy(policyFromFlags({}))).toBe('exec: allow · write: allow');
  });
});

describe('ToolApprover', () => {
  it('always allows read tools without surfacing an approval', async () => {
    const approver = new ToolApprover({ exec: 'deny', write: 'deny' }, { interactive: true });
    await expect(approver.gate({ callId: 'c', tool: 'read_file', summary: 'x' })).resolves.toEqual({
      allowed: true,
    });
    expect(approver.current()).toBeNull();
  });

  it('denies immediately under a deny policy with an explanatory reason', async () => {
    const approver = new ToolApprover({ exec: 'deny', write: 'deny' }, { interactive: true });
    const result = await approver.gate(EXEC_CALL);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/read-only/);
  });

  it('denies ask-tier calls when non-interactive, pointing at the fix', async () => {
    const approver = new ToolApprover({ exec: 'ask', write: 'ask' }, { interactive: false });
    const result = await approver.gate(EXEC_CALL);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/without --ask/);
    expect(result.reason).toMatch(/--allow-exec/);
  });

  it('surfaces ask-tier calls and honors allow-once', async () => {
    const approver = new ToolApprover({ exec: 'ask', write: 'ask' }, { interactive: true });
    const seen: Array<PendingApproval | null> = [];
    approver.subscribe((p) => seen.push(p));

    const gate = approver.gate(EXEC_CALL);
    expect(approver.current()).toMatchObject({ callId: 'wtc_1', category: 'exec' });
    approver.resolveCurrent('allow-once');
    await expect(gate).resolves.toEqual({ allowed: true });
    // Policy unchanged: the next exec call asks again.
    expect(approver.getPolicy().exec).toBe('ask');
    expect(seen.at(-1)).toBeNull();
  });

  it('deny resolves with the owner-denied reason', async () => {
    const approver = new ToolApprover({ exec: 'ask', write: 'ask' }, { interactive: true });
    const gate = approver.gate(EXEC_CALL);
    approver.resolveCurrent('deny');
    const result = await gate;
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/denied by the workstation owner/);
  });

  it('allow-session upgrades the category and drains queued calls of it', async () => {
    const approver = new ToolApprover({ exec: 'ask', write: 'ask' }, { interactive: true });
    const first = approver.gate(EXEC_CALL);
    const second = approver.gate({ ...EXEC_CALL, callId: 'wtc_2', summary: 'pnpm lint' });
    const write = approver.gate({ callId: 'wtc_3', tool: 'write_file', summary: 'a.txt' });

    approver.resolveCurrent('allow-session');
    await expect(first).resolves.toEqual({ allowed: true });
    // The queued exec call was drained by the session allow…
    await expect(second).resolves.toEqual({ allowed: true });
    expect(approver.getPolicy().exec).toBe('allow');
    // …but the write call still asks.
    expect(approver.current()).toMatchObject({ callId: 'wtc_3', category: 'write' });
    approver.resolveCurrent('deny');
    await expect(write).resolves.toMatchObject({ allowed: false });
    // Future exec calls skip approval entirely.
    await expect(approver.gate({ ...EXEC_CALL, callId: 'wtc_4' })).resolves.toEqual({
      allowed: true,
    });
  });

  it('times out unanswered approvals with a denial', async () => {
    vi.useFakeTimers();
    try {
      const approver = new ToolApprover(
        { exec: 'ask', write: 'ask' },
        { interactive: true, timeoutMs: 1_000 },
      );
      const gate = approver.gate(EXEC_CALL);
      await vi.advanceTimersByTimeAsync(1_100);
      const result = await gate;
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/timed out/);
      expect(approver.current()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('removes a pending approval when its call is aborted', async () => {
    const approver = new ToolApprover({ exec: 'ask', write: 'ask' }, { interactive: true });
    const controller = new AbortController();
    const gate = approver.gate({ ...EXEC_CALL, signal: controller.signal });
    expect(approver.current()).toMatchObject({ callId: 'wtc_1' });

    controller.abort();

    await expect(gate).resolves.toMatchObject({ allowed: false });
    expect(approver.current()).toBeNull();
  });
});
