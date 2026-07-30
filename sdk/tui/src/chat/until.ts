import type { ReflexStreamEvent } from '@runloop/reflex-client';
import { innerType, isUserPromptEvent, parsePayload } from './transcript.js';

/**
 * Exit-condition tracking for `watch` and `run`.
 *
 * The tracker classifies stream events into watch outcomes using the same
 * event vocabulary as `TranscriptEngine` (turn lifecycle, agent lifecycle
 * banners, PR events), reduced to the three things a scripted watch cares
 * about: the turn ended cleanly, a pull request was opened, or the agent
 * errored. Framework- and socket-free so it is unit-testable with fixture
 * events.
 *
 * It is a small state machine rather than a pure per-event function because
 * two bits of history change how later events read, exactly as in the
 * transcript engine: an interrupt makes the following `turn.failed` /
 * error-result a cancellation (not an agent error), and a new turn starting
 * clears the previous turn's ending.
 */

/** `--until` flag values. */
export type UntilCondition = 'done' | 'pr' | 'forever';

/** What a watch concluded: turn done, PR opened, or agent errored. */
export type WatchOutcome = 'done' | 'pr' | 'error';

export class UntilTracker {
  /** `agent.interrupted` / `session/cancel` seen for the current turn. */
  private interrupted = false;
  /** The current turn already ended (Claude turns end twice: `result`, then the runner's `turn.completed` / `turn.failed`). */
  private turnEnded = false;
  /** How the most recent turn ended; null before any turn or mid-turn. */
  private lastTurnEnd: 'done' | 'error' | null = null;
  /** An `agent.pr_created` event was seen. */
  private prSeen = false;

  /**
   * Feed one stream event; returns the outcome it concludes, if any.
   * Callers decide what to do with it (a backfill records, a live watch
   * exits).
   */
  observe(event: ReflexStreamEvent): WatchOutcome | null {
    const type = innerType(event.type);
    const payload = parsePayload(event.payload);

    if (isUserPromptEvent(event, type, payload)) {
      this.startTurn();
      return null;
    }

    switch (event.type) {
      case 'turn.started':
        this.startTurn();
        return null;
      case 'agent.interrupted':
        this.interrupted = true;
        return null;
      // The runner ends every turn with one of these; `turn.failed` after an
      // interrupt is the cancelled turn, not an agent error (engine parity).
      case 'turn.completed':
      case 'turn.cancelled':
        return this.endTurn('done');
      case 'turn.failed':
        return this.endTurn(this.interrupted ? 'done' : 'error');
      // Lifecycle events end the run whether or not a turn is open, so they
      // are not gated on `turnEnded` like the turn events above.
      case 'broker.error':
      case 'devbox.failed':
      case 'agent.killed':
        return this.endRun('error');
      case 'agent.error':
        // Broker stderr lines arrive as `agent.error` too; they are logs.
        if (payload.errorType === 'stderr') return null;
        return this.endRun('error');
      case 'agent.complete':
      case 'agent.stopped':
        return this.endRun('done');
      case 'agent.pr_created':
        this.prSeen = true;
        return 'pr';
    }

    if (type === 'session/cancel') {
      this.interrupted = true;
      return null;
    }
    // Claude protocol result: the first turn end on a Claude stream (the
    // runner's turn.completed / turn.failed follows and is ignored above).
    if (type === 'result') {
      return this.endTurn(payload.is_error === true && !this.interrupted ? 'error' : 'done');
    }
    return null;
  }

  /**
   * How the latest turn ended, or null while a turn runs (or before any
   * turn). After a history backfill this decides whether `--until done`
   * is already satisfied.
   */
  turnOutcome(): 'done' | 'error' | null {
    return this.lastTurnEnd;
  }

  /** Whether any pull request was opened on the stream so far. */
  hasPr(): boolean {
    return this.prSeen;
  }

  private startTurn(): void {
    this.turnEnded = false;
    this.lastTurnEnd = null;
    this.interrupted = false;
  }

  /** A turn-scoped end; no-op when the turn already ended (double-end streams). */
  private endTurn(outcome: 'done' | 'error'): 'done' | 'error' | null {
    if (this.turnEnded) return null;
    return this.endRun(outcome);
  }

  /** A run-level end (lifecycle banner); always counts. */
  private endRun(outcome: 'done' | 'error'): 'done' | 'error' {
    this.turnEnded = true;
    this.lastTurnEnd = outcome;
    this.interrupted = false;
    return outcome;
  }
}
