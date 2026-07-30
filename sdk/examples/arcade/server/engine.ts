/**
 * Game engine: one watcher per game, each holding a WebSocket to the Reflex
 * event stream (authenticated with the owner's key) plus the suggestion
 * dispatcher that advances the queue whenever the agent finishes a turn.
 *
 * Suggestion lifecycle (the dispatcher's contract):
 *
 * - When the agent is idle (needs_input / completed / interrupted) and a
 *   working slot is free, the top approved suggestion (hearts first) is
 *   sent as a turn and marked `working`.
 * - The turn is considered started once any stream event newer than the
 *   dispatch arrives (or the agent reports `running`). Until then the
 *   suggestion is only staged: idle reports never complete it, and if the
 *   turn never starts within the grace window it reverts to `approved` and
 *   is re-sent.
 * - When the agent goes idle after a started turn, the working suggestion
 *   becomes `done` — unless the turn was cancelled or failed (interrupt,
 *   `turn.failed`), in which case it reverts to `approved` and re-queues.
 *   The stream, not the polled record, decides that: once it has shown this
 *   dispatch's turn start and clean end the suggestion is settled straight
 *   away, because the record can go on saying `running` for minutes after.
 * - Only one suggestion is in flight at a time, and each dispatch CLAIMS
 *   its suggestion (`approved -> working` only while still approved), so a
 *   rejection racing the dispatcher is never overwritten and a rejected
 *   suggestion is never sent.
 * - Reconnects replay the stream's full history; `streamFlagUpdates`
 *   discards events stamped at or before the dispatch so a replayed old
 *   `turn.completed`/`turn.cancelled` can neither settle the staged
 *   suggestion nor re-queue (and double-send) it.
 */
import WebSocket from 'ws';
import type { ArcadeDb, GameRow, SuggestionStatus } from './db.ts';
import type { EventHub } from './events.ts';
import { publicGame } from './events.ts';
import {
  fetchAgent,
  hostFixPrompt,
  sendMessageToAgent,
  suggestionPrompt,
  type ReflexCredentials,
} from './reflex.ts';
import type { Agent, AgentStatus, LiveAgentStatus } from '../../../../sdk/client/src/index.ts';
import {
  ReflexApiError,
  deriveAgentStatus,
  initialAgentLiveness,
  isTurnEndEventType,
  reduceAgentLiveness,
} from '../../../../sdk/client/src/index.ts';

// `interrupted` counts as idle: the agent accepts a new turn, and freezing
// the queue after a stop press was the fastest way to "break" dispatch.
const IDLE_STATUSES = new Set<AgentStatus>(['needs_input', 'completed', 'interrupted']);
const STOPPED_STATUSES = new Set<AgentStatus>(['stopping', 'stopped', 'terminated']);

/**
 * Stream event types that should trigger a refresh + dispatch check, beyond
 * the turn terminals the SDK already knows (`isTurnEndEventType`).
 */
const ADVANCE_EVENT_TYPES = new Set([
  'agent.status_change',
  'agent.daemon_started',
  'agent.dev_server',
  'agent.error',
  'devbox.running',
  'devbox.suspended',
  'devbox.shutdown',
  'devbox.failed',
]);

/** Whether an event should wake the dispatcher. */
function isAdvanceEvent(type: string): boolean {
  return ADVANCE_EVENT_TYPES.has(type) || isTurnEndEventType(type);
}

/**
 * Art contract with the agent: two files served by its dev daemon under
 * /arcade/, hand-authored SVG (or PNG) — see GAME_AGENT_SYSTEM_PROMPT. The
 * watcher captures them into the database so tiles keep their art while
 * the devbox sleeps.
 */
const ART_KINDS = [
  { field: 'previewArt', paths: ['arcade/preview.svg', 'arcade/preview.png'], maxBytes: 400_000 },
  { field: 'iconArt', paths: ['arcade/icon.svg', 'arcade/icon.png'], maxBytes: 150_000 },
  {
    field: 'previewAnimArt',
    paths: ['arcade/preview-anim.svg', 'arcade/preview.gif', 'arcade/preview.webp'],
    maxBytes: 600_000,
  },
] as const;
const ART_CONTENT_TYPES = /^image\/(svg\+xml|png|jpeg|webp|gif)/;
const ART_PROBE_MIN_INTERVAL_MS = 15_000;

