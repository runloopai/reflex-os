import { createInterface } from 'node:readline/promises';
import { UsageError } from './errors.js';

/**
 * Gate a destructive command: prompt y/N on a TTY, require `--yes` in a
 * pipe. Throws UsageError (exit 2) when non-interactive without --yes;
 * returns false when the user declines interactively.
 */
export async function confirmOrAbort(message: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    throw new UsageError(`${message}\nRefusing without --yes in a non-interactive run.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
