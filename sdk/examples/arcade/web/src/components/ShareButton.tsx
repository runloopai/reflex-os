/**
 * Share a game, the arcade, or a build that just shipped.
 *
 * The link is the product here: pasted anywhere, it unfurls into a card
 * with the agent's own cover art (see `server/share.ts`). So the menu leads
 * with the link itself — shown, readable, one button from the clipboard —
 * because most shares are a paste into a group chat. Under it, the nine
 * networks as a share-sheet grid, each with its own logo in its own colour
 * (`brand-marks.ts`) — findable at a glance in a way nine identical grey
 * labels were not.
 *
 * Phones go straight to the OS share sheet, where Slack, iMessage and
 * Discord already live and no menu of ours competes. Desktops get this menu
 * even when they have `navigator.share`, because the desktop share sheet is
 * a short list of nothing anyone wants — it stays reachable as "More apps".
 *
 * The menu renders into a body portal with fixed positioning, like `Tip`:
 * two of its three call sites sit inside `overflow-hidden` cards (the hero
 * shelf, the suggestions scroller), where an absolutely-positioned popover
 * is clipped rather than shown.
 *
 * Every link carries `utm_*` (see `lib/share.ts`), so an arrival can be
 * traced back to the post that sent it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Link2, Share2 } from 'lucide-react';
import { Tip } from './Tip.tsx';
import { BRAND_MARKS } from '../lib/brand-marks.ts';
import { SHARE_TARGETS, copyShareUrl, displayShareUrl, shareText } from '../lib/share.ts';
import type { ShareSubject } from '../lib/share.ts';

const MENU_WIDTH = 288;
/** Breathing room between the menu and the trigger, and the screen edge. */
const GAP = 8;
const EDGE = 8;

interface MenuPosition {
  top: number;
  left: number;
}

export interface ShareButtonProps {
  /** Canonical URL of the thing being shared; attribution is added per target. */
  url: string;
  /** Title of the thing being shared (a game name, or the arcade). */
  title: string;
  /**
   * The pitch that travels with the link. Defaults to the game pitch, so
   * the common case stays a two-prop call.
   */
  text?: string;
  /** Button + menu label, e.g. "Share this game" (the accessible name). */
  label?: string;
  /** Shown next to the icon; icon-only when omitted. */
  cta?: string;
  /** The line under the targets, for subjects with a different card. */
  hint?: string;
  className?: string;
}

/**
 * Whether to hand off to the OS instead of opening this menu. Coarse
 * pointer only: `navigator.share` also exists on desktop Chrome and Edge,
 * where short-circuiting to the system sheet would mean this menu was
 * never seen on the platform most sharing is done from.
 */
