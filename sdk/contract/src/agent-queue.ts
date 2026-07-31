import { z } from 'zod';
import { AttachmentSchema } from './attachments.js';

/**
 * A pending message waiting to be delivered to an agent. Server-owned: lives
 * in the `agent_message_queue` table and is drained one item at a time by
 * the agent-runner whenever the agent transitions to an "accepts input"
 * state (turn ended, needs input, completed). The client mirrors this list
 * via REST + WebSocket and can edit/remove/reorder rows while they wait.
 */
export const QueuedMessageSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  text: z.string(),
  attachments: z.array(AttachmentSchema).nullable(),
  position: z.number(),
  /**
   * User who enqueued the message, if known. Used to attribute the
   * published prompt bubble to the real sender when the queue is drained.
   * Null for pre-existing rows and unauthenticated/Slack enqueues.
   */
  userId: z.string().nullable(),
  createdAt: z.number(),
});
export type QueuedMessage = z.infer<typeof QueuedMessageSchema>;

export const EnqueueMessageRequestSchema = z
  .object({
    text: z.string(),
    attachments: z.array(AttachmentSchema).optional(),
  })
  .refine((data) => data.text.length > 0 || (data.attachments?.length ?? 0) > 0, {
    message: 'Message must contain text or at least one attachment',
    path: ['text'],
  });
export type EnqueueMessageRequest = z.infer<typeof EnqueueMessageRequestSchema>;

/**
 * Edit of a pending queue row. `attachments` is a full replacement of the
 * stored list — omit it to leave the attachments untouched, or send the
 * remaining ones (possibly empty) to drop an attachment. Like an enqueue, the
 * result has to carry something: an edit that would leave neither text nor
 * attachments is a delete, and callers must use `DELETE` for that.
 */
export const UpdateQueuedMessageRequestSchema = z
  .object({
    text: z.string(),
    attachments: z.array(AttachmentSchema).optional(),
  })
  .refine((data) => data.text.length > 0 || (data.attachments?.length ?? 0) > 0, {
    message: 'Message must contain text or at least one attachment',
    path: ['text'],
  });
export type UpdateQueuedMessageRequest = z.infer<typeof UpdateQueuedMessageRequestSchema>;

export const ReorderQueueRequestSchema = z.object({
  orderedIds: z.array(z.string()),
});
export type ReorderQueueRequest = z.infer<typeof ReorderQueueRequestSchema>;
