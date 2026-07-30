import { describe, expect, it } from 'vitest';
import {
  deriveAgentStatus,
  initialAgentLiveness,
  isTurnEndEventType,
  reduceAgentLiveness,
  turnEndedBetween,
  type AgentLivenessEvent,
  type AgentLivenessState,
} from '../agent-liveness.js';

function fold(events: AgentLivenessEvent[], from = initialAgentLiveness()): AgentLivenessState {
  return events.reduce(reduceAgentLiveness, from);
}

describe('reduceAgentLiveness', () => {
  it('marks the turn over on turn boundaries', () => {
    const state = fold([
      { type: 'session/update', timestamp: 1_000 },
      { type: 'turn.completed', timestamp: 2_000 },
    ]);
    expect(state.turnActive).toBe(false);
    expect(state.lastTurnEndedAt).toBe(2_000);
  });

  it('treats turn activity as an executing turn and as a wake signal', () => {
    const state = fold([
      { type: 'devbox.suspended', timestamp: 1_000 },
      { type: 'tool_call', timestamp: 2_000 },
    ]);
    expect(state.turnActive).toBe(true);
    expect(state.devboxAsleep).toBe(false);
  });

  it('reads agent.status_change payloads, JSON-encoded or not', () => {
    const object = fold([
      { type: 'agent.status_change', timestamp: 1_000, payload: { status: 'running' } },
    ]);
    expect(object.streamStatus).toBe('running');
    expect(object.turnActive).toBe(true);
    const encoded = fold(
      [{ type: 'agent.status_change', timestamp: 2_000, payload: '{"status":"needs_input"}' }],
      object,
    );
    expect(encoded.streamStatus).toBe('needs_input');
    expect(encoded.turnActive).toBe(false);
    expect(encoded.lastTurnEndedAt).toBe(2_000);
  });

  it('mirrors the first-party activity rules for turn and agent signals', () => {
    // turn.started / agent.tool_use mean working; an interrupt ends the turn.
    expect(fold([{ type: 'turn.started', timestamp: 1_000 }]).turnActive).toBe(true);
    expect(fold([{ type: 'agent.tool_use', timestamp: 1_000 }]).turnActive).toBe(true);
    const interrupted = fold([
      { type: 'turn.started', timestamp: 1_000 },
      { type: 'agent.interrupted', timestamp: 2_000 },
    ]);
    expect(interrupted.turnActive).toBe(false);
    expect(interrupted.lastTurnEndedAt).toBe(2_000);
  });

  it('treats a suspension as ending the active turn', () => {
    // A devbox suspended mid-turn resumes only on the next message, so a
    // wake without fresh activity must not read as still working.
    const state = fold([
      { type: 'turn.started', timestamp: 1_000 },
      { type: 'devbox.suspended', timestamp: 2_000 },
      { type: 'devbox.running', timestamp: 3_000 },
    ]);
    expect(state.turnActive).toBe(false);
    expect(deriveAgentStatus(state, 'running')).toBe('needs_input');
  });

  it('reads session/prompt payloads: prompt posts start, stop reasons end', () => {
    const started = fold([
      { type: 'session/prompt', timestamp: 1_000, payload: { prompt: [{ type: 'text' }] } },
    ]);
    expect(started.turnActive).toBe(true);
    const ended = fold(
      [{ type: 'session/prompt', timestamp: 2_000, payload: { stopReason: 'end_turn' } }],
      started,
    );
    expect(ended.turnActive).toBe(false);
    expect(ended.lastTurnEndedAt).toBe(2_000);
    // Neither shape: inert.
    const inert = fold([{ type: 'session/prompt', timestamp: 3_000, payload: {} }], ended);
    expect(inert.turnActive).toBe(false);
  });

  it('reads agent.progress payloads: only in_progress means working', () => {
    expect(
      fold([{ type: 'agent.progress', timestamp: 1_000, payload: { status: 'in_progress' } }])
        .turnActive,
    ).toBe(true);
    expect(
      fold([{ type: 'agent.progress', timestamp: 1_000, payload: { status: 'done' } }]).turnActive,
    ).toBe(false);
  });

  it('ignores replayed history and events without timestamps', () => {
    const live = fold([
      { type: 'turn.completed', timestamp: 5_000 },
      { type: 'devbox.suspended', timestamp: 6_000 },
    ]);
    // A reconnect replays the whole stream from the start.
    const replayed = fold(
      [
        { type: 'session/update', timestamp: 1_000 },
        { type: 'turn.completed', timestamp: 5_000 },
        { type: 'devbox.suspended', timestamp: 6_000 },
      ],
      live,
    );
    expect(replayed).toEqual(live);
    expect(fold([{ type: 'turn.completed' }], live)).toEqual(live);
  });

  it('follows a native Claude Code turn from query to result', () => {
    // The native dialect never emits the flat/ACP activity events, and its
    // turn terminal is `result`. Blind to both, the state said "no turn is
    // running" for the whole turn — which is what let the arcade's queue
    // dispatch a second suggestion into a live one.
    const working = fold([
      { type: 'query', timestamp: 1_000 },
      { type: 'assistant', timestamp: 2_000 },
      { type: 'user', timestamp: 3_000 },
    ]);
    expect(working.turnActive).toBe(true);
    expect(deriveAgentStatus(working, 'needs_input')).toBe('running');

    const done = fold([{ type: 'result', timestamp: 4_000 }], working);
    expect(done.turnActive).toBe(false);
    expect(done.lastTurnEndedAt).toBe(4_000);
  });

  it('sees through the runner’s `turn.claude.` wrapper', () => {
    const working = fold([{ type: 'turn.claude.assistant', timestamp: 1_000 }]);
    expect(working.turnActive).toBe(true);
    const done = fold([{ type: 'turn.claude.result', timestamp: 2_000 }], working);
    expect(done.turnActive).toBe(false);
    expect(done.lastTurnEndedAt).toBe(2_000);
    expect(isTurnEndEventType('turn.claude.result')).toBe(true);
  });

  it('follows a native Codex turn from prompt to completion', () => {
    // Codex streams JSON-RPC frames whose type is the method; the dotted
    // `turn.completed` the other brokers synthesize may never arrive.
    const working = fold([
      { type: 'turn/start', timestamp: 1_000 },
      { type: 'item/agentMessage/delta', timestamp: 2_000 },
      { type: 'item/started', timestamp: 3_000 },
    ]);
    expect(working.turnActive).toBe(true);

    const done = fold([{ type: 'turn/completed', timestamp: 4_000 }], working);
    expect(done.turnActive).toBe(false);
    expect(done.lastTurnEndedAt).toBe(4_000);
    expect(turnEndedBetween(working, done)).toBe(true);
  });
});

