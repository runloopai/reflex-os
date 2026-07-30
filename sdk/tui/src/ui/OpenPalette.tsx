import { Box, Text } from 'ink';
import type { PickOption } from '../launch/options.js';
import { SelectList } from './SelectList.js';

interface OpenPaletteProps {
  links: PickOption[];
  onPick: (url: string) => void;
  onClose: () => void;
}

/**
 * ctrl+o palette: everything associated with this agent that opens in a
 * browser — its web page, pull requests it opened (with live status), and
 * daemons serving on the devbox (tunnel URLs).
 */
export function OpenPalette({ links, onPick, onClose }: OpenPaletteProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text color="cyan" bold>
        Open in browser
      </Text>
      <SelectList
        options={links}
        onPick={(option) => {
          if (option.value) onPick(option.value);
        }}
        onBack={onClose}
      />
      <Text dimColor>enter open · esc close</Text>
    </Box>
  );
}
