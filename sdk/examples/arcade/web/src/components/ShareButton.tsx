/**
 * Share a game, the arcade, or a build that just shipped.
 *
 * The link is the product here: pasted anywhere, it unfurls into a card
 * with the agent's own cover art (see `server/share.ts`). This is the
 * quickest possible way to get one onto a clipboard, into a post, or into
 * the OS share sheet.
 *
 * Phones get that OS sheet when they have one — Slack, iMessage, Discord
 * and the rest already live there, and no menu of ours beats it.
 * Everywhere else gets the menu below: copy first, because most shares are
 * a paste into a group chat, then a grid of networks.
 *
 * Every link carries `utm_*` (see `lib/share.ts`), so an arrival can be
 * traced back to the post that sent it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { Tip } from './Tip.tsx';
import { SHARE_TARGETS, copyShareUrl, shareText } from '../lib/share.ts';
import type { ShareSubject } from '../lib/share.ts';

/** Enough for the copy row, three rows of networks, and the hint. */
const MENU_HEIGHT = 240;

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

export function ShareButton({
  url,
  title,
  text,
  label = 'Share this game',
  cta,
  hint = "The link unfurls with the agent's cover art wherever you paste it.",
  className = '',
}: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Opens upward when there is no room below. The suggestions panel is a
  // scroller and the hero is `overflow-hidden`; a menu that only ever drops
  // down is cut off on any trigger near the bottom of either.
  const [dropUp, setDropUp] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setDropUp(window.innerHeight - rect.bottom < MENU_HEIGHT && rect.top > MENU_HEIGHT);
  }, [open]);

  // Escape closes and hands focus back, the way any menu should.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const subject: ShareSubject = { url, title, text: text ?? shareText(title) };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyShareUrl(url));
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure origin, denied permission): the menu
      // stays open with the link selectable, which is the manual path.
    }
  };

  const share = async () => {
    // `navigator.share` must be called from the gesture, so nothing is
    // awaited before it or Safari rejects the call as untrusted.
    if (navigator.share) {
      try {
        await navigator.share({ title, text: subject.text, url: copyShareUrl(url) });
        return;
      } catch {
        // Cancelled or unavailable — fall through to the menu.
      }
    }
    setOpen((wasOpen) => !wasOpen);
  };

  return (
    <div className={`relative ${className}`}>
      <Tip label={label}>
        <button
          ref={trigger}
          type="button"
          onClick={() => void share()}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          className={
            cta
              ? 'flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs font-medium text-zinc-300 hover:bg-white/5 hover:text-zinc-100 pointer-coarse:h-10'
              : 'flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 pointer-coarse:h-10 pointer-coarse:w-10'
          }
        >
          <Share2 size={14} aria-hidden />
          {cta}
        </button>
      </Tip>
      {open ? (
        <>
          {/* Catches the click that dismisses the menu, including on touch,
              where there is no blur to listen for. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label={label}
            className={`absolute right-0 z-40 w-64 rounded-xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl ${
              dropUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
            }`}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void copy()}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-300 hover:bg-white/5 hover:text-zinc-100 pointer-coarse:min-h-11"
            >
              {copied ? (
                <Check size={14} className="text-emerald-400" aria-hidden />
              ) : (
                <Copy size={14} aria-hidden />
              )}
              {copied ? 'Link copied' : 'Copy link'}
            </button>
            {/* A grid, not a list: nine networks as rows would be a scroll,
                and the label is the whole affordance (this lucide version
                ships no brand glyphs, and bundling our own would mean
                shipping nine trademarks). */}
            <div role="none" className="mt-1 grid grid-cols-3 gap-1">
              {SHARE_TARGETS.map((target) => (
                <a
                  key={target.id}
                  role="menuitem"
                  href={target.href(subject)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Share on ${target.label}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center rounded-lg px-1.5 py-2 text-center text-xs text-zinc-300 hover:bg-white/5 hover:text-zinc-100 pointer-coarse:min-h-11"
                >
                  {target.label}
                </a>
              ))}
            </div>
            <p role="none" className="px-2.5 pt-2 pb-1 text-[11px] leading-snug text-zinc-600">
              {hint}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
