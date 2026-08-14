import { describe, expect, it } from 'vitest';
import type { ReflexStreamEvent } from '@runloop/reflex-client';
import {
  TranscriptEngine,
  type PlanItem,
  type QuestionItem,
  type PermissionItem,
  type SetupItem,
  type ToolItem,
} from '../chat/transcript.js';
import { editSummary } from '../chat/format.js';

let eventSeq = 0;

function event(
  type: string,
  payload: unknown,
  extra: Partial<ReflexStreamEvent> = {},
): ReflexStreamEvent {
  eventSeq += 1;
  return {
    id: `evt_${eventSeq}`,
    streamId: 'str_1',
    type,
    payload,
    timestamp: 1_000 + eventSeq * 100,
    ...extra,
  };
}

function feed(engine: TranscriptEngine, ...events: ReflexStreamEvent[]) {
  for (const e of events) engine.handleEvent(e);
}

function assistantEvent(content: unknown[]): ReflexStreamEvent {
  return event('turn.claude.assistant', { message: { role: 'assistant', content } });
}

describe('TranscriptEngine', () => {
  it('renders user prompts from both protocols and strips file envelopes', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('query', { message: { role: 'user', content: 'fix the bug' } }),
      event(
        'session/prompt',
        { prompt: [{ type: 'text', text: 'hello agent' }] },
        { origin: 'USER_EVENT' },
      ),
      event('query', {
        message: {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '[File: notes.txt (text/plain)]\nsecret contents\n[End of file: notes.txt]\nsee attached',
            },
          ],
        },
      }),
    );
    const items = engine.getItems();
    expect(items.map((i) => i.kind)).toEqual(['user', 'user', 'user']);
    expect(items[0]).toMatchObject({ text: 'fix the bug', final: true });
    expect(items[1]).toMatchObject({ text: 'hello agent' });
    expect(items[2]).toMatchObject({ text: 'see attached', attachments: ['notes.txt'] });
  });

  describe('pending sends (optimistic outbound messages)', () => {
    it('resolves the pending entry when the echo arrives, leaving one transcript item', () => {
      const engine = new TranscriptEngine();
      engine.addPendingSend('c1', 'you still there?');
      expect(engine.getPendingSends()).toHaveLength(1);

      feed(engine, event('query', { message: { role: 'user', content: 'you still there?' } }));
      expect(engine.getPendingSends()).toHaveLength(0);
      expect(engine.getItems().filter((i) => i.kind === 'user')).toHaveLength(1);
    });

    it('renders exactly one item when the POST response event and its socket replay both arrive', () => {
      const engine = new TranscriptEngine();
      engine.addPendingSend('c1', 'you still there?');
      const echo = event('query', { message: { role: 'user', content: 'you still there?' } });

      // WS echo can beat the HTTP response — order must not matter.
      engine.handleEvent(echo); // socket copy
      engine.handleEvent(echo); // POST-response copy (same event id)
      expect(engine.getItems().filter((i) => i.kind === 'user')).toHaveLength(1);
      expect(engine.getPendingSends()).toHaveLength(0);
    });

    it('resolves duplicate texts FIFO and leaves unmatched entries pending', () => {
      const engine = new TranscriptEngine();
      engine.addPendingSend('c1', 'same');
      engine.addPendingSend('c2', 'same');
      feed(engine, event('query', { message: { role: 'user', content: 'same' } }));
      expect(engine.getPendingSends().map((p) => p.clientId)).toEqual(['c2']);
    });

    it('does not resolve failed entries, and another user message leaves them alone', () => {
      const engine = new TranscriptEngine();
      engine.addPendingSend('c1', 'lost message');
      engine.markPendingFailed('c1', 'network down');
      feed(engine, event('query', { message: { role: 'user', content: 'lost message' } }));
      expect(engine.getPendingSends()).toHaveLength(1);
      expect(engine.getPendingSends()[0].status).toBe('failed');
    });

    it('times out silent sends: acked becomes unconfirmed, unacked becomes failed', () => {
      const engine = new TranscriptEngine();
      engine.addPendingSend('acked', 'hello');
      engine.addPendingSend('lost', 'world');
      engine.markPendingHttpAcked('acked');

      const later = Date.now() + 25_000;
      expect(engine.timeoutStalePendingSends(20_000, later)).toBe(true);
      const byId = Object.fromEntries(engine.getPendingSends().map((p) => [p.clientId, p.status]));
      expect(byId).toEqual({ acked: 'unconfirmed', lost: 'failed' });
    });

    it('a late echo still resolves an unconfirmed entry', () => {
      const engine = new TranscriptEngine();
      engine.addPendingSend('c1', 'slow echo');
      engine.markPendingHttpAcked('c1');
      engine.timeoutStalePendingSends(20_000, Date.now() + 30_000);
      expect(engine.getPendingSends()[0].status).toBe('unconfirmed');

      feed(engine, event('query', { message: { role: 'user', content: 'slow echo' } }));
      expect(engine.getPendingSends()).toHaveLength(0);
    });

    it('matches echoes that expanded agent-run references', () => {
      const engine = new TranscriptEngine();
      engine.addPendingSend('c1', 'look at @[My run](agent-run:agt_123) please');
      feed(
        engine,
        event('query', {
          message: {
            role: 'user',
            content:
              'look at <referenced-agent-run id="agt_123" title="My run">\ndetails\n</referenced-agent-run> please',
          },
        }),
      );
      expect(engine.getPendingSends()).toHaveLength(0);
    });

    it('supports retry and dismiss', () => {
      const engine = new TranscriptEngine();
      engine.addPendingSend('c1', 'flaky');
      engine.markPendingFailed('c1', 'boom');

      const entry = engine.resetPendingForRetry('c1');
      expect(entry).toMatchObject({ clientId: 'c1', status: 'sending', httpAcked: false });

      engine.markPendingFailed('c1', 'boom again');
      engine.dismissPendingSend('c1');
      expect(engine.getPendingSends()).toHaveLength(0);
    });
  });

  it('renders assistant text, thinking, and tool calls with results', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      assistantEvent([
        { type: 'thinking', thinking: 'hmm let me look' },
        { type: 'text', text: 'On it.' },
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls -la' } },
      ]),
    );
    expect(engine.getItems().map((i) => i.kind)).toEqual(['thinking', 'text', 'tool']);
    const tool = engine.getItems()[2] as ToolItem;
    expect(tool).toMatchObject({ name: 'Bash', status: 'running', final: false });
    expect(engine.isWorking()).toBe(true);

    feed(
      engine,
      event('turn.claude.user', {
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file-a\nfile-b' }],
        },
      }),
    );
    expect(tool).toMatchObject({ status: 'completed', output: 'file-a\nfile-b', final: true });
  });

  it('marks failed tool results and freezes the turn on result', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('turn.started', {}),
      assistantEvent([{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'boom' } }]),
      event('turn.claude.user', {
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'exploded', is_error: true },
          ],
        },
      }),
      event('turn.claude.result', { is_error: false, result: 'done' }),
    );
    const tool = engine.getItems().find((i) => i.kind === 'tool') as ToolItem;
    expect(tool.status).toBe('failed');
    expect(engine.isWorking()).toBe(false);
    // Every item is final, so the whole transcript is stable.
    expect(engine.getStableCount()).toBe(engine.getItems().length);
  });

  it('assembles streamed text deltas and absorbs the full assistant echo without duplicating', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('turn.claude.stream_event', {
        event: { type: 'content_block_start', content_block: { type: 'text' } },
      }),
      event('turn.claude.stream_event', {
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } },
      }),
      event('turn.claude.stream_event', {
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
      }),
    );
    expect(engine.getItems()).toHaveLength(1);
    expect(engine.getItems()[0]).toMatchObject({ kind: 'text', text: 'Hello', final: false });
    // The live streaming block is not stable yet.
    expect(engine.getStableCount()).toBe(0);

    feed(engine, assistantEvent([{ type: 'text', text: 'Hello' }]));
    const items = engine.getItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'text', text: 'Hello', final: true });
    expect(engine.getStableCount()).toBe(1);
  });

  it('folds TodoWrite into merged plan snapshots', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      assistantEvent([
        {
          type: 'tool_use',
          id: 'todo1',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'step one', status: 'in_progress' },
              { content: 'step two', status: 'pending' },
            ],
          },
        },
      ]),
      assistantEvent([
        {
          type: 'tool_use',
          id: 'todo2',
          name: 'TodoWrite',
          input: { todos: [{ content: 'step one', status: 'completed' }] },
        },
      ]),
    );
    const plans = engine.getItems().filter((i): i is PlanItem => i.kind === 'plan');
    expect(plans).toHaveLength(2);
    expect(plans[1].entries).toEqual([
      { content: 'step one', status: 'completed' },
      { content: 'step two', status: 'pending' },
    ]);
  });

  describe('Write change summaries', () => {
    /** Run one Write call to completion and return the summary its row renders. */
    function writeSummary(
      resultText: string,
      toolUseResult?: Record<string, unknown>,
      content = 'x = 2\ny = 3\n',
    ): string | null {
      const engine = new TranscriptEngine();
      feed(
        engine,
        event('turn.started', {}),
        assistantEvent([
          {
            type: 'tool_use',
            id: 'tu-w',
            name: 'Write',
            input: { file_path: '/repo/app.py', content },
          },
        ]),
        event('turn.claude.user', {
          ...(toolUseResult ? { tool_use_result: toolUseResult } : {}),
          message: { content: [{ type: 'tool_result', tool_use_id: 'tu-w', content: resultText }] },
        }),
      );
      const tool = engine.getItems().find((i) => i.kind === 'tool') as ToolItem;
      return editSummary(tool.name, tool.input, tool.fileChange);
    }

    it('counts the whole file for a create', () => {
      expect(
        writeSummary('File created successfully at: /repo/app.py', {
          type: 'create',
          filePath: '/repo/app.py',
          content: 'x = 2\ny = 3\n',
          structuredPatch: [],
        }),
      ).toBe('+2 lines');
    });

    it('identifies an empty created file without claiming it was unchanged', () => {
      expect(
        writeSummary(
          'File created successfully at: /repo/app.py',
          {
            type: 'create',
            filePath: '/repo/app.py',
            content: '',
            structuredPatch: [],
          },
          '',
        ),
      ).toBe('created empty file');
    });

    it('reports no change for an update with an empty patch', () => {
      expect(
        writeSummary('The file /repo/app.py has been updated successfully.', {
          type: 'update',
          filePath: '/repo/app.py',
          content: 'x = 2\ny = 3\n',
          structuredPatch: [],
        }),
      ).toBe('no change');
    });

    it('counts an update off its structured patch', () => {
      expect(
        writeSummary('The file /repo/app.py has been updated successfully.', {
          type: 'update',
          filePath: '/repo/app.py',
          content: 'x = 2\ny = 3\n',
          structuredPatch: [
            {
              oldStart: 1,
              oldLines: 2,
              newStart: 1,
              newLines: 2,
              lines: [' x = 2', '-y = 2', '+y = 3'],
            },
          ],
        }),
      ).toBe('-1 +1 lines');
    });

    it('says nothing when the file existed and the result carries no patch', () => {
      expect(
        writeSummary('The file /repo/app.py has been updated successfully.', {
          type: 'update',
          filePath: '/repo/app.py',
          content: 'x = 2\ny = 3\n',
        }),
      ).toBeNull();
      // Same when the structured result is missing entirely and only the text says so.
      expect(writeSummary('The file /repo/app.py has been updated successfully.')).toBeNull();
    });

    it('says nothing when the result says neither created nor updated', () => {
      expect(writeSummary('ok')).toBeNull();
    });

    it('makes no claim while the call is still running', () => {
      const engine = new TranscriptEngine();
      feed(
        engine,
        event('turn.started', {}),
        assistantEvent([
          {
            type: 'tool_use',
            id: 'tu-w',
            name: 'Write',
            input: { file_path: '/repo/app.py', content: 'x = 2\ny = 3\n' },
          },
        ]),
      );
      const tool = engine.getItems().find((i) => i.kind === 'tool') as ToolItem;
      expect(tool.fileChange).toBeNull();
      expect(editSummary(tool.name, tool.input, tool.fileChange)).toBeNull();
    });
  });

  it('keeps background-task tools live past the turn and finishes them on task_completed', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('turn.started', {}),
      assistantEvent([{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'sleep' } }]),
      event('turn.claude.user', {
        tool_use_result: { backgroundTaskId: 'task_1' },
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'started' }] },
      }),
      event('turn.claude.result', { is_error: false }),
    );
    const tool = engine.getItems().find((i) => i.kind === 'tool') as ToolItem;
    expect(tool).toMatchObject({ status: 'running', backgroundTaskId: 'task_1', final: false });
    expect(engine.isWorking()).toBe(true);

    feed(
      engine,
      event('turn.claude.system', {
        subtype: 'task_completed',
        task_id: 'task_1',
        summary: 'finished',
      }),
    );
    expect(tool).toMatchObject({ status: 'completed', output: 'finished', final: true });
    expect(engine.isWorking()).toBe(false);
  });

  it('cancels in-flight tools and pending prompts on interrupt, with sticky cancel', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('turn.started', {}),
      assistantEvent([
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'sleep 99' } },
      ]),
      event('agent.interrupted', {}),
    );
    const tool = engine.getItems().find((i) => i.kind === 'tool') as ToolItem;
    expect(tool.status).toBe('cancelled');

    // Claude reports an interrupted turn as an error result — render cancelled.
    feed(
      engine,
      event('turn.claude.user', {
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'rejected', is_error: true },
          ],
        },
      }),
      event('turn.claude.result', { is_error: true, subtype: 'error_during_execution' }),
    );
    expect(tool.status).toBe('cancelled');
    const turnEnd = engine.getItems().at(-1);
    expect(turnEnd).toMatchObject({ kind: 'turn-end', cancelled: true, isError: false });
  });

  it('shows the result text when nothing streamed during the turn', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('turn.started', {}),
      event('turn.claude.result', { is_error: false, result: 'Unknown command: /foo' }),
    );
    expect(
      engine.getItems().some((i) => i.kind === 'text' && i.text === 'Unknown command: /foo'),
    ).toBe(true);
    // A clean turn end adds no turn-end marker.
    expect(engine.getItems().some((i) => i.kind === 'turn-end')).toBe(false);
  });

  it('does not duplicate the failure marker when turn.failed follows an error result', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('turn.started', {}),
      event('turn.claude.result', { is_error: true, result: 'crashed' }),
      event('turn.failed', { error: 'crashed' }),
    );
    expect(engine.getItems().filter((i) => i.kind === 'turn-end')).toHaveLength(1);
  });

  it('reports a turn.failed that arrives before any turn activity', () => {
    const engine = new TranscriptEngine();
    feed(engine, event('turn.failed', { error: 'launch failed' }));
    expect(engine.getItems().at(-1)).toMatchObject({
      kind: 'turn-end',
      isError: true,
      detail: 'launch failed',
    });
  });

  it('appends a failed turn-end with detail on turn.failed', () => {
    const engine = new TranscriptEngine();
    feed(engine, event('turn.started', {}), event('turn.failed', { error: 'exit status 1' }));
    expect(engine.getItems().at(-1)).toMatchObject({
      kind: 'turn-end',
      isError: true,
      detail: 'exit status 1',
    });
  });

  it('does not duplicate the turn-end when result and turn.completed both arrive', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('turn.started', {}),
      assistantEvent([{ type: 'text', text: 'hi' }]),
      event('agent.interrupted', {}),
      event('turn.claude.result', { is_error: true }),
      event('turn.completed', {}),
    );
    expect(engine.getItems().filter((i) => i.kind === 'turn-end')).toHaveLength(1);
  });

  describe('AskUserQuestion', () => {
    const questionRequest = () =>
      event('turn.claude.control_request', {
        request_id: 'req_1',
        request: {
          subtype: 'can_use_tool',
          tool_name: 'AskUserQuestion',
          tool_use_id: 'tu_q',
          input: {
            questions: [
              {
                question: 'Which auth method?',
                header: 'Auth',
                multiSelect: false,
                options: [{ label: 'OAuth' }, { label: 'API keys' }],
              },
            ],
          },
        },
      });

    it('surfaces a pending question and resolves it from the stream echo', () => {
      const engine = new TranscriptEngine();
      feed(engine, event('turn.started', {}), questionRequest());
      const pending = engine.getPendingInteraction();
      expect(pending?.kind).toBe('question');
      expect((pending as QuestionItem).questions[0].options).toHaveLength(2);
      expect(engine.getStableCount()).toBe(0);

      feed(
        engine,
        event('turn.claude.control_response', {
          response: {
            subtype: 'success',
            request_id: 'req_1',
            response: {
              behavior: 'allow',
              updatedInput: { answers: { 'Which auth method?': 'OAuth' } },
            },
          },
        }),
      );
      expect(engine.getPendingInteraction()).toBeNull();
      const question = engine.getItems().find((i) => i.kind === 'question') as QuestionItem;
      expect(question.outcome).toEqual({
        status: 'answered',
        answers: { 'Which auth method?': 'OAuth' },
      });
      expect(question.final).toBe(true);
    });

    it('resolves locally (before the echo) and ignores the later echo', () => {
      const engine = new TranscriptEngine();
      feed(engine, questionRequest());
      engine.resolveQuestionLocally('req_1', 'answered', { 'Which auth method?': 'API keys' });
      feed(
        engine,
        event('turn.claude.control_response', {
          response: {
            subtype: 'success',
            request_id: 'req_1',
            response: { behavior: 'allow', updatedInput: { answers: {} } },
          },
        }),
      );
      const question = engine.getItems().find((i) => i.kind === 'question') as QuestionItem;
      expect(question.outcome?.answers).toEqual({ 'Which auth method?': 'API keys' });
    });

    it('expires an unanswered question when the turn dies', () => {
      const engine = new TranscriptEngine();
      feed(
        engine,
        event('turn.started', {}),
        questionRequest(),
        event('agent.interrupted', {}),
        event('turn.claude.result', { is_error: true }),
      );
      const question = engine.getItems().find((i) => i.kind === 'question') as QuestionItem;
      expect(question.outcome?.status).toBe('expired');
      expect(engine.getPendingInteraction()).toBeNull();
    });

    it('ignores malformed question payloads and user-origin control requests', () => {
      const engine = new TranscriptEngine();
      feed(
        engine,
        event('turn.claude.control_request', {
          request_id: 'req_bad',
          request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { nope: 1 } },
        }),
        event(
          'turn.claude.control_request',
          {
            request_id: 'req_echo',
            request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} },
          },
          { origin: 'USER_EVENT' },
        ),
        event('turn.claude.control_request', {
          request_id: 'req_init',
          request: { subtype: 'initialize' },
        }),
      );
      expect(engine.getItems()).toHaveLength(0);
    });
  });

  describe('permission requests', () => {
    it('surfaces can_use_tool requests and records the local decision', () => {
      const engine = new TranscriptEngine();
      feed(
        engine,
        event('turn.claude.control_request', {
          request_id: 'req_2',
          request: {
            subtype: 'can_use_tool',
            tool_name: 'Bash',
            tool_use_id: 'tu_2',
            input: { command: 'rm -rf /tmp/x' },
          },
        }),
      );
      const pending = engine.getPendingInteraction() as PermissionItem;
      expect(pending).toMatchObject({ kind: 'permission', toolName: 'Bash' });

      engine.resolvePermissionLocally('req_2', 'allowed');
      expect(engine.getPendingInteraction()).toBeNull();
      expect(pending.decision).toBe('allowed');
    });

    it('resolves a permission from the stream echo (answered on the web)', () => {
      const engine = new TranscriptEngine();
      feed(
        engine,
        event('turn.claude.control_request', {
          request_id: 'req_3',
          request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} },
        }),
        event('turn.claude.control_response', {
          response: {
            subtype: 'success',
            request_id: 'req_3',
            response: { behavior: 'deny', message: 'User denied the request' },
          },
        }),
      );
      const item = engine.getItems()[0] as PermissionItem;
      expect(item.decision).toBe('denied');
    });
  });

  it('folds agent.setup events into one setup item that completes on the first protocol event', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('agent.setup', {
        step: 'init',
        detail: JSON.stringify([
          { id: 'creating_devbox', label: 'Provision devbox' },
          { id: 'code_server', label: 'code-server' },
        ]),
      }),
      event('agent.setup', { step: 'creating_devbox', durationMs: 9000 }),
      event('agent.setup', { step: 'code_server', terminal: false }),
      event('devbox.running', {}),
    );
    let setup = engine.getItems().find((i) => i.kind === 'setup') as SetupItem;
    expect(setup.final).toBe(false);
    expect(setup.steps).toEqual([
      { id: 'creating_devbox', label: 'Provision devbox', status: 'done' },
      { id: 'code_server', label: 'code-server', status: 'running' },
    ]);

    feed(engine, event('turn.claude.system', { subtype: 'init', tools: [] }));
    setup = engine.getItems().find((i) => i.kind === 'setup') as SetupItem;
    expect(setup.final).toBe(true);
    expect(setup.steps.every((s) => s.status === 'done')).toBe(true);
  });

  it('tracks PRs across their lifecycle and enriches the banners', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('agent.pr_created', {
        agentId: 'agt_1',
        url: 'https://github.com/acme/app/pull/12',
        number: 12,
        title: 'Fix leak',
        repo: 'acme/app',
        branch: 'fix-leak',
      }),
    );
    expect(engine.getPrLinks()).toEqual([
      {
        url: 'https://github.com/acme/app/pull/12',
        number: 12,
        title: 'Fix leak',
        repo: 'acme/app',
        status: 'open',
      },
    ]);
    const created = engine.getItems().at(-1);
    expect(created).toMatchObject({
      kind: 'banner',
      label: 'Pull request opened',
      detail: '#12 Fix leak\nhttps://github.com/acme/app/pull/12',
    });

    feed(
      engine,
      event('agent.pr_merged', {
        agentId: 'agt_1',
        url: 'https://github.com/acme/app/pull/12',
        number: 12,
        title: 'Fix leak',
        repo: 'acme/app',
      }),
    );
    expect(engine.getPrLinks()[0].status).toBe('merged');
    expect(engine.getItems().at(-1)).toMatchObject({
      label: 'Pull request merged',
      detail: '#12 Fix leak',
    });
  });

  it('labels daemon banners with the registered name and port', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('agent.daemon_started', { agentId: 'agt_1', name: 'storybook', port: 6006 }),
    );
    expect(engine.getItems().at(-1)).toMatchObject({
      kind: 'banner',
      label: 'Daemon started',
      detail: 'storybook :6006 — ^o to open',
    });
  });

  it('maps lifecycle events to banners and stderr lines to logs', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('agent.error', { errorType: 'stderr', message: 'npm WARN deprecated' }),
      event('agent.pr_created', {}),
      event('agent.complete', { summary: 'All done' }),
    );
    expect(engine.getItems().map((i) => i.kind)).toEqual(['log', 'banner', 'banner']);
    expect(engine.getItems()[2]).toMatchObject({ label: 'Agent complete', detail: 'All done' });
    expect(engine.isWorking()).toBe(false);
  });

  it('processes replayed events exactly once', () => {
    const engine = new TranscriptEngine();
    const prompt = event('query', { message: { role: 'user', content: 'hello' } });
    feed(engine, prompt, prompt, prompt);
    expect(engine.getItems()).toHaveLength(1);
  });

  it('keeps the stable prefix monotonic while items finalize out of order', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('query', { message: { role: 'user', content: 'go' } }),
      assistantEvent([
        { type: 'tool_use', id: 'a', name: 'Read', input: { file_path: '/x' } },
        { type: 'tool_use', id: 'b', name: 'Read', input: { file_path: '/y' } },
      ]),
    );
    expect(engine.getStableCount()).toBe(1); // just the user message

    // Second tool finishes first — prefix must not jump past the first tool.
    feed(
      engine,
      event('turn.claude.user', {
        message: { content: [{ type: 'tool_result', tool_use_id: 'b', content: 'y!' }] },
      }),
    );
    expect(engine.getStableCount()).toBe(1);

    feed(
      engine,
      event('turn.claude.user', {
        message: { content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x!' }] },
      }),
    );
    expect(engine.getStableCount()).toBe(3);
  });

  it('handles ACP chunks, tool calls, and plans', () => {
    const engine = new TranscriptEngine();
    feed(
      engine,
      event('session/update', {
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi ' } },
      }),
      event('session/update', {
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'there' } },
      }),
      event('session/update', {
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'acp1',
          title: 'read file',
          rawInput: { path: '/etc/hosts' },
        },
      }),
      event('session/update', {
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'acp1',
          status: 'completed',
          content: [{ type: 'text', text: 'contents' }],
        },
      }),
      event('session/update', {
        update: { sessionUpdate: 'plan', entries: [{ content: 'do it', status: 'pending' }] },
      }),
    );
    const kinds = engine.getItems().map((i) => i.kind);
    expect(kinds).toEqual(['text', 'tool', 'plan']);
    expect(engine.getItems()[0]).toMatchObject({ text: 'Hi there' });
    expect(engine.getItems()[1]).toMatchObject({ status: 'completed', output: 'contents' });
  });

  it('renders generic agent message events', () => {
    const engine = new TranscriptEngine();
    feed(engine, event('message', { role: 'agent', message: 'plain reply' }));
    expect(engine.getItems()[0]).toMatchObject({ kind: 'text', text: 'plain reply', final: true });
  });
});
