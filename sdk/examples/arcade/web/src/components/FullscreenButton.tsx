/**
 * The stage's fullscreen toggle.
 *
 * Unlike everything else in the stage header this control is never dropped at
 * narrow widths (see `stageDensity`): a cramped stage is exactly when a player
 * wants the screen, so hiding the fix along with the rest of the chrome would
 * be backwards.
 *
 * Purely presentational — the view owns the mode — so it is storyable alone.
 */
import { Maximize2, Minimize2 } from 'lucide-react';

export function FullscreenButton({
  active,
  onToggle,
  className,
}: {
  /** Whether the stage currently owns the screen. */
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const label = active ? 'Exit fullscreen' : 'Play fullscreen';
  const Icon = active ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={active}
      // Thumb-sized on touch, except on a landscape phone: this control is
      // most used exactly there, and a 40px button in a 390px-tall screen
      // spends the height fullscreen was pressed to win back. `short:` wins
      // over `pointer-coarse:` because it is registered after it.
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-zinc-400 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-500/70 pointer-coarse:h-10 pointer-coarse:w-10 short:h-7 short:w-7 ${
        active
          ? 'border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25'
          : 'border-white/10 hover:bg-white/5 hover:text-zinc-100'
      } ${className ?? ''}`}
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}
