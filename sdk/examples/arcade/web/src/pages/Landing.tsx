/**
 * Games: every public game on the arcade, live-updating, sortable by
 * recency or play count. The hero is a cursor-reactive ASCII field with
 * live arcade stats; the page signs off with the wall-sized wordmark.
 */
import { Link, Link as RouterLink } from 'react-router-dom';
import {
  AsciiHero,
  Button,
  EyebrowPill,
  GradientText,
  StatCounter,
  StatusDot,
  WordRoll,
} from 'performative-ui';
import { useUrlState } from '../lib/useUrlState.ts';
import { sortGames, useGames, type GameSort, GAME_SORTS } from '../lib/useGames.ts';
import { GameCard } from '../components/GameCard.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import { arcadeShareText } from '../lib/share.ts';

function HeroStat({ target, label, live }: { target: number; label: string; live?: boolean }) {
  return (
    <div className="flex flex-col">
      <StatCounter
        key={target}
        target={target}
        durationMs={1200}
        className="text-3xl font-bold text-zinc-100 tabular-nums"
      />
      <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-widest text-zinc-500 uppercase">
        {live ? <StatusDot color="#34d399" /> : null}
        {label}
      </span>
    </div>
  );
}

export function Landing() {
  const games = useGames();
  // Sorting is where you are, not a preference: keep it in the URL so a
  // refresh or a shared link opens the same shelf order.
  const [sort, setSort] = useUrlState<GameSort>('sort', GAME_SORTS, 'newest');

  const publicGames = sortGames(
    (games ?? []).filter((g) => g.isPublic),
    sort,
  );
  const liveCount = publicGames.filter((g) => g.status === 'live').length;
  const watching = publicGames.reduce((sum, g) => sum + g.viewers, 0);
  const plays = (games ?? []).reduce((sum, g) => sum + g.plays, 0);

  return (
    <div className="flex flex-1 flex-col">
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/70 [background-image:radial-gradient(120%_140%_at_85%_-20%,rgba(124,58,237,0.25),transparent_55%),radial-gradient(110%_130%_at_0%_120%,rgba(14,165,233,0.16),transparent_55%)] p-8 shadow-2xl shadow-violet-950/40 sm:p-12">
          {/* Cursor-reactive ASCII field filling the hero; move the mouse over it. */}
          {/* Inline position: pui's unlayered `.pui-ascii { position: relative }`
              beats Tailwind v4's layered `absolute inset-0`. */}
          <AsciiHero
            aria-hidden
            variant="bare"
            colorful
            reactive
            baseOpacity={0.14}
            spotlightOpacity={0.9}
            spotlightRadius={10}
            style={{ position: 'absolute', inset: 0 }}
          />
          {/* Scrim keeps the copy column readable over the ASCII field. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 via-zinc-950/35 to-transparent"
          />
          {/* pointer-events-none lets the cursor reach the ASCII field through
              the copy; interactive children opt back in. */}
          <div className="pointer-events-none relative">
            <EyebrowPill statusColor="#34d399">Agents are live now</EyebrowPill>
            <h1 className="mt-5 max-w-3xl text-4xl leading-[1.1] font-extrabold tracking-tight sm:text-5xl">
              Games built <GradientText>live by agents</GradientText>,
              <br />
              steered by{' '}
              <WordRoll
                gradient
                words={['everyone watching', 'the chat', 'your hearts', 'total strangers']}
              />
            </h1>
            <p className="mt-4 max-w-xl text-zinc-400">
              Every game here is being written by a Reflex agent while you watch. Open one to see
              the agent think, play the latest build, chat with the room, and heart the next thing
              it should build.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-10 gap-y-6">
              <Button
                as={Link}
                to="/games/new"
                variant="glow"
                size="lg"
                sparkle
                className="pointer-events-auto"
              >
                Create a game
              </Button>
              <div className="flex gap-10">
                <HeroStat target={liveCount} label="live now" live />
                <HeroStat target={watching} label="watching" />
                <HeroStat target={plays} label="plays" />
              </div>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-widest text-zinc-400 uppercase">
              <StatusDot color="#34d399" /> Live now
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs font-medium text-zinc-500 tabular-nums">
                {publicGames.length}
              </span>
            </h2>
            {/* The shelf is as shareable as any single game: whoever liked
                one game is the best person to post the rest. It sits here
                rather than in the hero, which clips its popover. */}
            <ShareButton
              url={`${location.origin}/`}
              title="Reflex Arcade"
              text={arcadeShareText()}
              label="Share the arcade"
              cta="Share"
              hint="The link unfurls into the arcade's card wherever you paste it."
              className="ml-auto"
            />
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              Sort
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as GameSort)}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-violet-500"
              >
                <option value="newest">Newest</option>
                <option value="plays-desc">Most played</option>
                <option value="plays-asc">Least played</option>
              </select>
            </label>
          </div>
          {games === null ? (
            <p className="text-sm text-zinc-500">Loading games...</p>
          ) : publicGames.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No public games yet. Create one and make it public to put it here.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {publicGames.map((game) => (
                <GameCard key={game.id} game={game} />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="mt-16 border-t border-white/5 bg-zinc-950/60">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-8">
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight">
              Reflex <GradientText>Arcade</GradientText>
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Built live by agents — watch, suggest, heart.
            </p>
          </div>
          <nav className="ml-auto flex items-center gap-5 text-xs text-zinc-500">
            <RouterLink to="/about" className="hover:text-zinc-200">
              About
            </RouterLink>
            <a
              href="https://reflex.runloop.ai"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-200"
            >
              Reflex
            </a>
            <a
              href="https://runloop.ai"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-200"
            >
              Runloop
            </a>
            <a
              href="https://github.com/runloopai/reflex"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-200"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
