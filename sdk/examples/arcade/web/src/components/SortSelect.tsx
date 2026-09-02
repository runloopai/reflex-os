/**
 * The shelves' sort control.
 *
 * Still a real `<select>` — a phone gives it a native picker and a keyboard
 * gives it type-ahead, neither of which a div reimplements well — but with
 * the platform chrome removed, because the browser's own arrow was the one
 * unstyled control on a page of glass and gradients.
 */
import { ChevronDown } from 'lucide-react';
import { GAME_SORTS, type GameSort } from '../lib/useGames.ts';

const SORT_LABELS: Record<GameSort, string> = {
  newest: 'Newest',
  'plays-desc': 'Most played',
  'plays-asc': 'Least played',
};

export function SortSelect({
  value,
  onChange,
}: {
  value: GameSort;
  onChange: (sort: GameSort) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
      Sort
      <span className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as GameSort)}
          className="appearance-none rounded-lg border border-white/10 bg-white/5 py-1.5 pr-8 pl-2.5 text-xs text-zinc-300 transition outline-none hover:border-white/20 focus:border-violet-500 pointer-coarse:min-h-10 pointer-coarse:text-sm"
        >
          {GAME_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </option>
          ))}
        </select>
        <ChevronDown
          size={13}
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-500"
        />
      </span>
    </label>
  );
}
