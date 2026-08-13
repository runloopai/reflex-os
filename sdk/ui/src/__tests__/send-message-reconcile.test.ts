/**
 * `applySendMessageResult` folds a send's response into the stream cache.
 * These cases lock in the optimistic-bubble lifecycle for both delivery
 * modes:
 *
 * - 201 (direct delivery): the real event replaces the `pending-*` entry,
 *   deduplicated against a socket echo that may have landed first.
 * - 202 accepted-but-pending (mailbox delivery): the optimistic entry
 *   SURVIVES — the user's text must not vanish while the drain delivers —
 *   and the later socket echo reconciles it away without a duplicate
 *   bubble.
 */
import { describe, expect, it } from 'vitest';
import {
  applySendMessageResult,
  buildChatMessages,
  deduplicateEvents,
  expireAcceptedSend,
  isAgentCommandAccepted,
  pendingUserMessageText,
  reconcilePendingEvents,
} from '../lib/event-utils';
import type { ReflexStreamEvent } from '@runloop/reflex-client';

const pendingId = 'pending-1723500000000';
const accepted = { status: 'pending', commandId: 'acmd_1' } as const;

function optimistic(text = 'hello agent'): ReflexStreamEvent {
  return {
    id: pendingId,
    streamId: 'pending',
    type: 'message',
    payload: { message: text },
    timestamp: 1,
    origin: 'USER_EVENT',
  };
}

function realEvent(text = 'hello agent', id = 'evt_real'): ReflexStreamEvent {
  return {
    id,
    streamId: 'strm_1',
    type: 'message',
    payload: { message: text },
    timestamp: 2,
    origin: 'USER_EVENT',
  };
}

/** The stream subscription's cache update (see `use-agent-stream`). */
function socketAppend(events: ReflexStreamEvent[], event: ReflexStreamEvent): ReflexStreamEvent[] {
  return reconcilePendingEvents(deduplicateEvents([...events, event]));
}

describe('isAgentCommandAccepted', () => {
  it('narrows the 202 accepted-but-pending body', () => {
    expect(isAgentCommandAccepted({ status: 'pending', commandId: 'acmd_1' })).toBe(true);
  });

  it('rejects stream events and near-miss shapes', () => {
    expect(isAgentCommandAccepted(realEvent())).toBe(false);
    expect(isAgentCommandAccepted({ status: 'pending' })).toBe(false);
    expect(isAgentCommandAccepted({ commandId: 'acmd_1' })).toBe(false);
    expect(isAgentCommandAccepted(null)).toBe(false);
  });
});

describe('applySendMessageResult', () => {
  it('replaces the optimistic entry with the real event on 201', () => {
    const next = applySendMessageResult([optimistic()], realEvent(), pendingId);
    expect(next.map((e) => e.id)).toEqual(['evt_real']);
  });

  it('does not duplicate when the socket echo landed before the 201', () => {
    const afterEcho = socketAppend([optimistic()], realEvent());
    const next = applySendMessageResult(afterEcho, realEvent(), pendingId);
    expect(next.map((e) => e.id)).toEqual(['evt_real']);
    expect(buildChatMessages(next)).toHaveLength(1);
  });

  it('keeps the optimistic entry on 202 accepted-but-pending', () => {
    const next = applySendMessageResult(
      [optimistic()],
      { status: 'pending', commandId: 'acmd_1' },
      pendingId,
    );
    expect(next.map((e) => e.id)).toEqual([pendingId]);
    // The user's just-sent text stays visible while the drain delivers.
    const messages = buildChatMessages(next);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', text: 'hello agent', pending: true });
  });

  it('converges to one bubble when the real event arrives after acceptance', () => {
    const kept = applySendMessageResult([optimistic()], accepted, pendingId);
    // The drain delivers; the socket echoes the real user event.
    const next = socketAppend(kept, realEvent());
    expect(next.map((e) => e.id)).toEqual(['evt_real']);
    const messages = buildChatMessages(next);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'user', text: 'hello agent', pending: false });
  });
});

describe('pendingUserMessageText', () => {
  it('is the plain message when there are no attachments', () => {
    expect(pendingUserMessageText('hello', [])).toBe('hello');
  });

  it('appends the attachment list on its own line', () => {
    expect(pendingUserMessageText('hello', ['a.png', 'b.pdf'])).toBe('hello\n📎 a.png, b.pdf');
  });
});

describe('202 reconciliation of sends with attachments', () => {
  it('reconciles a single-line message with attachments against its plain echo', () => {
    const kept = applySendMessageResult(
      [optimistic(pendingUserMessageText('hello agent', ['report.pdf']))],
      accepted,
      pendingId,
    );
    const next = socketAppend(kept, realEvent('hello agent'));
    expect(next.map((e) => e.id)).toEqual(['evt_real']);
  });

  it('reconciles a multiline message with attachments against its plain echo', () => {
    const text = 'first line\nsecond line';
    const kept = applySendMessageResult(
      [optimistic(pendingUserMessageText(text, ['report.pdf']))],
      accepted,
      pendingId,
    );
    const next = socketAppend(kept, realEvent(text));
    expect(next.map((e) => e.id)).toEqual(['evt_real']);
  });

  it('cannot text-match an attachment-only send; expiry is its backstop', () => {
    const kept = applySendMessageResult(
      [optimistic(pendingUserMessageText('', ['report.pdf']))],
      accepted,
      pendingId,
    );
    // The delivered echo carries only non-text blocks (an ACP
    // `session/prompt` with a file attachment), so it exposes no text for
    // reconciliation — the optimistic entry survives the echo...
    const echo: ReflexStreamEvent = {
      id: 'evt_echo',
      streamId: 'strm_1',
      type: 'session/prompt',
      payload: { prompt: [{ type: 'file', name: 'report.pdf' }] },
      timestamp: 2,
      origin: 'USER_EVENT',
    };
    const afterEcho = socketAppend(kept, echo);
    expect(afterEcho.map((e) => e.id)).toEqual([pendingId, 'evt_echo']);
    // ...and the bounded expiry the send hook schedules removes it, matching
    // the direct path (which removes the optimistic entry by id).
    expect(expireAcceptedSend(afterEcho, pendingId).map((e) => e.id)).toEqual(['evt_echo']);
  });

  it('never drops a pending entry for an unrelated user message', () => {
    const kept = applySendMessageResult(
      [optimistic(pendingUserMessageText('hello agent', ['report.pdf']))],
      accepted,
      pendingId,
    );
    const next = socketAppend(kept, realEvent('a different message'));
    expect(next.map((e) => e.id)).toEqual([pendingId, 'evt_real']);
  });
});

describe('expireAcceptedSend', () => {
  it('removes the optimistic entry of a send that failed after the 202', () => {
    // A mailbox command can fail after the bounded wait (agent went terminal
    // before the drain delivered). The failure is durable server-side but has
    // no read surface, so no stream event ever arrives — the expiry is what
    // keeps the bubble from reading "Sending…" forever.
    const kept = applySendMessageResult([optimistic()], accepted, pendingId);
    const next = expireAcceptedSend(kept, pendingId);
    expect(next).toEqual([]);
    expect(buildChatMessages(next)).toHaveLength(0);
  });

  it('is a no-op when the echo already reconciled the send', () => {
    const kept = applySendMessageResult([optimistic()], accepted, pendingId);
    const confirmed = socketAppend(kept, realEvent());
    expect(expireAcceptedSend(confirmed, pendingId)).toEqual(confirmed);
  });
});
