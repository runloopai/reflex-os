import { describe, expect, it } from 'vitest';
import type { ReflexStreamEvent } from '@runloop/reflex-client';
import { UntilTracker, type WatchOutcome } from '../chat/until.js';

let eventSeq = 0;

function event(
  type: string,
  payload: unknown = {},
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

function observeAll(events: ReflexStreamEvent[]): (WatchOutcome | null)[] {
  const tracker = new UntilTracker();
  return events.map((e) => tracker.observe(e));
}

describe('UntilTracker.observe', () => {
  it('classifies turn lifecycle ends', () => {
    expect(observeAll([event('turn.completed')])).toEqual(['done']);
    expect(observeAll([event('turn.cancelled')])).toEqual(['done']);
    expect(observeAll([event('turn.failed', { error: 'boom' })])).toEqual(['error']);
  });

  it('classifies the Claude protocol result by its error flag', () => {
    expect(observeAll([event('turn.claude.result', { is_error: false })])).toEqual(['done']);
    expect(observeAll([event('turn.claude.result', { is_error: true })])).toEqual(['error']);
  });

  it('counts the double turn end once (result, then the runner event)', () => {
    expect(
      observeAll([event('turn.claude.result', { is_error: false }), event('turn.completed')]),
    ).toEqual(['done', null]);
    expect(
      observeAll([event('turn.claude.result', { is_error: true }), event('turn.failed')]),
    ).toEqual(['error', null]);
  });

  it('reads turn ends after an interrupt as done, not error', () => {
    expect(
      observeAll([
        event('query', { message: { role: 'user', content: 'go' } }),
        event('agent.interrupted'),
        event('turn.failed'),
      ]),
    ).toEqual([null, null, 'done']);
    expect(
      observeAll([
        event('session/cancel'),
        event('turn.claude.result', { is_error: true, subtype: 'error_during_execution' }),
      ]),
    ).toEqual([null, 'done']);
  });

  it('classifies agent lifecycle events', () => {
    expect(observeAll([event('agent.complete', { summary: 'all good' })])).toEqual(['done']);
    expect(observeAll([event('agent.stopped')])).toEqual(['done']);
    expect(observeAll([event('agent.killed')])).toEqual(['error']);
    expect(observeAll([event('agent.error', { error: 'crashed' })])).toEqual(['error']);
    expect(observeAll([event('broker.error', { message: 'broker down' })])).toEqual(['error']);
    expect(observeAll([event('devbox.failed', { reason: 'no capacity' })])).toEqual(['error']);
  });

  it('still ends the run on lifecycle events after the turn already ended', () => {
    // A kill from the web while the watch idles must not be swallowed.
    expect(observeAll([event('turn.completed'), event('agent.killed')])).toEqual(['done', 'error']);
  });

  it('treats broker stderr lines as logs, not errors', () => {
    expect(
      observeAll([event('agent.error', { errorType: 'stderr', message: 'npm WARN' })]),
    ).toEqual([null]);
  });

  it('reports a PR only when one is opened', () => {
    const tracker = new UntilTracker();
    expect(tracker.hasPr()).toBe(false);
    expect(
      tracker.observe(event('agent.pr_created', { url: 'https://g/1', number: 1, title: 'fix' })),
    ).toBe('pr');
    expect(tracker.hasPr()).toBe(true);
    expect(tracker.observe(event('agent.pr_merged', { url: 'https://g/1', number: 1 }))).toBeNull();
  });

  it('ignores ordinary content events', () => {
    expect(
      observeAll([
        event('turn.claude.assistant', { message: { content: [{ type: 'text', text: 'hi' }] } }),
        event('agent.log', { log_type: 'stdout', message: 'x' }),
        event('devbox.running'),
      ]),
    ).toEqual([null, null, null]);
  });
});

describe('UntilTracker.turnOutcome after a backfill', () => {
  it('is done when the history ends with a completed turn', () => {
    const tracker = new UntilTracker();
    for (const e of [
      event('query', { message: { role: 'user', content: 'go' } }),
      event('turn.claude.result', { is_error: false }),
      event('turn.completed'),
    ]) {
      tracker.observe(e);
    }
    expect(tracker.turnOutcome()).toBe('done');
  });

  it('is null while a turn is running (a new prompt clears the last end)', () => {
    const tracker = new UntilTracker();
    for (const e of [
      event('query', { message: { role: 'user', content: 'go' } }),
      event('turn.completed'),
      event('query', { message: { role: 'user', content: 'and again' } }),
    ]) {
      tracker.observe(e);
    }
    expect(tracker.turnOutcome()).toBeNull();
  });

  it('is null before any turn (fresh agent, empty or setup-only history)', () => {
    const tracker = new UntilTracker();
    tracker.observe(event('agent.setup', { step: 'init' }));
    expect(tracker.turnOutcome()).toBeNull();
  });

  it('is error when the agent errored and nothing started since', () => {
    const tracker = new UntilTracker();
    tracker.observe(event('devbox.failed', { reason: 'no capacity' }));
    expect(tracker.turnOutcome()).toBe('error');
  });

  it('turn.started resets the previous outcome', () => {
    const tracker = new UntilTracker();
    tracker.observe(event('turn.completed'));
    tracker.observe(event('turn.started'));
    expect(tracker.turnOutcome()).toBeNull();
  });
});
