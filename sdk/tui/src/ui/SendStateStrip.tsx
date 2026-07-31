import { Box, Text } from 'ink';
import type { QueuedMessage } from '@runloop/reflex-contract';
import type { PendingSend } from '../chat/transcript.js';
import { clip } from '../chat/format.js';

interface SendStateStripProps {
  pending: readonly PendingSend[];
  queue: readonly QueuedMessage[];
  spinnerFrame: string;
}

/**
 * Outbound-message state below the transcript, mirroring the web chat's
 * pending bubbles and server-owned queue list:
 *
 * - `sending` — optimistic copy of a sent message awaiting its stream echo
 *   (the echo becomes the real transcript line and clears the entry).
 * - `unconfirmed` / `failed` — the echo never came; `/retry` or `/dismiss`.
 * - queued — held server-side while the agent works, drained one per turn;
 *   `/unqueue <n>` removes one.
 */
export function SendStateStrip({ pending, queue, spinnerFrame }: SendStateStripProps) {
  if (pending.length === 0 && queue.length === 0) return null;
  return (
    <Box flexDirection="column">
      {pending.map((send) => (
        <Box key={send.clientId} flexDirection="column" marginTop={1}>
          <Box gap={1}>
            <Text
              color={
                send.status === 'sending'
                  ? 'cyan'
                  : send.status === 'unconfirmed'
                    ? 'yellow'
                    : 'red'
              }
            >
              {send.status === 'sending' ? spinnerFrame : send.status === 'unconfirmed' ? '?' : '✗'}
            </Text>
            <Text dimColor={send.status === 'sending'} wrap="wrap">
              {send.text}
            </Text>
          </Box>
          {send.attachments.map((name) => (
            <Text key={name} dimColor>
              {'  ⎘ '}
              {name}
            </Text>
          ))}
          <Text dimColor>
            {'  '}
            {send.status === 'sending'
              ? 'sending…'
              : `${send.error ?? 'not delivered'} · /retry · /dismiss`}
          </Text>
        </Box>
      ))}
      {queue.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {queue.map((msg, i) => (
            <Box key={msg.id} gap={1}>
              <Text color="yellow">⧗</Text>
              <Text dimColor wrap="truncate-end">
                {i + 1}. {clip(msg.text, 100)}
                {msg.attachments?.length ? ` (+${msg.attachments.length} files)` : ''}
              </Text>
            </Box>
          ))}
          <Text dimColor>
            {'  '}queued — delivers when the agent is ready · /unqueue {'<n>'} removes
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
