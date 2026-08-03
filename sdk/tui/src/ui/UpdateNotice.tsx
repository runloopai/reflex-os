import { Text } from 'ink';
import type { UpdateState } from './useUpdateCheck.js';

/** One line saying a newer CLI is published, and the key that installs it. */
export function UpdateNotice({ update }: { update: UpdateState }) {
  return (
    <Text color="yellow">
      update available {update.current} → {update.latest} · press u to install
    </Text>
  );
}
