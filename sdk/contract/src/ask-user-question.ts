import { z } from 'zod';

/**
 * The payload an agent emits when it needs a decision from the user, and the
 * shape a client renders it with. Carried on the agent event stream, so any
 * client that shows a conversation has to parse it.
 */
export const AskUserQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});
export type AskUserQuestionOption = z.infer<typeof AskUserQuestionOptionSchema>;

export const AskUserQuestionItemSchema = z.object({
  header: z.string().optional(),
  question: z.string(),
  multiSelect: z.boolean().default(false),
  options: z.array(AskUserQuestionOptionSchema),
});
export type AskUserQuestionItem = z.infer<typeof AskUserQuestionItemSchema>;

export const AskUserQuestionDetailSchema = z.object({
  questions: z.array(AskUserQuestionItemSchema),
});
export type AskUserQuestionDetail = z.infer<typeof AskUserQuestionDetailSchema>;
