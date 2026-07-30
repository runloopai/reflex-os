import { randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomString(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)]!;
  return out;
}

/** Prefixed entity id, e.g. `game_x8k2...`. */
export function newId(prefix: 'usr' | 'game' | 'sug' | 'msg' | 'key'): string {
  return `${prefix}_${randomString(16)}`;
}

/**
 * Login token handed to the browser and kept in localStorage. It is the
 * only credential a player has (there is no password and no logout), so it
 * gets more entropy than entity ids.
 */
export function newToken(): string {
  return `ark_${randomString(40)}`;
}
