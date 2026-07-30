/**
 * The dispatcher's two judgement calls, both pure so they can be pinned
 * down here: which stream frames are live rather than replayed history
 * (a replayed `turn.cancelled` once re-queued the same finished suggestion
 * in an endless loop), and when a `running` agent record should be treated
 * as idle.
 */
import { describe, expect, it } from 'vitest';
import {
  dispatchSettlement,
  foldTurnFlags,
  looksHostBlocked,
  runningRecordIsStale,
  streamFlagUpdates,
  streamSaysTurnRunning,
} from '../server/engine.ts';
import {
  initialAgentLiveness,
  reduceAgentLiveness,
  type AgentLivenessEvent,
} from '../../../../sdk/client/src/index.ts';

const startedAt = 1_000_000;
const dispatchedAt = 1_000_500;
const baselines = { startedAt, dispatchedAt };

describe('streamFlagUpdates', () => {
  it('ignores replayed history for every flag', () => {
    for (const type of ['turn.cancelled', 'turn.failed', 'turn.completed', 'devbox.suspended']) {
      const flags = streamFlagUpdates({ type, timestamp: startedAt - 60_000 }, baselines);
      expect(flags).toEqual({
        live: false,
        turnStarted: false,
        turnCancelled: false,
        turnEnded: false,
      });
    }
  });

  it('treats fresh post-dispatch events as turn activity', () => {
    const flags = streamFlagUpdates({ type: 'assistant', timestamp: dispatchedAt + 10 }, baselines);
    expect(flags.live).toBe(true);
    expect(flags.turnStarted).toBe(true);
    expect(flags.turnCancelled).toBe(false);
  });

  it('only counts cancels newer than our own dispatch', () => {
    const before = streamFlagUpdates(
      { type: 'turn.cancelled', timestamp: dispatchedAt - 10 },
      baselines,
    );
    expect(before.turnCancelled).toBe(false);
    const after = streamFlagUpdates(
      { type: 'turn.cancelled', timestamp: dispatchedAt + 10 },
      baselines,
    );
    expect(after.turnCancelled).toBe(true);
  });

  it('ignores replayed history from a prior process (dispatchedAt still 0)', () => {
    // A restarted watcher has dispatched nothing yet; the full history it
    // replays on connect must not read as turn activity or a fresh cancel.
    const bootBaselines = { startedAt, dispatchedAt: 0 };
    const flags = streamFlagUpdates(
      { type: 'turn.cancelled', timestamp: startedAt - 60_000 },
      bootBaselines,
    );
    expect(flags.turnStarted).toBe(false);
    expect(flags.turnCancelled).toBe(false);
  });

  it('is inert for events without timestamps', () => {
    const flags = streamFlagUpdates({ type: 'turn.cancelled' }, baselines);
    expect(flags).toEqual({
      live: false,
      turnStarted: false,
      turnCancelled: false,
      turnEnded: false,
    });
  });
});