function prefersSystemShare(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export function ShareButton({
  url,
  title,
  text,
  label = 'Share this game',
  cta,
  hint = "Unfurls with the agent's cover art when pasted.",
  className = '',
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Null until the menu has been measured — see `place` below.
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  /**
   * Pin the menu to the trigger in viewport coordinates: right-aligned,
   * below when there is room and flipped above when there is not, and
   * always clamped inside the screen. Measured rather than assumed — the
   * menu's height depends on whether the "More apps" row is there.
   */
  const place = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    const height = menu.current?.offsetHeight ?? 0;
    if (!anchor || !height) return;
    const left = Math.min(
      Math.max(anchor.right - MENU_WIDTH, EDGE),
      Math.max(window.innerWidth - MENU_WIDTH - EDGE, EDGE),
    );
    const below = anchor.bottom + GAP;
    const above = anchor.top - GAP - height;
    const fitsBelow = below + height <= window.innerHeight - EDGE;
    const top =
      fitsBelow || above < EDGE ? Math.min(below, window.innerHeight - height - EDGE) : above;
    setPos({ top: Math.max(top, EDGE), left });
  }, []);

  // Before paint, so the menu is never seen at an unplaced position. The
  // last position is kept when it closes: reopening renders there for one
  // commit, and this runs — and corrects it — before that commit is painted.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Reposition rather than close: the suggestions panel is a scroller, and
  // a menu that vanishes the moment the list moves under it feels broken.
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  /**
   * Leave the menu. `returnFocus` for every path a person left it by — the
   * item they were on is about to unmount, and an element that loses focus
   * by being removed drops it to `body`, stranding a keyboard mid-page. Not
   * for a click on the scrim, where the pointer has already said where it
   * wants to be.
   */
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  // Escape closes and hands focus back, the way any menu should.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  /**
   * Focus the first item once the menu has somewhere to be. A `role="menu"`
   * that ignores the arrow keys is a promise the markup makes and the
   * behaviour breaks.
   *
   * It waits for `pos` rather than for `open` because focus on a
   * `visibility: hidden` element goes nowhere, and React flushes this
   * effect before it renders the placement update. The ref is what keeps it
   * to once per opening: `place` runs again on every scroll tick, and
   * re-running this would drag focus back to "Copy" mid-arrow-key.
   */
  const focusedOnOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      focusedOnOpen.current = false;
      return;
    }
    if (focusedOnOpen.current || !pos) return;
    focusedOnOpen.current = true;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, pos]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    // Tab leaves the menu the same way Escape does. Letting the default run
    // would tab out of a subtree that is unmounting under it, which lands
    // focus on `body` rather than anywhere a person can carry on from.
    if (event.key === 'Tab') {
      event.preventDefault();
      close(true);
      return;
    }
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const all = items();
    if (all.length === 0) return;
    // This only fires for keys pressed inside the menu, so the active
    // element is always one of its items.
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? all.length - 1
          : // Wrapping, so holding an arrow never dead-ends at a boundary.
            (at + (event.key === 'ArrowDown' ? 1 : all.length - 1) + all.length) % all.length;
    all[next]?.focus();
  };

  const subject: ShareSubject = { url, title, text: text ?? shareText(title) };
  const shareUrl = copyShareUrl(url);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, denied permission): the menu
      // stays open with the link selectable, which is the manual path.
    }
  };

  const systemShare = async () => {
    // `navigator.share` must be called from the gesture, so nothing is
    // awaited before it or Safari rejects the call as untrusted.
    try {
      await navigator.share?.({ title, text: subject.text, url: shareUrl });
      return true;
    } catch {
      // Cancelled or unavailable.
      return false;
    }
  };

  const onTriggerClick = () => {
    if (prefersSystemShare()) {
      void systemShare().then((shared) => {
        if (!shared) setOpen(true);
      });
      return;
    }
    setOpen((wasOpen) => !wasOpen);
  };

  /**
   * Inset and unoffset. The first item takes focus every time the menu
   * opens, so this ring is on screen constantly — an offset double ring
   * there reads as an error state rather than as a cursor. The tone is a
   * parameter because the ring sits on the copy row, which turns emerald
   * once it has copied, and a violet ring on a green row is a clash.
   */
  const focusRing = (tone: 'violet' | 'emerald') =>
    `outline-none focus-visible:ring-1 focus-visible:ring-inset ${
      tone === 'emerald' ? 'focus-visible:ring-emerald-400/70' : 'focus-visible:ring-violet-400/70'
    }`;
  const itemClass = focusRing('violet');

  return (
    <div className={`relative ${className}`}>
      <Tip label={label}>
        <button
          ref={trigger}
          type="button"
          onClick={onTriggerClick}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          className={`transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-500/70 ${
            cta
              ? `flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium pointer-coarse:h-10 ${
                  open
                    ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
                    : 'border-white/10 text-zinc-300 hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-violet-200'
                }`
              : `flex h-7 w-7 items-center justify-center rounded-lg border pointer-coarse:h-10 pointer-coarse:w-10 ${
                  open
                    ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
                    : 'border-white/10 text-zinc-400 hover:border-violet-400/40 hover:bg-violet-500/10 hover:text-violet-200'
                }`
          }`}
        >
          <Share2 size={14} aria-hidden />
          {cta}
        </button>
      </Tip>
      {/* Outside the menu, and mounted whether or not it is open: a live
          region announces a change to its contents, so one that appears
          already holding its message may never be read out. Copying is
          silent otherwise — the label swap on the button is invisible to a
          screen reader that has moved past it. */}
      <span aria-live="polite" className="sr-only">
        {copied ? 'Link copied to clipboard' : ''}
      </span>
      {open
        ? createPortal(
            <>
              {/* Catches the click that dismisses the menu, including on
                  touch, where there is no blur to listen for. */}
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                data-testid="share-scrim"
                className="fixed inset-0 z-40 cursor-default"
                onClick={() => close(false)}
              />
              {/* `short:` is the height axis, and a landscape phone is 342px
                  tall: at full size this menu is 350px, so it filled the
                  screen and turned into a scroller on the device people play
                  these games on. Denser chips and no explanatory hint bring
                  it to 260px, which still anchors under its trigger there.
                  `max-h`/`overflow-y` stay as the backstop for the shorter
                  window nobody planned for. */}
              <div
                ref={menu}
                role="menu"
                aria-label={label}
                onKeyDown={onMenuKeyDown}
                style={{
                  position: 'fixed',
                  width: MENU_WIDTH,
                  top: pos?.top ?? 0,
                  left: pos?.left ?? 0,
                  visibility: pos ? 'visible' : 'hidden',
                }}
                className="share-menu z-50 max-h-[calc(100dvh-1rem)] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-xl"
              >
                <p
                  role="none"
                  className="truncate px-1.5 pt-0.5 pb-2 text-[11px] text-zinc-500 short:pb-1.5"
                >
                  Share <span className="font-medium text-zinc-300">{title}</span>
                </p>

                {/* The link, shown before it is copied: the readable form,
                    while the clipboard gets the tagged one. Seeing where a
                    paste will send people is the whole reassurance.
                    The row IS the button — a button boxed inside a bordered
                    row was two nested rectangles saying one thing, and this
                    gives the most-used action the widest target in the menu. */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void copy()}
                  aria-label={copied ? 'Link copied' : 'Copy link'}
                  className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors pointer-coarse:min-h-11 ${focusRing(
                    copied ? 'emerald' : 'violet',
                  )} ${copied ? 'bg-emerald-500/10' : 'bg-white/[0.04] hover:bg-white/[0.08]'}`}
                >
                  {copied ? (
                    <Check size={13} aria-hidden className="shrink-0 text-emerald-400" />
                  ) : (
                    <Link2
                      size={13}
                      aria-hidden
                      className="shrink-0 text-zinc-500 transition-colors group-hover:text-zinc-300"
                    />
                  )}
                  <span
                    className={`min-w-0 flex-1 truncate font-mono text-[11px] transition-colors ${
                      copied ? 'text-emerald-300' : 'text-zinc-400 group-hover:text-zinc-200'
                    }`}
                  >
                    {displayShareUrl(url)}
                  </span>
                  <span
                    className={`flex shrink-0 items-center gap-1 text-[11px] font-semibold transition-colors ${
                      copied ? 'text-emerald-300' : 'text-violet-300 group-hover:text-violet-200'
                    }`}
                  >
                    {copied ? 'Copied' : <Copy size={12} aria-hidden />}
                  </span>
                </button>
                {/* A grid, not a list: nine networks as rows would be a
                    scroll, and a share sheet is the shape people already
                    know from every phone they own. */}
                <div
                  role="none"
                  className="mt-2 grid grid-cols-3 gap-0.5 border-t border-white/[0.06] pt-2 short:mt-1.5 short:pt-1.5"
                >
                  {SHARE_TARGETS.map((target) => (
                    <a
                      key={target.id}
                      role="menuitem"
                      href={target.href(subject)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Share on ${target.label}`}
                      onClick={() => close(true)}
                      style={{ ['--accent' as string]: target.accent }}
                      className={`group flex flex-col items-center gap-1.5 rounded-xl px-1 py-1.5 transition-colors hover:bg-white/5 focus-visible:bg-white/5 short:gap-1 short:py-1 ${itemClass}`}
                    >
                      <span
                        aria-hidden
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.05] text-[var(--accent)] ring-1 ring-white/10 transition-colors ring-inset group-hover:bg-[color-mix(in_oklab,var(--accent)_20%,transparent)] group-hover:ring-[color-mix(in_oklab,var(--accent)_45%,transparent)] group-focus-visible:bg-[color-mix(in_oklab,var(--accent)_20%,transparent)] short:h-8 short:w-8"
                      >
                        {/* The brand's own mark, all nine on one 24-grid and
                            filled with `currentColor` — see brand-marks.ts.

                            The colour is the glyph, not the disc behind it.
                            Nine filled colour discs fought each other and the
                            app around them, and they were not even earning
                            it: four of these brands (Bluesky, LinkedIn,
                            Facebook, Telegram) are the same mid blue, so the
                            colour never was what told them apart — the logo
                            is. On one neutral chip the marks read as a set,
                            and the brand tint comes back on hover, where it
                            means "this one". Going monochrome at rest was the
                            other option and it read as disabled. */}
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                          <path d={BRAND_MARKS[target.id]} />
                        </svg>
                      </span>
                      <span className="text-[10px] text-zinc-400 transition-colors group-hover:text-zinc-100 group-focus-visible:text-zinc-100">
                        {target.label}
                      </span>
                    </a>
                  ))}
                </div>

                {/* Desktops that do have a system sheet keep it — one row
                    down, rather than in place of everything above. */}
                {typeof navigator !== 'undefined' && typeof navigator.share === 'function' ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close(true);
                      void systemShare();
                    }}
                    className={`mt-1 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 pointer-coarse:min-h-11 ${itemClass}`}
                  >
                    <Share2 size={13} aria-hidden className="shrink-0" />
                    More apps…
                  </button>
                ) : null}

                <p
                  role="none"
                  className="px-1.5 pt-2 pb-0.5 text-[10px] leading-snug text-zinc-500 short:hidden"
                >
                  {hint}
                </p>
              </div>
            </>,
            // While an element is fullscreen the browser paints only that
            // subtree, so a menu portalled to the body is invisible — and
            // the share trigger sits in the stage header, which is exactly
            // what goes fullscreen. Same rule as `Tip`.
            document.fullscreenElement ?? document.body,
          )
        : null}
    </div>
  );
}
