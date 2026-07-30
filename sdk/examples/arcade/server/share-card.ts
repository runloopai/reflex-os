/**
 * Resolving a game id to a share card, for the three callers that need one:
 * the JSON endpoint, the oEmbed endpoint, and the HTML shell. Separate from
 * `share.ts` so that module stays pure (and testable without a database).
 */
import type { ArcadeDb } from './db.ts';
import { arcadeCard, shareCardFor, type ShareCard } from './share.ts';

/**
 * The card for a game, or null when there is none to give. Private games
 * and games that never existed answer identically — no existence oracle.
 */
export async function gameShareCard(
  db: ArcadeDb,
  gameId: string | null,
  origin: string,
): Promise<ShareCard | null> {
  const game = gameId ? await db.gameById(gameId) : null;
  if (!game) return null;
  const owner = await db.userById(game.ownerId);
  const shipped = await db.shippedCounts([game.id]);
  return shareCardFor(game, owner?.name ?? 'unknown', shipped[game.id] ?? 0, origin);
}

/** The same, falling back to the arcade's own card — what HTML always needs. */
export async function cardOrArcade(
  db: ArcadeDb,
  gameId: string | null,
  origin: string,
): Promise<ShareCard> {
  return (await gameShareCard(db, gameId, origin)) ?? arcadeCard(origin);
}
