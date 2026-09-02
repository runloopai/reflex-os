/**
 * Giving the game the whole screen.
 *
 * Two things have to happen for that, and they are not the same thing. The
 * browser's Fullscreen API is what removes the browser's OWN chrome — tabs,
 * address bar, the phone's status bar — and only it can. Everything the
 * arcade paints (nav, sidebar, dock) is removed by CSS. So this module owns
 * the first half and hands the caller a flag for the second: an "immersive"
 * stage is always laid out over the app, and it is ALSO natively fullscreen
 * wherever the browser allows it.
 *
 * The split is not defensive coding — it is iOS. Safari on iPhone has no
 * element fullscreen at all (only `<video>`), so a design that assumed
 * `requestFullscreen` would leave the phones this app is most played on with
 * a dead button. The CSS half works everywhere; the native half is an upgrade.
 *
 * Every call is total: a request can be rejected (no user gesture, an
 * embedding page's permissions policy) and a rejection is an answer, not a
 * crash — `enterFullscreen` reports it so the caller can fall back.
 */

/** The prefixed shapes still shipping: Safari desktop keeps `webkit`. */
interface FullscreenDocument {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void> | void;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface FullscreenElement {
  requestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
}

/**
 * Both spellings, because a document only ever has one of them and a view
 * that listened for the wrong one would never learn the user pressed Escape.
 */
export const FULLSCREEN_EVENTS = ['fullscreenchange', 'webkitfullscreenchange'] as const;

/** What the browser currently has fullscreen, if anything. */
export function fullscreenElement(doc: FullscreenDocument): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** Whether this element can go natively fullscreen — false on iPhone Safari. */
export function canFullscreen(element: FullscreenElement | null): boolean {
  return Boolean(element && (element.requestFullscreen ?? element.webkitRequestFullscreen));
}

/**
 * Ask for native fullscreen. Resolves to whether the browser granted it, so
 * an unsupported or refused request degrades to the CSS-only stage instead of
 * an unhandled rejection and a button that appears to do nothing.
 */
export async function enterFullscreen(element: FullscreenElement | null): Promise<boolean> {
  const request = element?.requestFullscreen ?? element?.webkitRequestFullscreen;
  if (!request || !element) return false;
  try {
    await request.call(element);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hand the screen back. A no-op when nothing is fullscreen — the CSS-only
 * stage exits through the same path, and calling `exitFullscreen` with no
 * fullscreen element rejects.
 */
export async function leaveFullscreen(doc: FullscreenDocument): Promise<void> {
  if (!fullscreenElement(doc)) return;
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  if (!exit) return;
  try {
    await exit.call(doc);
  } catch {
    // Already left, or the browser refused; the change event is the truth.
  }
}

/**
 * Whether a keystroke belongs to whoever is typing. The stream view is full
 * of text boxes — the room composer, the agent chat, a suggestion — and a
 * bare `f` shortcut that fires while someone writes "fix the jump" eats the
 * letter and throws them into fullscreen mid-sentence.
 */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  // Read the shape rather than `instanceof HTMLElement`: the constructor only
  // exists in a browser, and this rule is worth testing in node.
  const node = target as { tagName?: unknown; isContentEditable?: unknown };
  if (node.isContentEditable === true) return true;
  return typeof node.tagName === 'string' && TYPING_TAGS.has(node.tagName);
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