const RECONCILE_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
// Real devboxes can take minutes to resume from a cold start; a short grace
// window here made the dispatcher mark suggestions done before the agent
// had even begun (and then double-dispatch into the running turn).
const TURN_START_GRACE_MS = 5 * 60_000;
// Last-resort timeout for a `running` record the stream has said NOTHING
// about — no turn activity, no turn end, no suspension (a watcher that
// connected to a stream with no useful history, or an agent that hung
// before emitting anything). Whether a turn is really in flight is
// otherwise decided by the stream, not by a stopwatch: silence is not
// idleness, and a real agent is routinely quiet for many minutes during a
// long build or model call. Interrupting one of those re-queues its
// suggestion and sends it again, so this fallback is deliberately generous.
const UNKNOWN_TURN_SILENCE_MS = 15 * 60_000;
// How long the stream must stay quiet before a `running` record whose turn
// the stream already saw end is called stale. Covers the REST-vs-socket
// delivery race on a turn that just started; see `runningRecordIsStale`.
const STALE_RECORD_SETTLE_MS = 30_000;
// Re-queue safety valve: a suggestion auto-re-queued this many times is
// settled as done instead — whatever the state bug, it must not ping-pong
// the same work at the agent forever.
const MAX_DISPATCHES_PER_SUGGESTION = 3;
// The iframe reaches the daemon through the tunnel hostname; a Vite dev
// server missing `allowedHosts: true` answers that with a 403 "Blocked
// request" page. The watcher probes for it and sends the agent a fix-it
// turn: probe cheaply, nudge rarely.
const HOST_PROBE_MIN_INTERVAL_MS = 60_000;
const HOST_FIX_NUDGE_MIN_INTERVAL_MS = 15 * 60_000;

/** Vite's allowedHosts rejection: the daemon answered, but with the blocked-host page. */
export function looksHostBlocked(status: number, body: string): boolean {
  return status === 403 && /blocked request|is not allowed/i.test(body);
}

/**
 * Whether a native Codex turn ended badly. Codex has ONE turn terminal —
 * `turn/completed` — and reports how it went in `params.turn.status`, so a
 * turn the user interrupted or that failed is otherwise indistinguishable
 * from a clean one, and its suggestion would be settled `done` instead of
 * going back in the queue.
 */
function isCodexTurnAbort(event: { type: string; payload?: unknown }): boolean {
  if (!event.type.endsWith('turn/completed')) return false;
  const payload = parseEventPayload(event.payload);
  // Whole-frame publishers nest the body under `params`; body-only ones
  // spread it across the payload itself. Read either.
  const params = parseEventPayload(payload?.params) ?? payload;
  const turn = parseEventPayload(params?.turn);
  return turn?.status === 'interrupted' || turn?.status === 'failed';
}

