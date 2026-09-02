/**
 * The stage's fullscreen mode, as one piece of state a view can render from.
 *
 * `immersive` is the only thing the caller styles on: true means the stage
 * owns the screen, whether the browser granted real fullscreen or the CSS
 * overlay is standing in for it (iPhone Safari has no element fullscreen).
 * `native` is only for wording the control — "Exit fullscreen" versus a
 * layout that is merely covering the app.
 *
 * The browser, not this hook, is the source of truth while native fullscreen
 * is on: Escape, F11, and the phone's own gestures all leave it without
 * telling React, so the change event is what clears `immersive`. Nothing here
 * writes the mode to the URL on purpose — a fullscreen request needs a user
 * gesture, so a restored `?fullscreen=1` would be a promise the reload cannot
 * keep, and the player would land in a stage that says it is fullscreen and
 * is not.
 */
import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
  FULLSCREEN_EVENTS,
  canFullscreen,
  enterFullscreen,
  fullscreenElement,
  leaveFullscreen,
} from '../lib/fullscreen.ts';

export interface Fullscreen {
  /** The stage owns the screen — natively, or through the CSS overlay. */
  immersive: boolean;
  /** The browser's own chrome is gone too, so Escape is the way out. */
  native: boolean;
  toggle: () => void;
  exit: () => void;
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): Fullscreen {
  const [immersive, setImmersive] = useState(false);
  const [native, setNative] = useState(false);

  // Follow the browser out of fullscreen however it was left.
  useEffect(() => {
    const onChange = () => {
      if (fullscreenElement(document)) return;
      setNative(false);
      setImmersive(false);
    };
    for (const event of FULLSCREEN_EVENTS) document.addEventListener(event, onChange);
    return () => {
      for (const event of FULLSCREEN_EVENTS) document.removeEventListener(event, onChange);
    };
  }, []);

  const exit = useCallback(() => {
    setNative(false);
    setImmersive(false);
    void leaveFullscreen(document);
  }, []);

  const enter = useCallback(() => {
    const element = ref.current;
    // The overlay goes up either way, so a refused request still fills the
    // app with the game instead of doing nothing visible.
    setImmersive(true);
    if (!canFullscreen(element)) return;
    void enterFullscreen(element).then(setNative);
  }, [ref]);

  const toggle = useCallback(() => {
    if (immersive) exit();
    else enter();
  }, [immersive, enter, exit]);

  // Leaving the view (a link out, or the game being removed) must not strand
  // the browser in fullscreen on whatever renders next.
  useEffect(() => () => void leaveFullscreen(document), []);

  return { immersive, native, toggle, exit };
}