describe('streamFlagUpdates turn ends', () => {
  it('counts a turn end newer than our dispatch, even when replayed', () => {
    // Reconnects re-deliver the whole stream; an end stamped after our
    // dispatch is still evidence that OUR turn finished.
    const flags = streamFlagUpdates(
      { type: 'turn.completed', timestamp: dispatchedAt + 10 },
      baselines,
    );
    expect(flags.turnEnded).toBe(true);
  });

  it('ignores a turn end that belongs to an earlier turn', () => {
    // This is the one that cost us: the previous turn's completion is in
    // every replay, and treating it as ours re-sent live work.
    const flags = streamFlagUpdates(
      { type: 'turn.completed', timestamp: dispatchedAt - 10 },
      baselines,
    );
    expect(flags.turnEnded).toBe(false);
  });

  it('does not read ordinary activity as a turn end', () => {
    const flags = streamFlagUpdates({ type: 'tool_call', timestamp: dispatchedAt + 10 }, baselines);
    expect(flags.turnEnded).toBe(false);
  });

  it('re-queues on a Codex turn that was interrupted or failed', () => {
    // Codex has ONE terminal frame; how the turn went is in the payload.
    // Without reading it, a cut-short turn settles its suggestion as done
    // and the work is silently dropped.
    const codexEnd = (status: string) =>
      streamFlagUpdates(
        {
          type: 'turn/completed',
          timestamp: dispatchedAt + 10,
          payload: { method: 'turn/completed', params: { turn: { status } } },
        },
        baselines,
      );
    expect(codexEnd('interrupted').turnCancelled).toBe(true);
    expect(codexEnd('failed').turnCancelled).toBe(true);
    expect(codexEnd('completed').turnCancelled).toBe(false);
    // Payloads cross REST/SSE boundaries as JSON strings.
    const encoded = streamFlagUpdates(
      {
        type: 'turn/completed',
        timestamp: dispatchedAt + 10,
        payload: JSON.stringify({ params: { turn: { status: 'interrupted' } } }),
      },
      baselines,
    );
    expect(encoded.turnCancelled).toBe(true);
  });

  it('counts native Codex `turn/completed`, the only end a Codex stream sends', () => {
    const ended = streamFlagUpdates(
      { type: 'turn/completed', timestamp: dispatchedAt + 10 },
      baselines,
    );
    expect(ended.turnEnded).toBe(true);
    const working = streamFlagUpdates(
      { type: 'item/agentMessage/delta', timestamp: dispatchedAt + 10 },
      baselines,
    );
    expect(working.turnEnded).toBe(false);
    expect(working.turnStarted).toBe(true);
  });
});

/**
 * The bug this file exists to prevent, end to end at the predicate level:
 * a suggestion is dispatched, the agent works, and the queue must not send
 * anything else until the stream says that turn is over. The dispatcher
 * asks `reduceAgentLiveness` — so a dialect whose events it does not know
 * reads as "no turn running", and the queue sends the same suggestion again
 * under the live one. That is what happened on both `codex` and native
 * `claude-code` streams.
 */
describe('a turn in flight blocks dispatch, on every dialect', () => {
  const streams: Record<string, AgentLivenessEvent[]> = {
    'native claude-code': [
      { type: 'query', timestamp: 1_000 },
      { type: 'assistant', timestamp: 2_000 },
      { type: 'user', timestamp: 3_000 },
    ],
    'native claude-code (turn.claude. wrapped)': [
      { type: 'turn.claude.query', timestamp: 1_000 },
      { type: 'turn.claude.assistant', timestamp: 2_000 },
    ],
    'native codex': [
      { type: 'turn/start', timestamp: 1_000 },
      { type: 'item/agentMessage/delta', timestamp: 2_000 },
      { type: 'item/started', timestamp: 3_000 },
    ],
    acp: [
      { type: 'session/update', timestamp: 1_000 },
      { type: 'tool_call', timestamp: 2_000 },
    ],
  };
  const ends: Record<string, AgentLivenessEvent> = {
    'native claude-code': { type: 'result', timestamp: 9_000 },
    'native claude-code (turn.claude. wrapped)': { type: 'turn.claude.result', timestamp: 9_000 },
    'native codex': { type: 'turn/completed', timestamp: 9_000 },
    acp: { type: 'turn.completed', timestamp: 9_000 },
  };

  for (const [dialect, events] of Object.entries(streams)) {
    it(`holds the queue during a ${dialect} turn and frees it at the end`, () => {
      const working = events.reduce(reduceAgentLiveness, initialAgentLiveness());
      expect(streamSaysTurnRunning(working, 0)).toBe(true);
      expect(runningRecordIsStale(working, false, 'running', 0)).toBe(false);

      const done = reduceAgentLiveness(working, ends[dialect]!);
      expect(streamSaysTurnRunning(done, 0)).toBe(false);
      expect(done.lastTurnEndedAt).toBe(9_000);
    });
  }
});

