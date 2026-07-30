/**
 * Minimal hover tooltip. The visible bubble renders into a body portal
 * with fixed positioning, so it can never be clipped by overflow-hidden
 * cards or the viewport edge (it flips below the trigger when there is no
 * room above, and clamps horizontally). An always-mounted sr-only node
 * keeps the label attached for assistive tech via aria-describedby.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

const SHOW_DELAY_MS = 150;
const GAP = 6;

export function Tip({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  /** Extra classes for the anchor wrapper — layout (e.g. `ml-auto`) must live here, since the wrapper is the flex child. */
  className?: string;
}) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);

  const show = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Flip below when the bubble would poke past the top of the screen.
      const below = rect.top < 44;
      setPos({
        top: below ? rect.bottom + GAP : rect.top - GAP,
        left: rect.left + rect.width / 2,
        below,
      });
    }, SHOW_DELAY_MS);
  };
  const hide = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    setPos(null);
  };

  useEffect(() => () => void (showTimer.current && clearTimeout(showTimer.current)), []);
  // Scrolling drifts the anchor out from under the fixed bubble; just hide.
  useEffect(() => {
    if (!pos) return;
    const onScroll = () => setPos(null);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [pos]);

  // Clamp the centered bubble inside the viewport once its width is known.
  useLayoutEffect(() => {
    if (!pos || !bubbleRef.current) return;
    const half = bubbleRef.current.offsetWidth / 2;
    const clamped = Math.min(Math.max(pos.left, 8 + half), window.innerWidth - 8 - half);
    if (Math.abs(clamped - pos.left) > 1) setPos({ ...pos, left: clamped });
  }, [pos]);

  return (
    <span
      ref={anchorRef}
      className={className ? `inline-flex ${className}` : 'inline-flex'}
      aria-describedby={id}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <span id={id} role="tooltip" className="sr-only">
        {label}
      </span>
      {pos
        ? createPortal(
            <span
              ref={bubbleRef}
              aria-hidden
              style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                transform: `translate(-50%, ${pos.below ? '0' : '-100%'})`,
              }}
              className="pointer-events-none z-50 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] whitespace-nowrap text-zinc-200 shadow-lg"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
