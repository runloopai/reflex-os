/**
 * View state that belongs in the URL.
 *
 * Which tab of a game you are reading, or how a shelf is sorted, is part of
 * where you ARE — keeping it in React state alone means a refresh silently
 * moves you somewhere else, and a link you paste to someone opens on a
 * different screen than the one you were looking at. This keeps such state
 * in the query string, which makes refresh, Back, and sharing all work
 * without any of them being special-cased.
 *
 * The default value is never written to the URL, so ordinary links stay
 * clean (`/g/abc`, not `/g/abc?tab=chat`).
 */
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Read one param, falling back when it is missing or not a value this
 * surface knows. Pure and total: a hand-edited or stale URL degrades to the
 * default instead of rendering an empty screen.
 */
export function parseUrlValue<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/**
 * What a value is worth in the URL: itself, or `null` when it is the
 * default and belongs nowhere. One rule, so a writer that sets two params
 * at once cannot disagree with `useUrlState` about what a clean URL is.
 */
export function urlParam<T extends string>(value: T, fallback: T): string | null {
  return value === fallback ? null : value;
}

/**
 * Apply several params at once. `null` removes a param, which is how a
 * default stays out of the URL.
 */
export function applyUrlPatch(
  current: URLSearchParams,
  patch: Record<string, string | null>,
): URLSearchParams {
  const updated = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) updated.delete(key);
    else updated.set(key, value);
  }
  return updated;
}

export function useUrlState<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const value = parseUrlValue(params.get(key), allowed, fallback);

  const setValue = useCallback(
    (next: T) => {
      setParams(
        (current) => applyUrlPatch(current, { [key]: urlParam(next, fallback) }),
        // Replacing keeps Back meaning "leave this page" rather than walking
        // every tab you glanced at on the way.
        { replace: true },
      );
    },
    [setParams, key, fallback],
  );

  return useMemo(() => [value, setValue], [value, setValue]);
}

/**
 * Move two pieces of URL state in one navigation.
 *
 * `useSearchParams` hands its setter the params of the render it came from,
 * so calling two `useUrlState` setters in one handler silently drops the
 * first write. The phone dock moves the panel and the room together, so it
 * writes them together.
 */
export function useUrlPatch(): (patch: Record<string, string | null>) => void {
  const [, setParams] = useSearchParams();
  return useCallback(
    (patch) => {
      setParams((current) => applyUrlPatch(current, patch), { replace: true });
    },
    [setParams],
  );
}
