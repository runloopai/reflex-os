/**
 * The full-screen story of one game: the opening brief, every prompt the
 * owner sent, every suggestion the room made, and where the agent shipped.
 *
 * Built from the agent's own event stream — read through the per-game
 * proxy, so a viewer of a public game gets it without ever handling the
 * owner's key — joined with the arcade's suggestion rows. The merge rules
 * live in `buildGameTimeline`, the look in `TimelineEntryList`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { GradientText } from 'performative-ui';
import { arcade, getToken, type Game, type Suggestion } from '../lib/api.ts';
import { buildGameTimeline, type TimelineEvent } from '../lib/game-timeline.ts';
import { TimelineEntryList } from '../components/TimelineEntryList.tsx';
import { StatusPill } from '../components/StatusPill.tsx';

export function GameTimeline() {
  const { gameId } = useParams<{ gameId: string }>();
  const [game, setGame] = useState<Game | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Derived, not stored: "loading" is simply "what we hold is not the game
  // that was asked for", which is also true across a route change to
  // another game — no effect has to reset it.
  const loading = !game || game.id !== gameId;

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    void (async () => {
      try {
        const [{ game: loaded }, { suggestions: rows }] = await Promise.all([
          arcade.getGame(gameId),
          arcade.listSuggestions(gameId),
        ]);
        if (cancelled) return;
        setGame(loaded);
        setSuggestions(rows);
        // The agent's history, through the per-game proxy: the arcade swaps
        // in the owner's credentials so a viewer never handles them. A
        // sleeping devbox or an unreachable stream is not fatal — the
        // arcade's own rows still tell most of the story.
        const res = await fetch(`/reflex/${gameId}/api/agents/${loaded.agentId}/stream`, {
          headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        });
        if (!cancelled && res.ok) setEvents((await res.json()) as TimelineEvent[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the game.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const entries = useMemo(
    () =>
      game
        ? buildGameTimeline({
            events,
            suggestions,
            gamePrompt: game.prompt,
            gameCreatedAt: game.createdAt,
            ownerName: game.ownerName,
            ownerId: game.ownerId,
          })
        : [],
    [events, suggestions, game],
  );

  if (error) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16 text-center">
        <p className="text-sm text-rose-400">{error}</p>
        <Link to="/" className="mt-4 inline-block text-sm text-violet-400 hover:text-violet-300">
          Back to the shelf
        </Link>
      </main>
    );
  }

  const counts = {
    suggestions: entries.filter((e) => e.kind === 'suggestion').length,
    prompts: entries.filter((e) => e.kind === 'owner').length,
    shipped: entries.filter((e) => e.kind === 'shipped').length,
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <Link
        to={gameId ? `/g/${gameId}` : '/'}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-violet-300"
      >
        <ArrowLeft size={14} aria-hidden /> Back to the stream
      </Link>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight">
        {game ? game.title : 'Game'} <GradientText>timeline</GradientText>
      </h1>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
        {game ? <StatusPill status={game.status} /> : null}
        <span>{counts.suggestions} suggestions</span>
        <span>{counts.prompts} owner prompts</span>
        <span>{counts.shipped} shipped</span>
      </p>

      {loading && entries.length === 0 ? (
        <p className="mt-10 text-sm text-zinc-500">Reading the agent&rsquo;s history...</p>
      ) : (
        <TimelineEntryList entries={entries} />
      )}
    </main>
  );
}
