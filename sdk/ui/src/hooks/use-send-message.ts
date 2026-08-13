// AUTO-SYNCED from sdk/chat-kit/registry/hooks/use-send-message.ts — edit there, then run `pnpm --filter @runloop/reflex-ui sync`.
/**
 * Send-message mutation with an optimistic pending bubble.
 *
 * Sends plain text, or text plus attachments as `image`/`file` content
 * blocks (the wire shape `sendAgentMessage` accepts). Appends a `pending-*`
 * user event to the stream cache immediately, then replaces it with the
 * real event returned by the server (or removes it on failure). Under
 * asynchronous (mailbox) command delivery the server may instead answer
 * 202 accepted-but-pending; the optimistic bubble then stays until the
 * real event arrives over the stream, or expires after a bounded wait if
 * it never does (a post-202 failure emits no stream event). The pending
 * id prefix is what `event-utils`' builders use to render the in-flight
 * state.
 *
 * You own this file; add retry UX or toasts as your product needs.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { sendAgentMessage } from '@runloop/reflex-client';
import type {
  AgentCommandPendingResponse,
  ReflexStreamEvent,
  SendAgentMessageBody,
} from '@runloop/reflex-client';
import { agentStreamKey } from './use-agent-stream';
import {
  ACCEPTED_SEND_EXPIRY_MS,
  applySendMessageResult,
  expireAcceptedSend,
  isAgentCommandAccepted,
  pendingUserMessageText,
} from '../lib/event-utils';

/** One outgoing attachment, base64-encoded (no `data:` prefix). */
export interface ChatAttachment {
  name: string;
  mimeType: string;
  data: string;
}

export interface OutgoingMessage {
  message: string;
  attachments?: ChatAttachment[];
}

interface SendMessageContext {
  pendingId: string;
}

function toContentBlocks(input: OutgoingMessage): SendAgentMessageBody['content'] {
  const blocks: NonNullable<SendAgentMessageBody['content']> = [];
  if (input.message) blocks.push({ type: 'text', text: input.message });
  for (const attachment of input.attachments ?? []) {
    if (attachment.mimeType.startsWith('image/')) {
      blocks.push({ type: 'image', mimeType: attachment.mimeType, data: attachment.data });
    } else {
      blocks.push({
        type: 'file',
        name: attachment.name,
        mimeType: attachment.mimeType,
        data: attachment.data,
      });
    }
  }
  return blocks;
}

/**
 * A send's settled result: the acknowledging stream event (201), or the
 * accepted-but-pending body (202, mailbox delivery) — both are success.
 */
export type SendMessageResult = ReflexStreamEvent | AgentCommandPendingResponse;

export function useSendMessage(
  agentId: string,
): UseMutationResult<SendMessageResult, Error, OutgoingMessage, SendMessageContext> {
  const queryClient = useQueryClient();

  return useMutation<SendMessageResult, Error, OutgoingMessage, SendMessageContext>({
    mutationFn: async (input: OutgoingMessage) => {
      const attachments = input.attachments ?? [];
      // Plain text goes as `message` (broadest compatibility); anything with
      // attachments switches to content blocks.
      const body: SendAgentMessageBody =
        attachments.length > 0
          ? { message: input.message || undefined, content: toContentBlocks(input) }
          : { message: input.message };
      const { data } = await sendAgentMessage(agentId, body);
      return data;
    },
    onMutate: (input) => {
      const pending: ReflexStreamEvent = {
        id: `pending-${Date.now()}`,
        streamId: 'pending',
        type: 'message',
        payload: {
          message: pendingUserMessageText(
            input.message,
            (input.attachments ?? []).map((a) => a.name),
          ),
        },
        timestamp: Date.now(),
        origin: 'USER_EVENT',
      };
      queryClient.setQueryData<ReflexStreamEvent[]>(agentStreamKey(agentId), (old) => [
        ...(old ?? []),
        pending,
      ]);
      return { pendingId: pending.id };
    },
    onSuccess: (result, _input, context) => {
      // A 201 swaps the optimistic bubble for the real event; a 202
      // (accepted-but-pending, mailbox delivery) keeps it — durably
      // enqueued server-side is a success, never a retry, and the socket
      // echo reconciles the bubble away once the send lands.
      queryClient.setQueryData<ReflexStreamEvent[]>(agentStreamKey(agentId), (old) =>
        applySendMessageResult(old ?? [], result, context.pendingId),
      );
      // A 202's command can still fail after the server's bounded wait, and
      // that outcome has no read surface — no stream event will ever arrive
      // for it. Expire the optimistic bubble after a generous bound so a
      // dead send does not read "Sending…" forever (direct-delivery parity:
      // a failed send removes the bubble). A confirmed send is unaffected —
      // the socket echo reconciles the entry away before the timer fires,
      // and expiring an already-confirmed id is a no-op.
      if (isAgentCommandAccepted(result)) {
        const { pendingId } = context;
        setTimeout(() => {
          queryClient.setQueryData<ReflexStreamEvent[]>(agentStreamKey(agentId), (old) =>
            expireAcceptedSend(old ?? [], pendingId),
          );
        }, ACCEPTED_SEND_EXPIRY_MS);
      }
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<ReflexStreamEvent[]>(agentStreamKey(agentId), (old) =>
        (old ?? []).filter((e) => e.id !== context.pendingId),
      );
    },
  });
}
