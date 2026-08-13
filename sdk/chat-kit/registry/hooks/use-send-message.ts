/**
 * Send-message mutation with an optimistic pending bubble.
 *
 * Sends plain text, or text plus attachments as `image`/`file` content
 * blocks (the wire shape `sendAgentMessage` accepts). Appends a `pending-*`
 * user event to the stream cache immediately, then replaces it with the
 * real event returned by the server (or removes it on failure). The pending
 * id prefix is what `event-utils`' builders use to render the in-flight
 * state.
 *
 * You own this file; add retry UX or toasts as your product needs.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { sendAgentMessage } from '@runloop/reflex-client';
import type { ReflexStreamEvent, SendAgentMessageBody } from '@runloop/reflex-client';
import { agentStreamKey } from './use-agent-stream';
import { deduplicateEvents, reconcilePendingEvents } from '../lib/event-utils';

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

export function useSendMessage(
  agentId: string,
): UseMutationResult<ReflexStreamEvent, Error, OutgoingMessage, SendMessageContext> {
  const queryClient = useQueryClient();

  return useMutation<ReflexStreamEvent, Error, OutgoingMessage, SendMessageContext>({
    mutationFn: async (input: OutgoingMessage) => {
      const attachments = input.attachments ?? [];
      // Plain text goes as `message` (broadest compatibility); anything with
      // attachments switches to content blocks.
      const body: SendAgentMessageBody =
        attachments.length > 0
          ? { message: input.message || undefined, content: toContentBlocks(input) }
          : { message: input.message };
      const { data } = await sendAgentMessage(agentId, body);
      if ('commandId' in data) {
        // 202 accepted-but-pending (asynchronous command delivery): the
        // message is durably enqueued server-side — a success, never a
        // retry. Synthesize a local ack; the stream carries the real
        // events once the send lands.
        return {
          id: `accepted-${data.commandId}`,
          streamId: 'pending',
          type: 'message',
          payload: null,
          timestamp: Date.now(),
        };
      }
      return data;
    },
    onMutate: (input) => {
      const suffix =
        (input.attachments?.length ?? 0) > 0
          ? `\n📎 ${input.attachments!.map((a) => a.name).join(', ')}`
          : '';
      const pending: ReflexStreamEvent = {
        id: `pending-${Date.now()}`,
        streamId: 'pending',
        type: 'message',
        payload: { message: `${input.message}${suffix}` },
        timestamp: Date.now(),
        origin: 'USER_EVENT',
      };
      queryClient.setQueryData<ReflexStreamEvent[]>(agentStreamKey(agentId), (old) => [
        ...(old ?? []),
        pending,
      ]);
      return { pendingId: pending.id };
    },
    onSuccess: (event, _input, context) => {
      queryClient.setQueryData<ReflexStreamEvent[]>(agentStreamKey(agentId), (old) =>
        reconcilePendingEvents(
          deduplicateEvents([...(old ?? []).filter((e) => e.id !== context.pendingId), event]),
        ),
      );
    },
    onError: (_error, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<ReflexStreamEvent[]>(agentStreamKey(agentId), (old) =>
        (old ?? []).filter((e) => e.id !== context.pendingId),
      );
    },
  });
}
