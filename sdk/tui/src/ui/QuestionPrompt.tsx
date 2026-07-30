import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import type { QuestionItem } from '../chat/transcript.js';
import { ComposerInput } from './ComposerInput.js';

interface QuestionPromptProps {
  item: QuestionItem;
  /** Submit the collected answers (keyed by question text, labels joined ", "). */
  onSubmit: (answers: Record<string, string>) => void;
  /** Decline without answering; the agent continues with its best judgment. */
  onSkip: () => void;
  /** Decline and interrupt the turn. */
  onDismiss: () => void;
  busy: boolean;
}

/**
 * Claude-Code-style question card: arrow keys + number keys pick an option,
 * space toggles in multi-select, and a synthetic "Other" row switches to free
 * text. Multiple questions run one at a time; answers are submitted together
 * at the end, matching the web card's control-response payload.
 */
export function QuestionPrompt({ item, onSubmit, onSkip, onDismiss, busy }: QuestionPromptProps) {
  const questions = item.questions;
  const [questionIdx, setQuestionIdx] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<Map<number, Set<number>>>(new Map());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherDraft, setOtherDraft] = useState('');
  const [typingOther, setTypingOther] = useState(false);

  const question = questions[questionIdx];
  if (!question) return null;
  const optionCount = question.options.length;
  const otherIdx = optionCount; // synthetic trailing "Other" row
  const selected = picked.get(questionIdx) ?? new Set<number>();

  function toggle(index: number) {
    setPicked((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(questionIdx) ?? []);
      if (question.multiSelect) {
        if (set.has(index)) set.delete(index);
        else set.add(index);
      } else {
        set.clear();
        set.add(index);
      }
      next.set(questionIdx, set);
      return next;
    });
  }

  function commitAnswer(value: string | null) {
    const nextAnswers = { ...answers };
    if (value) nextAnswers[question.question] = value;
    if (questionIdx < questions.length - 1) {
      setAnswers(nextAnswers);
      setQuestionIdx(questionIdx + 1);
      setCursor(0);
      setTypingOther(false);
      setOtherDraft('');
      return;
    }
    if (Object.keys(nextAnswers).length === 0) {
      onSkip();
      return;
    }
    onSubmit(nextAnswers);
  }

  function selectedLabels(): string[] {
    return [...selected]
      .sort((a, b) => a - b)
      .map((i) => question.options[i]?.label)
      .filter((l): l is string => Boolean(l));
  }

  function confirmSelection() {
    const labels = selectedLabels();
    commitAnswer(labels.length > 0 ? labels.join(', ') : null);
  }

  /** Free-text answer; in multi-select it joins any toggled options. */
  function commitOther(text: string) {
    const parts = question.multiSelect ? [...selectedLabels(), text] : [text];
    commitAnswer(parts.join(', '));
  }

  useInput(
    (input, key) => {
      if (busy) return;
      if (key.escape) {
        onSkip();
        return;
      }
      if (key.ctrl && input === 'd') {
        onDismiss();
        return;
      }
      if (key.upArrow || input === 'k') setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow || input === 'j') setCursor((c) => Math.min(otherIdx, c + 1));
      if (input >= '1' && input <= '9') {
        const index = Number(input) - 1;
        if (index < optionCount) {
          setCursor(index);
          toggle(index);
          if (!question.multiSelect) {
            // Number keys answer single-select immediately, like Claude Code.
            const label = question.options[index]?.label;
            if (label) commitAnswer(label);
          }
        }
        return;
      }
      if (input === ' ' && question.multiSelect && cursor < optionCount) {
        toggle(cursor);
        return;
      }
      if (key.return) {
        if (cursor === otherIdx) {
          setTypingOther(true);
          return;
        }
        if (!question.multiSelect) toggle(cursor);
        if (question.multiSelect) {
          confirmSelection();
        } else {
          const label = question.options[cursor]?.label;
          commitAnswer(label ?? null);
        }
      }
    },
    { isActive: !typingOther },
  );

  useInput(
    (_input, key) => {
      if (key.escape) {
        setTypingOther(false);
        setOtherDraft('');
      }
    },
    { isActive: typingOther },
  );

  const counter = questions.length > 1 ? ` ${questionIdx + 1} of ${questions.length}` : '';
  const header = question.header ? ` — ${question.header}` : '';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text color="cyan" bold>
        Question{counter}
        {header}
      </Text>
      <Text wrap="wrap">{question.question}</Text>
      <Box flexDirection="column" marginTop={1}>
        {question.options.map((option, i) => {
          const isCursor = i === cursor && !typingOther;
          const isPicked = selected.has(i);
          return (
            <Box key={i} gap={1}>
              <Text color="cyan">{isCursor ? '❯' : ' '}</Text>
              <Text color={isPicked ? 'green' : undefined} bold={isCursor} wrap="truncate-end">
                {question.multiSelect ? (isPicked ? '☑ ' : '☐ ') : ''}
                {i + 1}. {option.label}
                {option.description ? <Text dimColor> — {option.description}</Text> : null}
              </Text>
            </Box>
          );
        })}
        <Box gap={1}>
          <Text color="cyan">{cursor === otherIdx && !typingOther ? '❯' : ' '}</Text>
          {typingOther ? (
            <Box gap={1}>
              <Text bold>Other:</Text>
              <ComposerInput
                value={otherDraft}
                onChange={setOtherDraft}
                onSubmit={(value) => {
                  const text = value.trim();
                  if (text) commitOther(text);
                }}
                placeholder="type your answer"
              />
            </Box>
          ) : (
            <Text bold={cursor === otherIdx} dimColor={cursor !== otherIdx}>
              Other (type your own)
            </Text>
          )}
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {busy
            ? 'sending…'
            : typingOther
              ? 'enter submit · esc back to options'
              : question.multiSelect
                ? 'space toggle · enter confirm · ↑/↓ move · esc skip · ^d dismiss'
                : '1-9 pick · enter confirm · ↑/↓ move · esc skip · ^d dismiss'}
        </Text>
      </Box>
    </Box>
  );
}
