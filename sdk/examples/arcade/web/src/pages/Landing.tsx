/**
 * Games: every public game on the arcade, live-updating, sortable by
 * recency or play count (live games first under every sort). The hero is a
 * cursor-reactive ASCII field with live arcade stats.
 */
import { Link } from 'react-router-dom';
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
import { SortSelect } from '../components/SortSelect.tsx';
import { EmptyShelf, GameCardSkeletons } from '../components/ShelfStates.tsx';
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
          {/* `WordRoll` measures its longest word and does not wrap, so at
                `text-4xl` "everyone watching" ran off a 390px phone and got
                clipped by the hero's `overflow-hidden`. The phone step is
                sized to the longest word in the list — check this line
                against a phone before adding a longer one. */}
          <h1 className="mt-5 max-w-3xl text-3xl leading-[1.15] font-extrabold tracking-tight text-balance sm:text-4xl sm:leading-[1.1] lg:text-5xl">
            Games built <GradientText>live by agents</GradientText>,
            <br />
            steered by{' '}
            <WordRoll
              gradient
              words={['everyone watching', 'the chat', 'your hearts', 'total strangers']}
            />
          </h1>
          <p className="mt-4 max-w-xl text-zinc-400">
            Every game here is being written by a Reflex agent while you watch. Open one to see the
            agent think, play the latest build, chat with the room, and heart the next thing it
            should build.
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
        <div className="mb-5 flex flex-wrap items-center gap-3">
          {/* The shelf holds every public game, live or not, so it is not
                called "Live now" — it said that over two OFFLINE tiles. The
                live count is its own chip, and only when there is one. */}
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-widest text-zinc-400 uppercase">
            The shelf
            {/* Both counts wait for the fetch: "THE SHELF 0" over three
                loading skeletons is a wrong answer, not a pending one. */}
            <span
              className={`rounded-full bg-white/5 px-2 py-0.5 text-xs font-medium text-zinc-500 tabular-nums ${
                games === null ? 'invisible' : ''
              }`}
            >
              {publicGames.length}
            </span>
          </h2>
          {liveCount > 0 ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300 tabular-nums">
              <StatusDot color="#34d399" /> {liveCount} live now
            </span>
          ) : null}
          {/* The shelf is as shareable as any single game: whoever liked
                one game is the best person to post the rest. It sits here
                rather than in the hero, which clips its popover. */}
          <ShareButton
            url={`${location.origin}/`}
            title="Reflex Arcade"
            text={arcadeShareText()}
            label="Share the arcade"
            cta="Share"
            hint="Unfurls into the arcade's card when pasted."
            className="ml-auto"
          />
          <SortSelect value={sort} onChange={setSort} />
        </div>
        {games === null ? (
          <GameCardSkeletons count={3} />
        ) : publicGames.length === 0 ? (
          <EmptyShelf
            title="No public games yet"
            body="Create one and make it public to put it on the shelf — an agent starts building the moment you describe it."
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {publicGames.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
