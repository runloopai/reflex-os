import { Box, Text, useInput } from 'ink';
import type { PermissionItem } from '../chat/transcript.js';
import { toolHeadline } from '../chat/format.js';

export type PermissionChoice = 'allow' | 'allow-always' | 'deny' | 'deny-interrupt';

interface PermissionPromptProps {
  item: PermissionItem;
  onDecide: (choice: PermissionChoice) => void;
  busy: boolean;
}

/**
 * Consent prompt for a Claude `can_use_tool` control request, mirroring the
 * web chat's Allow / Always allow / Deny / Interrupt actions on single keys.
 */
export function PermissionPrompt({ item, onDecide, busy }: PermissionPromptProps) {
  useInput((input, key) => {
    if (busy) return;
    if (input === 'y') onDecide('allow');
    if (input === 'a') onDecide('allow-always');
    if (input === 'n' || key.escape) onDecide('deny');
    if (input === 'i') onDecide('deny-interrupt');
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text color="yellow" bold>
        Permission required
      </Text>
      <Text wrap="wrap">
        The agent wants to use{' '}
        <Text bold>{toolHeadline(item.toolName ?? 'a tool', item.input)}</Text>
      </Text>
      <Box marginTop={1}>
        <Text dimColor>
          {busy
            ? 'sending…'
            : `y allow once · a always allow ${item.toolName ?? 'tool'} this session · n deny · i deny + interrupt`}
        </Text>
      </Box>
    </Box>
  );
}
