/**
 * Where a visitor came from, remembered long enough to matter.
 *
 * Shared links carry `utm_source` (see `lib/share.ts`). Nobody joins on the
 * page they land on, though — they watch a game first, open another, and
 * only then pick a name, by which point the parameter is several
 * navigations gone. So the first source seen this session is kept and sent
 * with the join, which is what makes "did that post bring anyone back?"
 * answerable at all.
 *
 * First touch wins: someone who arrives from a post and later follows a
 * link from a friend is still that post's arrival. Session storage, not
 * local: a new visit months later is a new arrival, not a stale credit.
 */

const KEY = 'reflex-arcade:source';

/** Only what our own links emit, so a crafted URL cannot write junk. */
const MAX_LENGTH = 32;
const ALLOWED = /^[a-z0-9_-]+$/;

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  // Rejected, not truncated: a cut-down value would invent a source that
  // no link of ours ever emitted.
  const source = value.trim().toLowerCase();
  return source.length <= MAX_LENGTH && ALLOWED.test(source) ? source : null;
}

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Storage blocked (private mode, embedded frame): attribution is a
    // nice-to-have, never a reason to break the page.
    return null;
  }
}

/**
 * Record the source in this URL, if it carries one and nothing was
 * recorded yet. Call once on load; safe to call again.
 */
export function captureSource(search: string = window.location.search): void {
  const box = store();
  if (!box || box.getItem(KEY)) return;
  const source = clean(new URLSearchParams(search).get('utm_source'));
  if (source) box.setItem(KEY, source);
}

/** The source this visit arrived with, or null for a direct visit. */
export function arrivalSource(): string | null {
  return clean(store()?.getItem(KEY));
}
