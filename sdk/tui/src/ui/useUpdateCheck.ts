import { useEffect, useState } from 'react';
import { checkForUpdate } from '../update/check.js';
import { CLI_VERSION } from '../update/version.js';

export interface UpdateState {
  /** The published version, only ever set when it is newer than `current`. */
  latest: string;
  current: string;
}

/**
 * Ask npm once per session whether a newer reflex-cli is published. Nothing
 * renders until an answer arrives, and a check that fails stays silent — the
 * notice is a courtesy, never something the TUI waits on.
 */
export function useUpdateCheck(): UpdateState | null {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkForUpdate().then((found) => {
      if (!cancelled) setLatest(found);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return latest && CLI_VERSION ? { latest, current: CLI_VERSION } : null;
}