describe('foldTurnFlags', () => {
  const fresh = { turnStarted: false, turnCancelled: false, sawTurnEnd: false };
  const frame = (over: Partial<ReturnType<typeof streamFlagUpdates>> = {}) => ({
    live: true,
    turnStarted: false,
    turnCancelled: false,
    turnEnded: false,
    ...over,
  });

  it('lets a completion clear an earlier failure in the same turn', () => {
    // The repeated-send bug: one transient `turn.failed` (a retried model
    // call, a broker reconnect) latched `turnCancelled` for the whole
    // dispatch, so the turn that then finished the work still put its
    // suggestion back in the queue — and the agent was sent it again.
    const started = foldTurnFlags(fresh, frame({ turnStarted: true }));
    const failed = foldTurnFlags(started, frame({ turnCancelled: true, turnEnded: true }));
    expect(failed.turnCancelled).toBe(true);

    const completed = foldTurnFlags(failed, frame({ turnEnded: true }));
    expect(completed.turnCancelled).toBe(false);
    expect(completed.sawTurnEnd).toBe(true);
    expect(completed.turnStarted).toBe(true);
  });

  it('keeps a cancel that nothing supersedes', () => {
    const cancelled = foldTurnFlags(fresh, frame({ turnCancelled: true, turnEnded: true }));
    // Ordinary activity after the cancel must not clear it.
    expect(foldTurnFlags(cancelled, frame({ turnStarted: true })).turnCancelled).toBe(true);
  });

  it('ignores replayed frames, which carry no flags at all', () => {
    expect(foldTurnFlags(fresh, frame({ live: false }))).toEqual(fresh);
  });
});

describe('dispatchSettlement', () => {
  const fresh = { turnStarted: false, turnCancelled: false, sawTurnEnd: false };

  it('ships a turn the stream watched start and finish', () => {
    expect(dispatchSettlement({ ...fresh, turnStarted: true, sawTurnEnd: true })).toBe('done');
  });

  it('re-queues a turn that was cut short', () => {
    // Interrupt, `turn.failed`, a Codex turn that reports `interrupted`.
    expect(dispatchSettlement({ turnStarted: true, sawTurnEnd: true, turnCancelled: true })).toBe(
      'approved',
    );
  });

  it('re-queues a turn that never started or never ended', () => {
    // Never picked up: the message was lost, so nothing was built.
    expect(dispatchSettlement({ ...fresh, sawTurnEnd: true })).toBe('approved');
    // Started but no end in sight — a devbox that suspended mid-turn. The
    // work is unfinished however long the record goes on saying `running`.
    expect(dispatchSettlement({ ...fresh, turnStarted: true })).toBe('approved');
  });

  it('ships a finished turn whose agent record still reads running', () => {
    // The bug this exists for. A Codex turn ran two seconds and completed
    // cleanly; the polled record stayed `running` for another 45s, so the
    // stale-record path fired and settled the suggestion as `approved` — the
    // card sat under "in progress" and the agent was sent the same
    // suggestion again. The stream's own frames are the whole story here.
    const dispatched = { startedAt, dispatchedAt };
    const turn = [
      { type: 'turn/start', timestamp: dispatchedAt + 1 },
      { type: 'item/started', timestamp: dispatchedAt + 500 },
      { type: 'item/completed', timestamp: dispatchedAt + 900 },
      {
        type: 'turn/completed',
        timestamp: dispatchedAt + 2_000,
        payload: { method: 'turn/completed', params: { turn: { status: 'completed' } } },
      },
    ];
    const flags = turn.reduce(
      (state, event) => foldTurnFlags(state, streamFlagUpdates(event, dispatched)),
      { turnStarted: false, turnCancelled: false, sawTurnEnd: false },
    );
    expect(dispatchSettlement(flags)).toBe('done');

    // ...and the stale-record path, which runs on the same bookkeeping, has
    // nothing left in flight to re-queue by the time it fires.
    const liveness = turn.reduce(reduceAgentLiveness, initialAgentLiveness());
    expect(runningRecordIsStale(liveness, flags.sawTurnEnd, 'needs_input', 45_000)).toBe(true);
  });
});

