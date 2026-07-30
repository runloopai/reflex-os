/**
 * The phone dock for the stream view: the three room screens — chat, the
 * agent transcript, suggestions — as one thumb-height row under the game.
 *
 * On a phone the game gets the whole screen and the room lives behind this
 * dock: tapping a panel opens it over the game, tapping the open one closes
 * it, so play is always one tap away. Badges carry what arrived while a
 * panel was closed, which is the only signal a hidden room can give.
 *
 * Purely presentational — the view owns which panel is open and what is
 * unread — so the dock is storyable on its own.
 */
import { PANELS, type PanelKey } from '../lib/panels.ts';

/** Counts stay legible in a 12px badge; past nine the exact number is noise. */
function badgeText(count: number): string {
  return count > 9 ? '9+' : String(count);
}

export function PanelDock({
  active,
  unread,
  onSelect,
  className,
}: {
  /** The open panel, or null while the game has the screen to itself. */
  active: PanelKey | null;
  /** Arrivals since each panel was last open; zero or missing shows no badge. */
  unread?: Partial<Record<PanelKey, number>>;
  onSelect: (panel: PanelKey) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Room panels"
      className={`flex shrink-0 items-stretch gap-1 border-t border-white/10 bg-zinc-950/95 pt-1 safe-x pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl short:pt-0.5 ${
        className ?? ''
      }`}
    >
      {PANELS.map((panel) => {
        const Icon = panel.icon;
        const isActive = active === panel.key;
        const count = unread?.[panel.key] ?? 0;
        return (
          <button
            key={panel.key}
            type="button"
            aria-controls="game-panel"
            aria-expanded={isActive}
            onClick={() => onSelect(panel.key)}
            // Stacked icon over label, except on a landscape phone, where the
            // same target laid out in one line gives the game back ten pixels
            // of a screen that only has 342 of them.
            className={`relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-500/70 short:min-h-10 short:flex-row short:gap-1.5 ${
              isActive
                ? 'bg-white/10 text-white'
                : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
            }`}
          >
            {/* The badge rides the icon, so it lands the same whether the
                button is stacked or laid out in a line. */}
            <span className="relative flex">
              <Icon size={18} aria-hidden className="opacity-90" />
              {count > 0 && !isActive ? (
                <span
                  aria-label={`${count} new`}
                  className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-violet-500 px-1 text-[10px] leading-4 font-bold text-white tabular-nums"
                >
                  {badgeText(count)}
                </span>
              ) : null}
            </span>
            {panel.label}
          </button>
        );
      })}
    </nav>
  );
}
