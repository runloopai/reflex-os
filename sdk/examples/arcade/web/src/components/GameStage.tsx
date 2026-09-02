/**
 * The game itself: the agent's dev server in an iframe, or whatever the
 * stream view wants shown while there is nothing to play yet.
 *
 * Focus is why this is a component. These are keyboard games — arrows,
 * WASD, space — and an iframe receives no key events until it holds focus.
 * Opening a stream used to land you on a game that ignored every key until
 * you happened to click it first, with nothing on screen saying so. The
 * stage now claims the keyboard as soon as there is something to play.
 *
 * Two rules keep that from becoming theft:
 *
 *  - Once per game URL, never per render. The stream view re-renders on
 *    every socket frame (viewer counts, chat, agent status); re-focusing on
 *    each one would swallow every other keystroke typed anywhere on the
 *    page.
 *  - Only while the keyboard is unclaimed. A game's daemon URL usually
 *    arrives minutes after you opened the page — often while you are
 *    mid-sentence in chat or in the suggestion box. That is precisely the
 *    moment it must not grab focus, so it doesn't.
 *
 * Clicking the game is handled by the browser: a click anywhere in an
 * iframe focuses it. The `focus()` handle is for the one case the browser
 * cannot see — closing the phone's room sheet, where the button that had
 * focus unmounts and the keyboard would otherwise drop back to nothing.
 */
import { useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { ReactNode, Ref } from 'react';

export interface GameStageHandle {
  /** Hand the keyboard to the game. Ignored while there is no game. */
  focus(): void;
}

export interface GameStageProps {
  /** The agent's dev-server URL, or null while the game is still building. */
  src: string | null;
  /** The game's name — the iframe's accessible name. */
  title: string;
  /** Shown in place of the game when there is no `src` yet. */
  fallback: ReactNode;
  ref?: Ref<GameStageHandle>;
}

/**
 * Whether anything has deliberately taken the keyboard. `body` is where
 * focus sits when nobody has asked for it; anything else is a person
 * typing, and a person outranks the game.
 */
function keyboardIsUnclaimed(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || active === document.documentElement;
}

export function GameStage({ src, title, fallback, ref }: GameStageProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  /** The `src` whose auto-focus has already been spent. */
  const claimed = useRef<string | null>(null);

  const focus = useCallback(() => {
    // `preventScroll`, because the stage sits inside a viewport-locked
    // column: the default scroll-into-view has nowhere to go and on iOS
    // shifts the whole page under the notch to get there.
    frame.current?.focus({ preventScroll: true });
  }, []);

  useImperativeHandle(ref, () => ({ focus }), [focus]);

  useEffect(() => {
    if (!src || claimed.current === src || !keyboardIsUnclaimed()) return;
    claimed.current = src;
    focus();
  }, [src, focus]);

  return (
    <div className="touch-stage min-h-0 flex-1 bg-black/70">
      {src ? (
        <iframe
          ref={frame}
          src={src}
          title={title}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
        />
      ) : (
        fallback
      )}
    </div>
  );
}