describe('runningRecordIsStale', () => {
  const working = { turnActive: true, devboxAsleep: false };
  const idle = { turnActive: false, devboxAsleep: false };
  const asleep = { turnActive: false, devboxAsleep: true };
  const hour = 60 * 60_000;
  const LIVE_END = true;
  const ONLY_REPLAYED = false;

  it('never interrupts a turn the stream shows as executing, however quiet', () => {
    // A long build or model call emits nothing for many minutes; a silence
    // timeout read that as a hung agent and re-sent the suggestion mid-turn.
    expect(runningRecordIsStale(working, LIVE_END, 'running', hour)).toBe(false);
  });

  it('frees the queue once a LIVE turn end has settled', () => {
    expect(runningRecordIsStale(idle, LIVE_END, 'needs_input', 60_000)).toBe(true);
  });

  it('waits out the settle window so a just-started turn is not cut off', () => {
    // The record is polled over REST while activity arrives over the socket:
    // a turn that just started reads `running` a moment before its first
    // event lands, while the stream's last word is the previous turn's end.
    expect(runningRecordIsStale(idle, LIVE_END, 'needs_input', 2_000)).toBe(false);
  });

  it('does not trust a turn end that only came from replayed history', () => {
    // The bug this exists for: subscribing replays the whole stream, so a
    // watcher that just restarted always holds an old `turn.completed`.
    // Acting on it re-queued the suggestion the agent was working on and
    // sent it again — the same work, two and three times over.
    expect(runningRecordIsStale(idle, ONLY_REPLAYED, 'needs_input', 60_000)).toBe(false);
    // It still gives way eventually, in case the agent really is hung.
    expect(runningRecordIsStale(idle, ONLY_REPLAYED, 'needs_input', 16 * 60_000)).toBe(true);
  });

  it('treats a suspended devbox as idle without waiting', () => {
    // No settle window here: the suspension IS the stream's newest word.
    expect(runningRecordIsStale(asleep, ONLY_REPLAYED, 'suspended', 0)).toBe(true);
  });

  it('falls back to a long silence timeout when the stream is uninformative', () => {
    expect(runningRecordIsStale(idle, ONLY_REPLAYED, 'running', 5 * 60_000)).toBe(false);
    expect(runningRecordIsStale(idle, ONLY_REPLAYED, 'running', 16 * 60_000)).toBe(true);
  });
});

describe('streamSaysTurnRunning', () => {
  it('holds the queue while the stream is actively working', () => {
    // The record is polled over REST and can still read idle for a turn
    // that already started; dispatching then doubles up on a live turn.
    expect(streamSaysTurnRunning({ turnActive: true }, 1_000)).toBe(true);
  });

  it('yields to the record once the stream has gone quiet', () => {
    // Otherwise a `turnActive` whose end event we missed wedges the queue.
    expect(streamSaysTurnRunning({ turnActive: true }, 60_000)).toBe(false);
  });

  it('never holds the queue when the stream shows no turn', () => {
    expect(streamSaysTurnRunning({ turnActive: false }, 0)).toBe(false);
  });
});

describe('looksHostBlocked', () => {
  it('recognizes the Vite allowedHosts rejection page', () => {
    const body =
      'Blocked request. This host ("5173-abc.tunnel.runloop.ai") is not allowed.\n' +
      'To allow this host, add "5173-abc.tunnel.runloop.ai" to `server.allowedHosts` in vite.config.js.';
    expect(looksHostBlocked(403, body)).toBe(true);
  });

  it('ignores healthy pages and other errors', () => {
    expect(looksHostBlocked(200, '<!doctype html><title>My game</title>')).toBe(false);
    // A game page that merely mentions blocking is not a 403.
    expect(looksHostBlocked(200, 'Blocked request minigame')).toBe(false);
    expect(looksHostBlocked(404, 'not found')).toBe(false);
    expect(looksHostBlocked(500, 'boom')).toBe(false);
  });
});