describe('isTurnEndEventType', () => {
  it('covers both the broker-synthesized and native Codex turn terminals', () => {
    expect(isTurnEndEventType('turn.completed')).toBe(true);
    expect(isTurnEndEventType('turn/completed')).toBe(true);
    expect(isTurnEndEventType('turn/started')).toBe(false);
  });
});

describe('deriveAgentStatus', () => {
  it('shows suspended for a stale-running record on a suspended devbox', () => {
    // The reported bug: turn completed, devbox suspended five minutes
    // later, record still `running` — the UI said "working" forever.
    const state = fold([
      { type: 'session/update', timestamp: 1_000 },
      { type: 'turn.completed', timestamp: 2_000 },
      { type: 'agent.daemon_started', timestamp: 2_001 },
      { type: 'devbox.suspended', timestamp: 300_000 },
    ]);
    expect(deriveAgentStatus(state, 'running')).toBe('suspended');
  });

  it('downgrades a running record to needs_input once the turn ended', () => {
    const state = fold([
      { type: 'session/update', timestamp: 1_000 },
      { type: 'turn.completed', timestamp: 2_000 },
    ]);
    expect(deriveAgentStatus(state, 'running')).toBe('needs_input');
  });

  it('trusts stream turn activity over a stale idle record', () => {
    const state = fold([
      { type: 'turn.completed', timestamp: 1_000 },
      { type: 'turn.started', timestamp: 2_000 },
    ]);
    expect(deriveAgentStatus(state, 'needs_input')).toBe('running');
  });

  it('lets terminal record states outrank the stream', () => {
    const state = fold([{ type: 'devbox.suspended', timestamp: 1_000 }]);
    expect(deriveAgentStatus(state, 'stopped')).toBe('stopped');
    expect(deriveAgentStatus(state, 'error')).toBe('error');
  });

  it('trusts the record when the stream has shown nothing', () => {
    expect(deriveAgentStatus(initialAgentLiveness(), 'running')).toBe('running');
    expect(deriveAgentStatus(initialAgentLiveness(), 'starting')).toBe('starting');
  });

  it('wakes back up after devbox.running and fresh activity', () => {
    const state = fold([
      { type: 'devbox.suspended', timestamp: 1_000 },
      { type: 'devbox.running', timestamp: 2_000 },
      { type: 'session/update', timestamp: 3_000 },
    ]);
    expect(deriveAgentStatus(state, 'running')).toBe('running');
  });
});

describe('turnEndedBetween', () => {
  it('detects exactly the transitions where a turn ended', () => {
    const before = fold([{ type: 'session/update', timestamp: 1_000 }]);
    const ended = fold([{ type: 'turn.completed', timestamp: 2_000 }], before);
    const later = fold([{ type: 'agent.daemon_started', timestamp: 3_000 }], ended);
    expect(turnEndedBetween(before, ended)).toBe(true);
    expect(turnEndedBetween(ended, later)).toBe(false);
    expect(turnEndedBetween(before, before)).toBe(false);
  });
});
