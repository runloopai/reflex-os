/**
 * Live agent status derived from the event stream.
 *
 * The polled agent record (`getAgent().status`) can go stale: deployments
 * sometimes leave it on `running` after a turn ends, and it says nothing
 * about a suspended devbox. The stream knows better — turn boundaries,
 * devbox lifecycle, status changes — so this module folds stream events
 * into a small state and combines it with the record into the status a UI
 * should actually show.
 *
 * Pure and transport-agnostic: feed every event from `ReflexSocket` (or
 * any other stream source) through `reduceAgentLiveness` in arrival order.
 * Replayed history is safe — subscribing replays the stream's full past on
 * every (re)connect, and events stamped before what the state has already
 * seen are ignored. Detect turn boundaries by comparing snapshots with
 * `turnEndedBetween`.
 */
import type { AgentStatus } from './generated/model/index.js';

export interface AgentLivenessState {
  /** Newest event timestamp folded in; older events are ignored. */
  newestEventAt: number;
  /** Whether the stream currently shows a turn executing. */
  turnActive: boolean;
  /** Timestamp of the newest turn boundary (completed/cancelled/failed). */
  lastTurnEndedAt: number | null;
  /** Whether the stream's last word was a devbox suspension. */
  devboxAsleep: boolean;
  /** Status carried by the newest agent.status_change event, if any. */
  streamStatus: AgentStatus | null;
}

/** The record's statuses plus the stream-only `suspended` state. */
export type LiveAgentStatus = AgentStatus | 'suspended';

/** The slice of a stream event the reducer reads. */
export interface AgentLivenessEvent {
  type: string;
  timestamp?: number;
  payload?: unknown;
}

/**
 * The runner republishes native Claude Code SDK frames under a
 * `turn.claude.` prefix, so `assistant` can arrive as either. Strip it
 * before matching rather than listing both spellings everywhere.
 */
const CLAUDE_EVENT_PREFIX = 'turn.claude.';
function protocolType(type: string): string {
  return type.startsWith(CLAUDE_EVENT_PREFIX) ? type.slice(CLAUDE_EVENT_PREFIX.length) : type;
}

/**
 * Events that end the current turn (the agent is idle afterwards).
 *
 * Each protocol's own terminal is here next to the broker-synthesized
 * `turn.*` events, because the dotted ones are not guaranteed: a Codex
 * stream ends its turn with `turn/completed` and a native Claude Code
 * stream with `result` (the same signal Reflex's own boot rehydration
 * reads). Miss those and a finished turn looks like it is still running —
 * or, worse, a running one looks finished, because nothing ever recorded
 * that a turn was in flight at all.
 */
const TURN_END_TYPES = new Set([
  'turn.completed',
  'turn.cancelled',
  'turn.failed',
  'agent.complete',
  'agent.need_input',
  'agent.interrupted',
  'agent.stopped',
  'agent.killed',
  // Native Codex app-server.
  'turn/completed',
  // Native Claude Code SDK.
  'result',
]);

/** Whether an event type means the current turn just ended. */
export function isTurnEndEventType(type: string): boolean {
  return TURN_END_TYPES.has(protocolType(type));
}

/**
 * Events only an executing turn emits, across every stream dialect: turn
 * protocol boundaries, ACP session updates, native Claude Code SDK
 * messages, native Codex item frames, flat messages/chunks/tool calls, and
 * agent-level signals — the same set Reflex's first-party UI treats as
 * "working". Their presence means the agent is working now.
 */
const TURN_ACTIVITY_TYPES = new Set([
  'turn.started',
  'session/update',
  'message',
  'agent_message_chunk',
  'agent_thought_chunk',
  'tool_call',
  'tool_call_update',
  'plan',
  'agent.plan',
  'agent.tool_use',
  // Native Claude Code SDK: the prompt, the assistant's messages, tool
  // results (`user`), streamed deltas, and permission round-trips.
  'query',
  'assistant',
  'user',
  'stream_event',
  'control_request',
  'control_response',
  // Native Codex app-server: the prompt frames that open (or steer) a turn,
  // plus the content and work frames of one in flight.
  'turn/started',
  'turn/start',
  'turn/steer',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
]);

