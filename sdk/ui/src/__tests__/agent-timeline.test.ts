/**
 * `buildAgentTimeline` reduces a raw agent stream into renderable items.
 * These cases lock in the three event dialects it must understand:
 *
 * - flat (`message`, `agent_message_chunk`, `tool_call`/`tool_call_update`)
 * - ACP (`session/prompt`, `session/update`)
 * - native Claude Code SDK (`assistant`/`user` with a `message.content`
 *   block array, plus `query`)
 * - native Codex app-server (JSON-RPC frames whose type is the method:
 *   `turn/start`, `item/agentMessage/delta`, `item/started`, ...)
 *
 * The native case regressed once: the flat branch swallowed `assistant`
 * events and found no string, so claude-code transcripts rendered empty.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAgentTimeline,
  buildChatMessages,
  groupToolRuns,
  reconcilePendingEvents,
} from '../lib/event-utils';
import type { ReflexStreamEvent } from '@runloop/reflex-client';

let seq = 0;
function event(type: string, payload: unknown, extra: Partial<ReflexStreamEvent> = {}) {
  seq += 1;
  return {
    id: `evt_${seq}`,
    streamId: 'strm_1',
    type,
    payload,
    timestamp: seq * 1000,
    ...extra,
  } as ReflexStreamEvent;
}

describe('buildAgentTimeline — flat dialect', () => {
  it('renders user messages, merged agent text, and tool completion', () => {
    const timeline = buildAgentTimeline([
      event('message', { message: 'hello' }, { origin: 'USER_EVENT' }),
      event('agent_message_chunk', { message: 'Hi ' }),
      event('agent_message_chunk', { message: 'there' }),
      event('tool_call', { id: 'c1', name: 'Bash', input: { command: 'ls' } }),
      event('tool_call_update', { id: 'c1', status: 'completed' }),
      event('turn.completed', {}),
    ]);
    expect(timeline.map((i) => i.kind)).toEqual(['user', 'agent', 'tool', 'system']);
    const agent = timeline[1];
    expect(agent.kind === 'agent' && agent.text).toBe('Hi there');
    const tool = timeline[2];
    expect(tool.kind === 'tool' && tool.name).toBe('Bash');
    expect(tool.kind === 'tool' && tool.done).toBe(true);
  });
});

describe('buildAgentTimeline — ACP dialect', () => {
  it('handles session/prompt and session/update chunks and tools', () => {
    const timeline = buildAgentTimeline([
      event('session/prompt', { prompt: [{ type: 'text', text: 'build it' }] }),
      event('session/update', {
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } },
      }),
      event('session/update', {
        update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'skill', rawInput: {} },
      }),
      event('session/update', {
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 't1',
          status: 'completed',
          rawInput: { name: 'daemon-launcher' },
        },
      }),
    ]);
    expect(timeline.map((i) => i.kind)).toEqual(['user', 'agent', 'tool']);
    const tool = timeline[2];
    expect(tool.kind === 'tool' && tool.done).toBe(true);
    expect(tool.kind === 'tool' && tool.detail).toContain('daemon-launcher');
  });
});

describe('buildAgentTimeline — native Claude Code SDK dialect', () => {
  it('renders query, text/thinking/tool_use blocks, and folds tool_result', () => {
    const timeline = buildAgentTimeline([
      event('query', { message: { role: 'user', content: 'Build a game' } }),
      event('assistant', {
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'let me scaffold', signature: 'sig' },
            { type: 'text', text: "I'll build it." },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Bash',
              input: { command: 'npm create vite', description: 'scaffold' },
            },
          ],
        },
      }),
      event('user', {
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: false }],
        },
      }),
      event('result', { result: 'The game is live.' }),
      event('system', { subtype: 'init' }),
    ]);
    expect(timeline.map((i) => i.kind)).toEqual(['user', 'thought', 'agent', 'tool']);
    const user = timeline[0];
    expect(user.kind === 'user' && user.text).toBe('Build a game');
    const thought = timeline[1];
    expect(thought.kind === 'thought' && thought.text).toBe('let me scaffold');
    const tool = timeline[3];
    expect(tool.kind === 'tool' && tool.name).toBe('Bash');
    expect(tool.kind === 'tool' && tool.done).toBe(true);
  });

  it('marks a failed tool_result and skips empty (redacted) thinking', () => {
    const timeline = buildAgentTimeline([
      event('assistant', {
        message: {
          content: [
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'tool_use', id: 'toolu_9', name: 'Bash', input: { command: 'node -v' } },
          ],
        },
      }),
      event('user', {
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'toolu_9', is_error: true }],
        },
      }),
    ]);
    // Empty thinking is dropped; only the tool line remains.
    expect(timeline.map((i) => i.kind)).toEqual(['tool']);
    const tool = timeline[0];
    expect(tool.kind === 'tool' && tool.done).toBe(true);
    expect(tool.kind === 'tool' && tool.detail).toContain('failed');
  });

  it('does not mistake a flat {message:string} assistant for the native shape', () => {
    const timeline = buildAgentTimeline([event('assistant', { message: 'plain text' })]);
    expect(timeline.map((i) => i.kind)).toEqual(['agent']);
    const agent = timeline[0];
    expect(agent.kind === 'agent' && agent.text).toBe('plain text');
  });
});

describe('buildAgentTimeline — native Codex app-server dialect', () => {
  /** A native Codex frame: the durable type is the JSON-RPC method. */
  function codex(method: string, params: Record<string, unknown>, id?: number) {
    return event(method, { jsonrpc: '2.0', method, params, ...(id === undefined ? {} : { id }) });
  }

  it('renders the prompt, streamed text and reasoning, and command work', () => {
    const timeline = buildAgentTimeline([
      event(
        'turn/start',
        {
          jsonrpc: '2.0',
          method: 'turn/start',
          params: { input: [{ type: 'text', text: 'add a scoreboard' }] },
        },
        { origin: 'USER_EVENT' },
      ),
      codex('turn/started', { turn: { id: 'turn_1' } }),
      codex('item/reasoning/summaryTextDelta', { itemId: 'item_0', delta: 'plan the change' }),
      codex('item/agentMessage/delta', { itemId: 'item_1', delta: 'Adding ' }),
      codex('item/agentMessage/delta', { itemId: 'item_1', delta: 'a scoreboard.' }),
      codex('item/started', {
        item: { id: 'item_2', type: 'commandExecution', command: 'npm test', cwd: '/app' },
      }),
      codex('item/commandExecution/outputDelta', { itemId: 'item_2', delta: 'ok\n' }),
      codex('item/completed', {
        item: {
          id: 'item_2',
          type: 'commandExecution',
          command: 'npm test',
          status: 'completed',
          exitCode: 0,
        },
      }),
      codex('item/completed', {
        item: { id: 'item_1', type: 'agentMessage', text: 'Adding a scoreboard.' },
      }),
      codex('turn/completed', { turn: { status: 'completed', durationMs: 1200 } }),
    ]);

    expect(timeline.map((i) => i.kind)).toEqual([
      'user',
      'system',
      'thought',
      'agent',
      'tool',
      'system',
    ]);
    const user = timeline[0];
    expect(user.kind === 'user' && user.text).toBe('add a scoreboard');
    const thought = timeline[2];
    expect(thought.kind === 'thought' && thought.text).toBe('plan the change');
    // Deltas merge into one bubble, and the terminal frame does not repeat it.
    const agent = timeline[3];
    expect(agent.kind === 'agent' && agent.text).toBe('Adding a scoreboard.');
    const tool = timeline[4];
    expect(tool.kind === 'tool' && tool.name).toBe('shell');
    expect(tool.kind === 'tool' && tool.detail).toBe('npm test');
    expect(tool.kind === 'tool' && tool.done).toBe(true);
    expect(timeline[5]).toMatchObject({ kind: 'system', text: 'turn complete', note: 'turn' });
  });

  it('renders a message whose deltas never arrived, and keeps messages apart', () => {
    const timeline = buildAgentTimeline([
      codex('item/completed', { item: { id: 'm1', type: 'agentMessage', text: 'first' } }),
      codex('item/completed', { item: { id: 'm2', type: 'agentMessage', text: 'second' } }),
    ]);
    expect(timeline.map((i) => i.kind === 'agent' && i.text)).toEqual(['first', 'second']);
  });

  it('marks a failed file change and reports errors as error notes', () => {
    const timeline = buildAgentTimeline([
      codex('item/started', {
        item: { id: 'f1', type: 'fileChange', changes: [{ path: 'src/game.ts', diff: '@@' }] },
      }),
      codex('item/completed', {
        item: {
          id: 'f1',
          type: 'fileChange',
          status: 'failed',
          changes: [{ path: 'src/game.ts', diff: '@@' }],
        },
      }),
      codex('error', { error: { message: 'stream disconnected' } }),
    ]);
    const tool = timeline[0];
    expect(tool.kind === 'tool' && tool.name).toBe('edit');
    expect(tool.kind === 'tool' && tool.detail).toBe('src/game.ts — failed');
    expect(timeline[1]).toMatchObject({
      kind: 'system',
      text: 'stream disconnected',
      tone: 'error',
    });
  });

  it('surfaces parked approvals and slash-command results', () => {
    const timeline = buildAgentTimeline([
      codex('item/commandExecution/requestApproval', { command: 'rm -rf build' }, 7),
      event('codex.command.result', { command: 'compact', status: 'ok', message: 'Context freed' }),
    ]);
    expect(timeline).toEqual([
      expect.objectContaining({
        kind: 'system',
        text: 'command approval requested: rm -rf build',
      }),
      expect.objectContaining({ kind: 'system', text: '/compact — Context freed' }),
    ]);
  });

  it('does not let a token-usage frame split a streaming message', () => {
    const timeline = buildAgentTimeline([
      codex('item/agentMessage/delta', { itemId: 'm1', delta: 'one ' }),
      codex('thread/tokenUsage/updated', { tokenUsage: { total: { totalTokens: 10 } } }),
      codex('item/agentMessage/delta', { itemId: 'm1', delta: 'bubble' }),
    ]);
    expect(timeline.map((i) => i.kind === 'agent' && i.text)).toEqual(['one bubble']);
  });

  it('reads frames whose params were spread across the payload', () => {
    // Brokers that publish only the notification body, not the whole
    // JSON-RPC frame. The product's Codex handler tolerates both shapes.
    const timeline = buildAgentTimeline([
      event(
        'turn/start',
        { input: [{ type: 'text', text: 'ship it' }] },
        {
          origin: 'USER_EVENT',
        },
      ),
      event('item/agentMessage/delta', { itemId: 'm1', delta: 'On it.' }),
      event('item/started', {
        item: { id: 'c1', type: 'commandExecution', command: 'npm test' },
      }),
      event('turn/completed', { turn: { status: 'completed' } }),
    ]);
    expect(timeline.map((i) => i.kind)).toEqual(['user', 'agent', 'tool', 'system']);
    expect(timeline[0]).toMatchObject({ text: 'ship it' });
    expect(timeline[1]).toMatchObject({ text: 'On it.' });
  });

  it('reads frames the runner wrapped as `turn.codex.*`', () => {
    const timeline = buildAgentTimeline([
      event('turn.codex.item/agentMessage/delta', {
        method: 'item/agentMessage/delta',
        params: { itemId: 'm1', delta: 'wrapped text' },
      }),
    ]);
    expect(timeline.map((i) => i.kind === 'agent' && i.text)).toEqual(['wrapped text']);
  });

  it('leaves a Claude `error` event to the Claude branch', () => {
    const timeline = buildAgentTimeline([event('error', { message: 'claude failed' })]);
    expect(timeline).toEqual([]);
  });
});

