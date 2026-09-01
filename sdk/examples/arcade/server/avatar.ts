/**
 * A player's avatar as a real image URL.
 *
 * Profile avatars are stored as small data URLs (see `PATCH /api/me`), which
 * is fine inside this app but useless to a game: the game runs on the
 * agent's devbox, behind a tunnel, and gets its player from query
 * parameters — a 64KB data URL cannot travel in one. So the arcade serves
 * the avatar as an ordinary image instead, and passes the game a URL.
 *
 * A player who never uploaded one still gets an image: the same initial-on-a-
 * color chip the web app draws (`web/src/components/Avatar.tsx`), rendered as
 * SVG here so a game never has to special-case "no picture".
 */
import { decodeDataUrl } from './og-image.ts';

/** Hex twins of the Tailwind `*-600` palette the web avatar chip uses. */
const COLORS = [
  '#7c3aed', // violet
  '#059669', // emerald
  '#0284c7', // sky
  '#e11d48', // rose
  '#d97706', // amber
  '#0d9488', // teal
  '#c026d3', // fuchsia
  '#4f46e5', // indigo
];

/**
 * Which palette entry an id gets. Mirrors `colorFor` in the web avatar, so
 * a player is the same color in the arcade and inside the game.
 */
export function avatarColorIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % COLORS.length;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The initial to draw: first character of the name, or `?`. */
function initial(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

export interface AvatarImage {
  contentType: string;
  body: Buffer | string;
  /** Whether this is the drawn fallback rather than the player's own picture. */
  generated: boolean;
}

/**
 * The image to serve for a player. Their uploaded picture when it decodes,
 * otherwise the drawn chip — never a 404, because the game embedding it has
 * no fallback of its own.
 */
export function avatarImage(user: { id: string; name: string; avatar: string }): AvatarImage {
  const decoded = user.avatar ? decodeDataUrl(user.avatar) : null;
  if (decoded) return { contentType: decoded.mediaType, body: decoded.bytes, generated: false };
  const size = 128;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${escapeXml(user.name)}">`,
    `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${COLORS[avatarColorIndex(user.id)]}"/>`,
    `<text x="50%" y="50%" dy="0.35em" text-anchor="middle" fill="#ffffff"`,
    ` font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="${size * 0.45}"`,
    ` font-weight="700">${escapeXml(initial(user.name))}</text>`,
    '</svg>',
  ].join('');
  return { contentType: 'image/svg+xml', body: svg, generated: true };
}
