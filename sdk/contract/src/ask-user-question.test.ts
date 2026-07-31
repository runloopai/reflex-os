import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  AskUserQuestionDetailSchema,
  AskUserQuestionItemSchema,
  AskUserQuestionOptionSchema,
  type AskUserQuestionDetail,
  type AskUserQuestionItem,
  type AskUserQuestionOption,
} from './ask-user-question.js';

describe('AskUserQuestion schemas', () => {
  it('parses a valid single-select detail', () => {
    const result = AskUserQuestionDetailSchema.safeParse({
      questions: [
        {
          header: 'Clarify',
          question: "What do you mean by 'the box'?",
          multiSelect: false,
          options: [
            { label: 'A file/directory', description: "A file or folder named 'box'" },
            { label: 'A Docker container' },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.questions).toHaveLength(1);
      expect(result.data.questions[0].multiSelect).toBe(false);
      expect(result.data.questions[0].options).toHaveLength(2);
    }
  });

  it('defaults multiSelect to false when omitted', () => {
    const result = AskUserQuestionItemSchema.safeParse({
      question: 'Pick one',
      options: [{ label: 'Yes' }, { label: 'No' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.multiSelect).toBe(false);
    }
  });

  it('description is optional on options', () => {
    const result = AskUserQuestionOptionSchema.safeParse({ label: 'Yes' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
    }
  });

  it('inferred types are correct', () => {
    expectTypeOf<AskUserQuestionOption>().toMatchTypeOf<{ label: string; description?: string }>();
    expectTypeOf<AskUserQuestionItem>().toMatchTypeOf<{
      question: string;
      multiSelect: boolean;
      options: AskUserQuestionOption[];
    }>();
    expectTypeOf<AskUserQuestionDetail>().toMatchTypeOf<{
      questions: AskUserQuestionItem[];
    }>();
  });
});
