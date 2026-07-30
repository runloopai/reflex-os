/**
 * Anchored popover card: opens on hover (with a grace period) or click,
 * renders into a body portal so it never clips inside scroll panes, and
 * stays put while the pointer is over the card. Positioning is fixed,
 * measured from the trigger, and clamped to the viewport.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const CARD_WIDTH = 264;
const CLOSE_DELAY_MS = 150;

export function Popcard({
  content,
  children,
  className,
}: {
  /** Card body; rendered only while open. */
  content: React.ReactNode;
  /** Inline trigger. */
  children: React.ReactNode;
  className?: string;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const open = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - CARD_WIDTH - 8);
    setPos({ top: rect.bottom + 6, left });
  }, []);

  const scheduleClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPos(null), CLOSE_DELAY_MS);
  }, []);

  useEffect(() => () => void (closeTimer.current && clearTimeout(closeTimer.current)), []);
  // Any scroll drifts the anchor out from under the fixed card; just close.
  useEffect(() => {
    if (!pos) return;
    const onScroll = () => setPos(null);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [pos]);

  return (
    <span
      ref={anchorRef}
      className={`inline-flex min-w-0 ${className ?? ''}`}
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
      onClick={(e) => {
        // Triggers often live inside links/cards; a popover tap should
        // never also navigate the underlying surface.
        e.preventDefault();
        e.stopPropagation();
        if (pos) setPos(null);
        else open();
      }}
    >
      {children}
      {pos
        ? createPortal(
            <div
              role="dialog"
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: CARD_WIDTH }}
              className="z-50 rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-2xl shadow-black/50"
              onMouseEnter={open}
              onMouseLeave={scheduleClose}
              onClick={(e) => e.stopPropagation()}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
