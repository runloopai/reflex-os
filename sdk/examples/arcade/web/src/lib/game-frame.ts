/**
 * Who is playing, handed to the game.
 *
 * The arcade already knows the player — they joined with a name, and may
 * have a picture — so a game that asks them to type a name again is asking
 * for something the page above it is already showing. The game runs in an
 * iframe on the agent's devbox, a foreign origin, so the identity travels
 * the one way that survives that boundary and any framework the agent
 * picks: query parameters on the frame URL.
 *
 * This is display data, not a credential. Nothing in the arcade trusts a
 * value that came back from a game, and the system prompt
 * (`GAME_AGENT_SYSTEM_PROMPT`) tells agents the same — so keep it that way:
 * do not add a token here.
 */
import { avatarPath, type Me } from './api.ts';

/** The query keys games read. Prefixed so they cannot collide with a game's own. */
export const PLAYER_PARAMS = {
  id: 'arcade_player_id',
  name: 'arcade_player',
  avatar: 'arcade_avatar',
  role: 'arcade_role',
} as const;

/** What a game is told about the person in front of it. */
export interface FramePlayer {
  id: string;
  name: string;
  /** Absolute URL of an image; the game can render it without an account. */
  avatarUrl: string;
  role: 'owner' | 'player';
}

/** Matches the server's own cap, so a game never has to truncate. */
const MAX_NAME = 40;

/** Build the frame identity from the session, or null when signed out. */
export function framePlayer(me: Me | null, origin: string, isOwner: boolean): FramePlayer | null {
  if (!me) return null;
  return {
    id: me.id,
    name: me.name.slice(0, MAX_NAME),
    avatarUrl: new URL(avatarPath(me), origin).toString(),
    role: isOwner ? 'owner' : 'player',
  };
}

const RELATIVE_BASE = 'https://arcade.invalid';

/**
 * The daemon URL with the player appended. A signed-out visitor gets the URL
 * untouched (rather than blank parameters) so the game's guest path is the
 * same one it gets when someone opens it outside the arcade.
 *
 * Daemon URLs are absolute in production and relative under the bundled mock;
 * both keep their shape, and anything unparseable is passed through rather
 * than dropped — a game with no identity beats no game.
 */
export function gameFrameUrl(daemonUrl: string, player: FramePlayer | null): string {
  if (!player) return daemonUrl;
  let parsed: URL;
  try {
    parsed = new URL(daemonUrl, RELATIVE_BASE);
  } catch {
    return daemonUrl;
  }
  parsed.searchParams.set(PLAYER_PARAMS.id, player.id);
  parsed.searchParams.set(PLAYER_PARAMS.name, player.name);
  parsed.searchParams.set(PLAYER_PARAMS.avatar, player.avatarUrl);
  parsed.searchParams.set(PLAYER_PARAMS.role, player.role);
  // Whether the sentinel base had to supply the origin is the question that
  // decides the shape — not what the string looks like. A daemon URL can
  // never be on `arcade.invalid`, so an origin still pointing there means
  // the input was a path and must stay one.
  const wasRelative = parsed.origin === RELATIVE_BASE;
  return wasRelative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.toString();
}