/** An event payload as an object, decoding the JSON string form. */
function parseEventPayload(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * Flag updates for one stream frame. Pure so the replay-vs-live rules are
 * unit-testable: subscribe replays the FULL event history on every
 * (re)connect, and a replayed `turn.cancelled` must not poison the live
 * dispatch state — that exact bug re-queued the same finished suggestion
 * in a loop. Devbox sleep is not tracked here: `reduceAgentLiveness` (the
 * SDK's own reducer, with the same replay guard) owns that.
 */
export function streamFlagUpdates(
  event: { type: string; timestamp?: number; payload?: unknown },
  baselines: { startedAt: number; dispatchedAt: number },
): {
  live: boolean;
  turnStarted: boolean;
  turnCancelled: boolean;
  turnEnded: boolean;
} {
  const ts = typeof event.timestamp === 'number' ? event.timestamp : null;
  // No timestamp = can't tell replay from live; treat as inert for flags.
  const liveSinceBoot = ts !== null && ts > baselines.startedAt;
  const afterDispatch = ts !== null && ts > baselines.dispatchedAt;
  const isCancel =
    event.type === 'turn.cancelled' || event.type === 'turn.failed' || isCodexTurnAbort(event);
  return {
    live: liveSinceBoot,
    // Any live event newer than our dispatch means the turn visibly began.
    // Both gates matter: before the first dispatch of this process
    // `dispatchedAt` is 0, so without the live gate replayed history from a
    // prior lifetime would read as turn activity (and a replayed old cancel
    // would re-queue a suggestion whose turn actually finished).
    turnStarted: liveSinceBoot && afterDispatch,
    turnCancelled: liveSinceBoot && afterDispatch && isCancel,
    // A turn end that is newer than our own dispatch is evidence THIS turn
    // finished — including when a reconnect replays it, which is why the
    // test is the timestamp and not whether we happened to be listening.
    // An end older than the dispatch belongs to a previous turn.
    turnEnded: liveSinceBoot && afterDispatch && isTurnEndEventType(event.type),
  };
}

/**
 * Fold one frame's flags into the dispatch bookkeeping.
 *
 * The LAST turn terminal wins, rather than any failure sticking for the
 * whole dispatch. A turn that reports a failure and then finishes — a
 * retried model call, a broker reconnect, an ACP `turn.failed` followed by
 * the real completion — did the work. Latching on the first bad news put
 * its suggestion back in the queue and sent the agent the same thing again,
 * and again on the next transient error.
 */
export function foldTurnFlags(
  state: { turnStarted: boolean; turnCancelled: boolean; sawTurnEnd: boolean },
  flags: { turnStarted: boolean; turnCancelled: boolean; turnEnded: boolean },
): { turnStarted: boolean; turnCancelled: boolean; sawTurnEnd: boolean } {
  return {
    turnStarted: state.turnStarted || flags.turnStarted,
    turnCancelled: flags.turnCancelled ? true : flags.turnEnded ? false : state.turnCancelled,
    sawTurnEnd: state.sawTurnEnd || flags.turnEnded,
  };
}

/**
 * How an in-flight dispatch should be settled, from what the stream showed
 * of its turn. `done` only when we watched that turn both start and reach a
 * clean end; anything else leaves the work unfinished — a turn that never
 * started (the message was never picked up), one that was cancelled or
 * failed, or one a devbox suspension cut short — so the suggestion goes back
 * in the queue.
 *
 * The polled record has no vote. It lags a finished turn by minutes, and
 * reading that lag as failure re-queued suggestions the agent had already
 * built: the card sat under "in progress" while the agent was sent the same
 * work again.
 */
export function dispatchSettlement(state: {
  turnStarted: boolean;
  turnCancelled: boolean;
  sawTurnEnd: boolean;
}): 'done' | 'approved' {
  return state.turnStarted && state.sawTurnEnd && !state.turnCancelled ? 'done' : 'approved';
}

/**
 * Whether a `running` agent record should be treated as idle so the queue
 * can advance. Pure so the rule is unit-testable — getting it wrong is
 * expensive in both directions: too eager and a genuinely working agent is
 * interrupted and its suggestion re-sent, too lax and a hung or suspended
 * turn blocks the queue forever.
 *
 * The stream is the authority. `liveStatus` (from `deriveAgentStatus`) is
 * already the combined judgement: `running` while a turn is executing —
 * however long it goes quiet — `suspended` once the devbox slept, and
 * `needs_input` when the record is stale because the stream saw the turn
 * end. Silence alone proves nothing: real agents are routinely quiet for
 * many minutes during a long build or model call. Only when the stream has
 * said nothing at all about turns is there no better signal than a (long)
 * silence timeout.
 *
 * The one exception is a delivery race. The record is polled over REST
 * while turn activity arrives over the socket, so a turn that just started
 * can show `running` a moment before its first event lands — and until it
 * does, the stream's last word is still the PREVIOUS turn's end. Acting on
 * that would dispatch into a live turn, so the stale-record verdict waits
 * out a short settle window of stream silence. A suspended devbox needs no
 * such wait: the suspension IS the stream's newest word.
 */
export function runningRecordIsStale(
  liveness: { turnActive: boolean; devboxAsleep: boolean },
  /** Whether a turn end newer than our own dispatch has been seen. */
  sawTurnEnd: boolean,
  liveStatus: LiveAgentStatus,
  silentForMs: number,
): boolean {
  if (liveness.turnActive) return false;
  if (liveness.devboxAsleep) return true;
  // Only a turn end we watched happen proves THIS turn is over. Subscribing
  // replays the stream's whole past, so a `turn.completed` from an earlier
  // turn is always folded into the liveness state — trusting it let a
  // freshly restarted watcher call a genuinely running turn stale 30s in,
  // re-queue the suggestion under it, and send the agent the same work
  // again (three times, until the cap settled it as done, undone).
  if (sawTurnEnd) {
    return liveStatus !== 'running' && silentForMs > STALE_RECORD_SETTLE_MS;
  }
  return silentForMs > UNKNOWN_TURN_SILENCE_MS;
}

/**
 * Whether the stream says a turn is running right now — the mirror image of
 * {@link runningRecordIsStale}. The agent record is polled over REST while
 * turn activity arrives over the socket, so the record can still read idle
 * for a turn that has already started; dispatching then puts a second turn
 * into a live one.
 *
 * Only fresh stream activity counts. If the stream has gone quiet past the
 * settle window while the record says idle, the record is the better
 * witness (we most likely missed the turn-end event) — which is also what
 * keeps a `turnActive` that never got its end event from wedging the queue
 * forever.
 */
export function streamSaysTurnRunning(
  liveness: { turnActive: boolean },
  silentForMs: number,
): boolean {
  return liveness.turnActive && silentForMs < STALE_RECORD_SETTLE_MS;
}

function gameStatusFrom(agent: Agent, daemonUrl: string | null): GameRow['status'] {
  if (agent.status === 'error') return 'error';
  if (STOPPED_STATUSES.has(agent.status)) return 'stopped';
  return daemonUrl ? 'live' : 'creating';
}

/** Most recently started daemon that exposes a URL — the one the iframe embeds. */
function pickDaemon(agent: Agent): { name: string; url: string } | null {
  const candidates = (agent.daemons ?? []).filter(
    (d): d is typeof d & { url: string } => typeof d.url === 'string' && d.url.length > 0,
  );
  if (candidates.length === 0) return null;
  const latest = candidates.reduce((a, b) => (b.startedAt >= a.startedAt ? b : a));
  return { name: latest.name, url: latest.url };
}

class GameWatcher {
  private socket: WebSocket | null = null;
  private closed = false;
  private reconnectDelay = RECONNECT_DELAY_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly reconcile: NodeJS.Timeout;

  /** Serializes advance() runs so events cannot double-dispatch. */
  private chain: Promise<void> = Promise.resolve();

  private lastAgentStatus: AgentStatus | null = null;
  private idleAdvancesWithTask = 0;
  private lastArtProbeAt = 0;
  private lastHostProbeAt = 0;
  private lastHostFixAt = 0;
  /** Stream-derived agent state; what viewers see instead of the raw record. */
  private liveness = initialAgentLiveness();
  private readonly startedAt = Date.now();
  private lastEventAt = Date.now();
  /**
   * Whether a turn end NEWER than our last dispatch has been seen. The
   * dispatcher trusts only this to conclude the current turn is over; the
   * folded liveness state cannot say it, because every (re)connect replays
   * the stream's whole past and older turn ends are always in there.
   */
  private sawTurnEnd = false;
  /** Whether this watcher has taken over suggestions left in flight before it. */
  private adoptedOrphans = false;
  private awaitingTurnStart = false;
  private turnStarted = false;
  private turnCancelled = false;
  private dispatchedAt = 0;

  constructor(
    private readonly gameId: string,
    private readonly streamId: string,
    private readonly creds: ReflexCredentials,
    private readonly wsUrl: string,
    private readonly engine: GameEngine,
  ) {
    this.connect();
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, HEARTBEAT_INTERVAL_MS);
    // Safety net for missed events (daemon URLs, status drift).
    this.reconcile = setInterval(() => this.requestAdvance('reconcile'), RECONCILE_INTERVAL_MS);
    this.requestAdvance('boot');
  }

  stop(): void {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearInterval(this.reconcile);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    if (this.closed) return;
    const socket = new WebSocket(this.wsUrl);
    this.socket = socket;

    socket.on('open', () => {
      this.reconnectDelay = RECONNECT_DELAY_MS;
      socket.send(JSON.stringify({ type: 'subscribe', streamId: this.streamId }));
    });
    socket.on('message', (raw) => {
      let frame: {
        type?: string;
        event?: { type?: string; timestamp?: number; payload?: unknown };
      };
      try {
        frame = JSON.parse(String(raw)) as typeof frame;
      } catch {
        return;
      }
      const event = frame.type === 'event' ? frame.event : undefined;
      if (!event?.type) return;
      this.liveness = reduceAgentLiveness(this.liveness, {
        type: event.type,
        timestamp: event.timestamp,
        payload: event.payload,
      });
      const flags = streamFlagUpdates(
        { type: event.type, timestamp: event.timestamp, payload: event.payload },
        {
          startedAt: this.startedAt,
          dispatchedAt: this.dispatchedAt,
        },
      );
      // Advance by event time, not wall clock: reconnects replay the full
      // history, and stamping replays with Date.now() would reset the
      // silence clock the stall watchdog depends on.
      if (flags.live) this.lastEventAt = Math.max(this.lastEventAt, event.timestamp ?? 0);
      const folded = foldTurnFlags(
        {
          turnStarted: this.turnStarted,
          turnCancelled: this.turnCancelled,
          sawTurnEnd: this.sawTurnEnd,
        },
        flags,
      );
      this.turnStarted = folded.turnStarted;
      this.turnCancelled = folded.turnCancelled;
      this.sawTurnEnd = folded.sawTurnEnd;
      if (isAdvanceEvent(event.type)) this.requestAdvance(event.type);
    });
    socket.on('close', () => {
      if (this.closed || this.socket !== socket) return;
      this.socket = null;
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
    });
    socket.on('error', () => {
      // 'close' follows and owns reconnection.
    });
  }

  /**
   * Start the bookkeeping for a turn we are about to send. Stamped BEFORE
   * the request goes out: the agent can emit its first events while the POST
   * is still in flight, and everything stamped at or before `dispatchedAt`
   * is discarded as replayed history — so a fast turn would read as one that
   * never started, and its suggestion be re-queued and sent again.
   */
  private stageDispatch(): void {
    this.awaitingTurnStart = true;
    this.turnStarted = false;
    this.turnCancelled = false;
    this.sawTurnEnd = false;
    this.dispatchedAt = Date.now();
  }

  /**
   * Close the books on a dispatch that has been settled. `sawTurnEnd` is
   * deliberately left alone: it is what tells `runningRecordIsStale` that a
   * record still reading `running` is stale, and clearing it would drop the
   * queue onto the 15-minute silence fallback.
   */
  private clearDispatch(): void {
    this.awaitingTurnStart = false;
    this.turnStarted = false;
    this.turnCancelled = false;
  }

  /** {@link dispatchSettlement} over this watcher's dispatch bookkeeping. */
  private settlement(): 'done' | 'approved' {
    return dispatchSettlement({
      turnStarted: this.turnStarted,
      turnCancelled: this.turnCancelled,
      sawTurnEnd: this.sawTurnEnd,
    });
  }

  /** Queue one advance run; concurrent triggers coalesce onto the chain. */
  requestAdvance(reason: string): void {
    this.chain = this.chain.then(() =>
      this.advance().catch((err) => {
        console.error(`[arcade] advance(${this.gameId}, ${reason}) failed:`, err);
      }),
    );
  }

  private async advance(): Promise<void> {
    if (this.closed) return;
    const { db, hub } = this.engine;
    const game = await db.gameById(this.gameId);
    if (!game) {
      this.engine.dropWatcher(this.gameId);
      return;
    }

    let agent: Agent;
    try {
      agent = await fetchAgent(this.creds, game.agentId);
    } catch (err) {
      // The agent no longer exists (deleted upstream, org key revoked from
      // it, retention swept it): retire the game instead of erroring on
      // every reconcile forever.
      const status = err instanceof ReflexApiError ? err.status : null;
      if (status === 404 || status === 410) {
        console.warn(`[arcade] agent for game ${this.gameId} is gone (${status}); marking stopped`);
        const updated = await db.updateGame(game.id, {
          status: 'stopped',
          agentStatus: 'terminated',
          currentTask: null,
          currentTaskKind: null,
        });
        if (updated) {
          const owner = await db.userById(updated.ownerId);
          hub.gameChanged(
            publicGame(updated, owner?.name ?? 'unknown', hub.viewerCount(updated.id)),
          );
        }
        this.engine.dropWatcher(this.gameId);
        return;
      }
      console.error(`[arcade] could not fetch agent for game ${this.gameId}:`, err);
      return;
    }

    // Sync the game row (agent status, daemon URL, derived game status).
    // The published agent status is stream-derived, not the raw record: the
    // record can stay `running` after a turn ends or a devbox suspends, and
    // viewers would see "working" forever.
    const liveStatus = deriveAgentStatus(this.liveness, agent.status);
    const daemon = pickDaemon(agent);
    const nextStatus = gameStatusFrom(agent, daemon?.url ?? game.daemonUrl);
    if (
      liveStatus !== game.agentStatus ||
      nextStatus !== game.status ||
      (daemon && daemon.url !== game.daemonUrl)
    ) {
      const updated = await db.updateGame(game.id, {
        agentStatus: liveStatus,
        status: nextStatus,
        ...(daemon ? { daemonUrl: daemon.url, daemonName: daemon.name } : {}),
      });
      if (updated) {
        const owner = await db.userById(updated.ownerId);
        hub.gameChanged(publicGame(updated, owner?.name ?? 'unknown', hub.viewerCount(updated.id)));
      }
    }

    // A suggestion left `working` by a previous process is an orphan: this
    // watcher cannot know whether the agent ever received it, let alone
    // finished it. Guessing went wrong in both directions — marked done, so
    // work silently vanished; or re-queued, so the agent got it twice. Put
    // it back under the normal staging rules and let the evidence decide:
    // a turn that starts and ends completes it, and one that never starts
    // re-queues it after the grace window.
    if (!this.adoptedOrphans) {
      this.adoptedOrphans = true;
      if ((await db.workingSuggestions(game.id)).length > 0) {
        console.warn(`[arcade] adopting an in-flight suggestion for game ${this.gameId}`);
        this.stageDispatch();
      }
    }

    if (agent.status === 'running') this.turnStarted = true;

    // Settle on the stream's word, not the record's. Once the stream has
    // shown this dispatch's turn start and clean end, the suggestion shipped
    // — waiting for the record to stop saying `running` meant waiting out
    // the stale-record path below, which settles everything in flight as
    // `approved`: the finished suggestion went back in the queue and the
    // agent was sent the same work again.
    if (this.awaitingTurnStart && this.settlement() === 'done') {
      await this.settleWorking(game, 'done');
      // A finished turn may have redrawn the art files.
      await this.captureArt(game, true);
      this.clearDispatch();
    }

    // Pick up agent-authored art whenever some is still missing.
    if (!game.previewArt || !game.iconArt || !game.previewAnimArt) {
      await this.captureArt(game, false);
    }

    // A `running` record that is not backed by a running turn blocks the
    // queue forever (a suspended devbox, a hung turn, a record left stale
    // after the turn ended). The stream decides which it is — `liveStatus`
    // is already that judgement: `running` while a turn is executing however
    // quiet it is, `suspended` after the devbox slept, `needs_input` once
    // the stream saw the turn end. Only when the stream has said nothing at
    // all about turns do we fall back to a (long) silence timeout.
    const inDispatchGrace =
      this.awaitingTurnStart && Date.now() - this.dispatchedAt < TURN_START_GRACE_MS;
    const silentFor = Date.now() - this.lastEventAt;
    const stalled =
      agent.status === 'running' &&
      !inDispatchGrace &&
      runningRecordIsStale(this.liveness, this.sawTurnEnd, liveStatus, silentFor);
    if (stalled) {
      console.warn(
        `[arcade] agent for game ${this.gameId} reports running but the stream says ` +
          `${liveStatus} (silent ${Math.round(silentFor / 1000)}s); treating as idle`,
      );
      // Same evidence test as above, not a blanket failure: a stale record
      // says nothing about how the turn went. In practice anything the
      // stream saw finish is already settled by then, so this re-queues the
      // genuinely unfinished — a suspended devbox, a hung turn.
      await this.settleWorking(game, this.settlement());
      this.clearDispatch();
    }

    if (!stalled && streamSaysTurnRunning(this.liveness, silentFor)) {
      this.lastAgentStatus = agent.status;
      return;
    }

    if (!IDLE_STATUSES.has(agent.status) && !stalled) {
      // An errored agent will never finish its turn — put the in-flight
      // suggestion back in the queue so recovery (or a new agent) retries it.
      if (agent.status === 'error') {
        await this.settleWorking(game, 'approved');
        this.clearDispatch();
      }
      this.lastAgentStatus = agent.status;
      return;
    }

    // Idle. A freshly staged suggestion is completed only once its turn
    // visibly started; before that, idle just means the message hasn't been
    // picked up yet.
    if (this.awaitingTurnStart && !this.turnStarted) {
      if (Date.now() - this.dispatchedAt < TURN_START_GRACE_MS) {
        this.lastAgentStatus = agent.status;
        return;
      }
      // The turn never started (lost message, agent replaced, ...). Re-queue
      // and fall through so the dispatcher sends it again.
      console.warn(`[arcade] turn for game ${this.gameId} never started; re-queueing suggestion`);
      await this.settleWorking(game, 'approved');
      this.awaitingTurnStart = false;
    } else {
      // Turn over (or a working suggestion left from before a restart):
      // done if it ran to completion, back to approved if it was cut short.
      const finished = this.awaitingTurnStart && this.turnStarted && !this.turnCancelled;
      await this.settleWorking(game, this.turnCancelled ? 'approved' : 'done');
      // A finished turn may have redrawn the art files.
      if (finished) await this.captureArt(game, true);
    }
    this.clearDispatch();

    // A daemon that answers the tunnel with Vite's blocked-host page shows
    // players an error instead of the game — fixing that outranks
    // suggestion work (which would be built on a broken host anyway).
    if (await this.nudgeIfHostBlocked(game)) {
      this.lastAgentStatus = agent.status;
      return;
    }

    const next = await db.nextApprovedSuggestion(game.id);
    if (!next) {
      // Idle with nothing queued: clear the shown task — but only once the
      // turn it described was actually observed (running -> idle), or after
      // several idle reconciles (stale task from before a restart). A fresh
      // owner prompt pokes an advance before the agent starts running, and
      // clearing here immediately would erase it.
      if (game.currentTask) {
        this.idleAdvancesWithTask += 1;
        if (this.lastAgentStatus === 'running' || this.idleAdvancesWithTask >= 4) {
          await this.setTask(game, null, null);
          this.idleAdvancesWithTask = 0;
        }
      } else {
        this.idleAdvancesWithTask = 0;
      }
      this.lastAgentStatus = agent.status;
      return;
    }
    this.idleAdvancesWithTask = 0;

    // Claim the suggestion: the owner may have rejected it between the
    // read above and now. A failed claim just means look again.
    const marked = await db.setSuggestionStatus(next.id, 'working', ['approved']);
    if (!marked) {
      this.requestAdvance('claim-lost');
      this.lastAgentStatus = agent.status;
      return;
    }
    hub.suggestionChanged(marked, game);
    await db.countSuggestionDispatch(marked.id);
    await this.setTask(game, marked.body, 'suggestion');
    this.stageDispatch();
    try {
      await sendMessageToAgent(
        this.creds,
        game.agentId,
        suggestionPrompt(
          marked.authorName,
          marked.body,
          !game.previewArt || !game.iconArt || !game.previewAnimArt,
          marked.ownerNote,
        ),
      );
    } catch (err) {
      console.error(`[arcade] sending suggestion ${next.id} failed, re-queueing:`, err);
      this.awaitingTurnStart = false;
      const reverted = await db.setSuggestionStatus(next.id, 'approved', ['working']);
      if (reverted) hub.suggestionChanged(reverted, game);
    }
    this.lastAgentStatus = agent.status;
  }

  /** Publish what the agent is working on (null clears it). */
  private async setTask(
    game: GameRow,
    task: string | null,
    kind: 'suggestion' | 'prompt' | null,
  ): Promise<void> {
    const { db, hub } = this.engine;
    const updated = await db.updateGame(game.id, { currentTask: task, currentTaskKind: kind });
    if (updated) {
      const owner = await db.userById(updated.ownerId);
      hub.gameChanged(publicGame(updated, owner?.name ?? 'unknown', hub.viewerCount(updated.id)));
    }
  }

  /**
   * Probe the daemon through its public URL and, when Vite's blocked-host
   * page comes back, send the agent a corrective turn (rate limited). The
   * turn uses the same staging bookkeeping as a dispatch, so the queue
   * waits for the fix to land. Returns true when a fix turn was just sent.
   */
  private async nudgeIfHostBlocked(game: GameRow): Promise<boolean> {
    if (!game.daemonUrl) return false;
    const now = Date.now();
    if (now - this.lastHostProbeAt < HOST_PROBE_MIN_INTERVAL_MS) return false;
    this.lastHostProbeAt = now;
    let blocked = false;
    try {
      const url = new URL(game.daemonUrl, this.engine.reflexBaseUrl);
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      blocked = looksHostBlocked(res.status, await res.text());
    } catch {
      return false; // asleep or unreachable — not a config problem
    }
    if (!blocked || now - this.lastHostFixAt < HOST_FIX_NUDGE_MIN_INTERVAL_MS) return false;
    this.lastHostFixAt = now;
    console.warn(`[arcade] daemon for game ${this.gameId} rejects the tunnel host; nudging a fix`);
    this.stageDispatch();
    try {
      await sendMessageToAgent(this.creds, game.agentId, hostFixPrompt(game.daemonUrl));
      return true;
    } catch (err) {
      console.error(`[arcade] host-fix nudge for game ${this.gameId} failed:`, err);
      this.awaitingTurnStart = false;
      return false;
    }
  }

  /**
   * Fetch /arcade/{preview,icon}.{svg,png} off the game's daemon and store
   * whichever changed. Relative daemon URLs (the bundled mock) resolve
   * against the Reflex origin.
   */
  private async captureArt(game: GameRow, force: boolean): Promise<void> {
    if (!game.daemonUrl) return;
    const now = Date.now();
    if (!force && now - this.lastArtProbeAt < ART_PROBE_MIN_INTERVAL_MS) return;
    this.lastArtProbeAt = now;

    const changes: { previewArt?: string; iconArt?: string; previewAnimArt?: string } = {};
    for (const kind of ART_KINDS) {
      const current = game[kind.field];
      for (const artPath of kind.paths) {
        let dataUrl: string | null = null;
        try {
          const url = new URL(
            `${game.daemonUrl.replace(/\/+$/, '')}/${artPath}`,
            this.engine.reflexBaseUrl,
          );
          const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
          const type = res.headers.get('content-type') ?? '';
          if (!res.ok || !ART_CONTENT_TYPES.test(type)) continue;
          const bytes = Buffer.from(await res.arrayBuffer());
          if (bytes.byteLength === 0 || bytes.byteLength > kind.maxBytes) continue;
          dataUrl = `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
        } catch {
          continue; // daemon asleep or file absent — try again later
        }
        if (dataUrl && dataUrl !== current) changes[kind.field] = dataUrl;
        break; // first candidate that served an image wins
      }
    }

    if (Object.keys(changes).length === 0) return;
    const { db, hub } = this.engine;
    const updated = await db.setGameArt(game.id, changes);
    if (updated) {
      const owner = await db.userById(updated.ownerId);
      hub.gameChanged(publicGame(updated, owner?.name ?? 'unknown', hub.viewerCount(updated.id)));
    }
  }

  /** Move every in-flight suggestion to `status`, broadcasting each change. */
  private async settleWorking(game: GameRow, status: 'done' | 'approved'): Promise<void> {
    const { db, hub } = this.engine;
    const working = await db.workingSuggestions(game.id);
    for (const suggestion of working) {
      let target: SuggestionStatus = status;
      let note: string | null = null;
      if (target === 'approved') {
        // Safety valve: never ping-pong the same suggestion forever.
        if (suggestion.dispatches >= MAX_DISPATCHES_PER_SUGGESTION) {
          console.warn(
            `[arcade] suggestion ${suggestion.id} was dispatched ` +
              `${MAX_DISPATCHES_PER_SUGGESTION} times without finishing; giving up on it`,
          );
          // NOT `done`: this suggestion was never built, and telling the
          // room it shipped is a lie it cannot see through — the card would
          // sit under "Shipped" with a tick. Give up out loud instead, with
          // a note saying why, so the owner can re-approve it if they want.
          target = 'rejected';
          note =
            suggestion.ownerNote ??
            `The agent was sent this ${MAX_DISPATCHES_PER_SUGGESTION} times and never finished a ` +
              'turn on it. Approve it again to retry.';
        } else {
          console.warn(`[arcade] re-queueing suggestion ${suggestion.id} (turn did not finish)`);
        }
      }
      if (note !== null) await db.setSuggestionNote(suggestion.id, note);
      const settled = await db.setSuggestionStatus(suggestion.id, target);
      if (settled) hub.suggestionChanged(settled, game);
      // A settled suggestion's count can no longer matter; clearing it
      // gives a later owner re-approval a fresh start.
      if (target !== 'approved') await db.resetSuggestionDispatches(suggestion.id);
    }
  }
}

export class GameEngine {
  private readonly watchers = new Map<string, GameWatcher>();
  /** In-flight `ensureWatcher` starts, so concurrent callers share one. */
  private readonly starting = new Map<string, Promise<void>>();
  /** Games dropped while their watcher was still starting up. */
  private readonly dropped = new Set<string>();

  constructor(
    readonly db: ArcadeDb,
    readonly hub: EventHub,
    readonly reflexBaseUrl: string,
  ) {}

  /**
   * Watch a game's agent stream; idempotent per game, including against
   * itself. Two watchers on one game means two dispatchers racing the same
   * queue — each claims a different suggestion and sends it, so the agent
   * gets two turns at once. Looking in `watchers` is not enough to prevent
   * that: creation awaits the owner's credentials, and a second caller
   * arriving during that await would find the map still empty. Concurrent
   * callers therefore share one in-flight start.
   */
  async ensureWatcher(game: GameRow): Promise<void> {
    if (this.watchers.has(game.id)) return;
    this.dropped.delete(game.id);
    const inFlight = this.starting.get(game.id);
    if (inFlight) return inFlight;
    // No await between the get above and the set below — that is what makes
    // this a real lock on a single-threaded event loop.
    const start = this.startWatcher(game).finally(() => this.starting.delete(game.id));
    this.starting.set(game.id, start);
    return start;
  }

  private async startWatcher(game: GameRow): Promise<void> {
    if (game.status === 'stopped' || game.status === 'error') return;
    const key = await this.db.credsForGame(game);
    if (!key) return;
    // A `dropWatcher` that landed while we were fetching credentials wins:
    // starting anyway would resurrect a watcher for a deleted game.
    if (this.dropped.has(game.id)) return;
    const creds: ReflexCredentials = { apiKey: key.apiKey, org: key.org };
    const params = new URLSearchParams({ token: creds.apiKey });
    if (creds.org) params.set('organizationId', creds.org);
    const wsUrl = `${this.reflexBaseUrl.replace(/^http/, 'ws')}/api/ws?${params.toString()}`;
    this.watchers.set(game.id, new GameWatcher(game.id, game.agentStreamId, creds, wsUrl, this));
  }

  dropWatcher(gameId: string): void {
    if (this.starting.has(gameId)) this.dropped.add(gameId);
    this.watchers.get(gameId)?.stop();
    this.watchers.delete(gameId);
  }

  /** Nudge a game's dispatcher (suggestion approved, game created, ...). */
  poke(gameId: string, reason: string): void {
    this.watchers.get(gameId)?.requestAdvance(reason);
  }

  async resumeAll(): Promise<void> {
    const games = await this.db.allGames();
    for (const game of games) await this.ensureWatcher(game);
  }

  stopAll(): void {
    for (const watcher of this.watchers.values()) watcher.stop();
    this.watchers.clear();
  }
}