/** Record statuses that outrank anything the stream says. */
const AUTHORITATIVE_RECORD_STATUSES = new Set<AgentStatus>([
  'stopping',
  'stopped',
  'terminated',
  'error',
]);

export function initialAgentLiveness(): AgentLivenessState {
  return {
    newestEventAt: 0,
    turnActive: false,
    lastTurnEndedAt: null,
    devboxAsleep: false,
    streamStatus: null,
  };
}

/** The event payload as an object, decoding JSON strings along the way. */
function parsePayload(payload: unknown): Record<string, unknown> | null {
  let value = payload;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

/** The `status` string inside an agent.status_change payload, if present. */
function statusFromPayload(payload: unknown): AgentStatus | null {
  const status = parsePayload(payload)?.['status'];
  return typeof status === 'string' ? (status as AgentStatus) : null;
}

/**
 * Fold one stream event into the state. Events without a timestamp, or
 * stamped before what the state has already seen, are ignored — that is
 * what makes reconnect replays and out-of-order delivery safe.
 */
export function reduceAgentLiveness(
  state: AgentLivenessState,
  event: AgentLivenessEvent,
): AgentLivenessState {
  const ts = typeof event.timestamp === 'number' ? event.timestamp : null;
  if (ts === null || ts < state.newestEventAt) return state;

  const next: AgentLivenessState = { ...state, newestEventAt: ts };
  // A stream that is emitting is awake; only a suspension says otherwise.
  next.devboxAsleep = event.type === 'devbox.suspended';

  const type = protocolType(event.type);
  if (TURN_END_TYPES.has(type)) {
    next.turnActive = false;
    next.lastTurnEndedAt = ts;
  } else if (TURN_ACTIVITY_TYPES.has(type)) {
    next.turnActive = true;
  } else if (event.type === 'devbox.suspended' || event.type === 'devbox.shutdown') {
    // Suspension/shutdown ends the active turn: a suspended devbox resumes
    // only on the next message (the same rule as Reflex's first-party UI).
    if (state.turnActive) {
      next.turnActive = false;
      next.lastTurnEndedAt = ts;
    }
  } else if (event.type === 'session/prompt') {
    // ACP: a prompt post starts a turn; the response carries a stop reason
    // and is the protocol's native terminal — recognized in case the
    // broker's derived turn.completed is delayed or absent.
    const payload = parsePayload(event.payload);
    if (
      typeof payload?.['stopReason'] === 'string' ||
      typeof payload?.['stop_reason'] === 'string'
    ) {
      next.turnActive = false;
      next.lastTurnEndedAt = ts;
    } else if (Array.isArray(payload?.['prompt'])) {
      next.turnActive = true;
    }
  } else if (event.type === 'agent.progress') {
    if (parsePayload(event.payload)?.['status'] === 'in_progress') next.turnActive = true;
  } else if (event.type === 'agent.status_change') {
    const status = statusFromPayload(event.payload);
    if (status) {
      next.streamStatus = status;
      next.turnActive = status === 'running';
      if (!next.turnActive && state.turnActive) next.lastTurnEndedAt = ts;
    }
  }
  return next;
}

/**
 * The status a UI should show, combining the polled record with the
 * stream's evidence:
 *
 * - a stopped/stopping/terminated/errored record is authoritative;
 * - a devbox whose last stream word was a suspension is `suspended`;
 * - stream turn activity means `running`, whatever the record says;
 * - a `running` record after the stream showed the turn end is stale and
 *   reads as `needs_input`;
 * - otherwise the record (falling back to the stream's last status change).
 */
export function deriveAgentStatus(
  state: AgentLivenessState,
  recordStatus: AgentStatus | null,
): LiveAgentStatus {
  const record = recordStatus ?? state.streamStatus;
  if (record && AUTHORITATIVE_RECORD_STATUSES.has(record)) return record;
  if (state.devboxAsleep) return 'suspended';
  if (state.turnActive) return 'running';
  if (record === 'running' && state.lastTurnEndedAt !== null) return 'needs_input';
  return record ?? 'needs_input';
}

/** Whether a turn ended between two states — for "on turn end" reactions. */
export function turnEndedBetween(prev: AgentLivenessState, next: AgentLivenessState): boolean {
  return next.lastTurnEndedAt !== null && next.lastTurnEndedAt !== prev.lastTurnEndedAt;
}
