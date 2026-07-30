import { useEffect, useState } from 'react';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Braille spinner frame, ticking only while `active` to avoid idle re-renders. */
export function useSpinnerFrame(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), 80);
    return () => clearInterval(timer);
  }, [active]);
  return FRAMES[frame];
}

/** Whole seconds elapsed since `sinceMs`, ticking once a second while set. */
export function useElapsedSeconds(sinceMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (sinceMs === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sinceMs]);
  if (sinceMs === null) return 0;
  return Math.max(0, Math.round((now - sinceMs) / 1000));
}
