/**
 * What a shelf shows when it has no tiles yet: skeletons while the fetch is
 * in flight, an invitation when the answer is genuinely nothing.
 *
 * Three pages render shelves — the arcade, my games, a profile — and each
 * had grown its own answer, from a bare "Loading games..." to a dashed
 * call-to-action card. Skeletons in the tiles' own shape also keep the page
 * from jumping when the real ones land.
 */
import type { ReactNode } from 'react';

/** Tile-shaped placeholders, matching `GameCard`'s 16:9 art and body. */
export function GameCardSkeletons({ count = 3 }: { count?: number }) {
  return (
    <>
      {/* Outside the `aria-hidden` grid, or the only thing a screen reader
          gets during the fetch is silence — the shapes carry no meaning, the
          announcement does. */}
      <p role="status" className="sr-only">
        Loading games…
      </p>
      <div aria-hidden className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="animate-pulse overflow-hidden rounded-2xl border border-white/5 bg-zinc-900/40"
          >
            <div className="aspect-video bg-white/[0.04]" />
            <div className="space-y-2.5 p-4">
              <div className="h-4 w-2/5 rounded bg-white/[0.07]" />
              <div className="h-3 w-4/5 rounded bg-white/[0.05]" />
              <div className="h-3 w-1/3 rounded bg-white/[0.04]" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** The "nothing here" card, with room for a call to action. */
export function EmptyShelf({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/15 bg-zinc-900/30 px-8 py-16 text-center">
      {icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 text-violet-300">
          {icon}
        </span>
      ) : null}
      <p className="font-semibold">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-zinc-500">{body}</p>
      {action}
    </div>
  );
}
