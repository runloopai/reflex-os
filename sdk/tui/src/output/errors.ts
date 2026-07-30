import { ReflexApiError } from '@runloop/reflex-client';

/** A caller mistake (bad arguments), reported plainly and exiting 2. */
export class UsageError extends Error {}

/**
 * One place that turns a thrown error into the single stderr line a command
 * prints. API errors carry status + code + the server message, then a hint
 * for the failures with an obvious next step; everything else falls back to
 * the error message.
 */
export function formatCliError(err: unknown): string {
  if (err instanceof ReflexApiError) {
    const code = err.code ? ` (${err.code})` : '';
    const hint = err.hint ?? defaultHint(err.status);
    return `API error ${err.status}${code}: ${err.message}${hint ? `\n${hint}` : ''}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function defaultHint(status: number): string | undefined {
  if (status === 401) return 'Run `reflex-cli login` to refresh your credentials.';
  if (status === 403)
    return 'Check the org you are targeting (`--org`, REFLEX_ORG) and your role in it.';
  if (status === 404) return 'Check the id; `reflex-cli` accepts full ids only for now.';
  return undefined;
}
