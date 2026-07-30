import { Box, Text, useInput } from 'ink';
import { useEffect, useRef, useState } from 'react';
import type { PendingApproval, ToolApprover } from '../connect/policy.js';
import { ringBell } from './terminal.js';

/**
 * Track the approver's head-of-queue approval as React state. Each new
 * approval rings the terminal bell — unanswered prompts deny after five
 * minutes, so a backgrounded pane must be nudged.
 */
export function useApproverPending(approver: ToolApprover | null): PendingApproval | null {
  const [pending, setPending] = useState<PendingApproval | null>(approver?.current() ?? null);
  useEffect(() => {
    if (!approver) return;
    return approver.subscribe(setPending);
  }, [approver]);
  const prevCallIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (pending && pending.callId !== prevCallIdRef.current) ringBell();
    prevCallIdRef.current = pending?.callId ?? null;
  }, [pending]);
  return pending;
}

interface ApprovalPromptProps {
  approver: ToolApprover;
  pending: PendingApproval;
}

/**
 * Owner consent prompt for one exec/write call. Rendered as a modal by the
 * hosting app (which must suppress other text inputs while visible so the
 * y/a/n keys can't be swallowed — or worse, typed into a chat box).
 */
export function ApprovalPrompt({ approver, pending }: ApprovalPromptProps) {
  useInput((input) => {
    if (input === 'y') approver.resolveCurrent('allow-once');
    if (input === 'a') approver.resolveCurrent('allow-session');
    if (input === 'n') approver.resolveCurrent('deny');
  });

  const verb = pending.category === 'exec' ? 'run a command' : 'write a file';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        Approval needed{pending.agentId ? ` — agent ${pending.agentId}` : ''}
      </Text>
      <Text>
        wants to {verb}: <Text bold>{pending.summary || pending.tool}</Text>
      </Text>
      <Text dimColor>y allow once · a always allow {pending.category} this session · n deny</Text>
    </Box>
  );
}