describe('buildChatMessages — native Codex dialect', () => {
  it('bubbles the prompt and merges streamed agent text', () => {
    const messages = buildChatMessages([
      event(
        'turn/start',
        { method: 'turn/start', params: { input: [{ type: 'text', text: 'ship it' }] } },
        { origin: 'USER_EVENT' },
      ),
      event('item/agentMessage/delta', {
        method: 'item/agentMessage/delta',
        params: { itemId: 'm1', delta: 'On ' },
      }),
      event('item/agentMessage/delta', {
        method: 'item/agentMessage/delta',
        params: { itemId: 'm1', delta: 'it.' },
      }),
    ]);
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'ship it'],
      ['agent', 'On it.'],
    ]);
  });
});

describe('groupToolRuns', () => {
  const tool = (id: string) =>
    ({ kind: 'tool', id, name: 'Bash', detail: '', done: true }) as const;
  const note = { kind: 'system', id: 's1', text: 'turn complete', tone: 'info' } as const;

  it('collapses runs above the threshold and preserves order', () => {
    const items = [tool('a'), tool('b'), tool('c'), tool('d'), note, tool('e')];
    const grouped = groupToolRuns(items, 3);
    expect(grouped.map((i) => i.kind)).toEqual(['tool-group', 'system', 'tool']);
    const group = grouped[0];
    expect(group.kind === 'tool-group' && group.tools.map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('leaves short runs alone', () => {
    const items = [tool('a'), tool('b'), note];
    expect(groupToolRuns(items, 3).map((i) => i.kind)).toEqual(['tool', 'tool', 'system']);
  });
});

describe('reconcilePendingEvents', () => {
  it('drops a pending entry once the socket echo of the send arrives', () => {
    const pending = event('message', { message: 'keep going' }, { origin: 'USER_EVENT' });
    pending.id = 'pending-123';
    const echo = event('message', { message: 'keep going' }, { origin: 'USER_EVENT' });
    const reconciled = reconcilePendingEvents([pending, echo]);
    expect(reconciled.map((e) => e.id)).toEqual([echo.id]);
  });

  it('confirms across dialects (native query echo)', () => {
    const pending = event('message', { message: 'add a scoreboard' }, { origin: 'USER_EVENT' });
    pending.id = 'pending-9';
    const echo = event('query', { message: { role: 'user', content: 'add a scoreboard' } });
    expect(reconcilePendingEvents([pending, echo]).map((e) => e.id)).toEqual([echo.id]);
  });

  it('keeps pending entries that are not yet confirmed', () => {
    const pending = event('message', { message: 'unconfirmed' }, { origin: 'USER_EVENT' });
    pending.id = 'pending-1';
    const other = event('message', { message: 'different text' }, { origin: 'USER_EVENT' });
    expect(reconcilePendingEvents([pending, other]).length).toBe(2);
  });

  it('matches on the first line when attachments suffixed the pending text', () => {
    const pending = event(
      'message',
      { message: 'see screenshot\n📎 bug.png' },
      { origin: 'USER_EVENT' },
    );
    pending.id = 'pending-2';
    const echo = event('message', { message: 'see screenshot' }, { origin: 'USER_EVENT' });
    expect(reconcilePendingEvents([pending, echo]).map((e) => e.id)).toEqual([echo.id]);
  });
});

describe('lifecycle note metadata', () => {
  it('carries the event time and a note kind, and maps devbox suspends', () => {
    const timeline = buildAgentTimeline([
      event('devbox.running', {}),
      event('turn.started', {}),
      event('devbox.suspended', {}),
    ]);
    expect(timeline).toEqual([
      expect.objectContaining({
        kind: 'system',
        text: 'devbox running',
        note: 'devbox',
        at: expect.any(Number),
      }),
      expect.objectContaining({ kind: 'system', text: 'turn started', note: 'turn' }),
      expect.objectContaining({ kind: 'system', text: 'devbox suspended', note: 'devbox' }),
    ]);
  });
});

describe('system note dedupe', () => {
  it('collapses consecutive identical lifecycle notes', () => {
    const timeline = buildAgentTimeline([
      event('agent.daemon_started', { name: 'game-dev', url: 'http://x' }),
      event('agent.daemon_started', { name: 'game-dev', url: 'http://x' }),
      event('agent.daemon_started', { name: 'game-dev', url: 'http://x' }),
      event('turn.completed', {}),
      event('turn.completed', {}),
    ]);
    expect(timeline.map((i) => i.kind)).toEqual(['system', 'system']);
  });
});
