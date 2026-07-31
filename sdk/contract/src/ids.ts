// Prefixed, base62-encoded UUID identifiers.
//
// Every ID looks like `<3-letter-prefix>_<22 base62 chars>`, e.g.
// `agt_V1StGXR8Z5jdHi6BmyT8aQ`. The body is a UUIDv4 losslessly
// re-encoded as base62 (122 bits of entropy, ~28% shorter than the
// 36-char hex form). The `_` separator is a word character in
// browsers/editors so a single double-click selects the whole id.
//
// Plugins use the same primitives via `createIdFactory(...)` and
// register their own prefixes on `PluginDefinition.idPrefixes` so
// the host can detect conflicts at boot.

import { z } from 'zod';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const BODY_LEN = 22;
const PREFIX_RE = /^[a-z]{3}$/;
const ID_RE = /^([a-z]{3})_([A-Za-z0-9]{22})$/;

function idRe(prefix: string): RegExp {
  return new RegExp(`^${prefix}_[A-Za-z0-9]{${BODY_LEN}}$`);
}

/**
 * Regex source that finds a prefixed entity id anywhere in a run of text and
 * exposes its prefix and body as capture group 1 and 2. A leading negative
 * lookbehind and trailing lookahead keep it from firing inside a longer token
 * (e.g. `xagt_...` or a 23rd trailing base62 char). Consumed as a string by the
 * chat plugin's `text` content scanner (`contentScanners[].pattern`), which
 * badges these ids in agent output; kept here so the id shape has one home.
 */
export const ENTITY_ID_SCANNER_PATTERN = `(?<![A-Za-z0-9_])([a-z]{3})_([A-Za-z0-9]{${BODY_LEN}})(?![A-Za-z0-9])`;

function bigIntToBase62(n: bigint, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    s = ALPHABET[Number(n % 62n)] + s;
    n = n / 62n;
  }
  return s;
}

function base62ToBigInt(s: string): bigint {
  let n = 0n;
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error(`invalid base62 char: ${c}`);
    n = n * 62n + BigInt(i);
  }
  return n;
}

/** Generate a new prefixed id. The body is a fresh UUIDv4 in base62. */
export function generateId(prefix: string): string {
  if (!PREFIX_RE.test(prefix)) throw new Error(`invalid id prefix: ${prefix}`);
  const uuid = globalThis.crypto.randomUUID();
  const n = BigInt('0x' + uuid.replace(/-/g, ''));
  return `${prefix}_${bigIntToBase62(n, BODY_LEN)}`;
}

/** Check whether `v` is a well-formed id for `prefix`. */
export function isId(prefix: string, v: string): boolean {
  return idRe(prefix).test(v);
}

/** Build a Zod schema matching a single prefix. */
export function idSchema(prefix: string): z.ZodString {
  return z.string().regex(idRe(prefix), `Expected id like ${prefix}_XXXXXXXXXXXXXXXXXXXXXX`);
}

/** Split an id into its prefix + body, or return null if it isn't well-formed. */
export function parseId(v: string): { prefix: string; body: string } | null {
  const m = ID_RE.exec(v);
  return m ? { prefix: m[1], body: m[2] } : null;
}

/** Decode an id back to its canonical UUID form. Useful for debugging. */
export function idToUuid(id: string): string {
  const parsed = parseId(id);
  if (!parsed) throw new Error(`invalid id: ${id}`);
  const hex = base62ToBigInt(parsed.body).toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Bind a `{ kind: prefix }` map and get typed `generate` / `schema` / `isOf`
 * helpers plus a `prefixes` array (suitable for `PluginDefinition.idPrefixes`).
 */
export function createIdFactory<T extends Record<string, string>>(
  map: T,
): {
  generate: (kind: keyof T) => string;
  schema: (kind: keyof T) => z.ZodString;
  isOf: (kind: keyof T, v: string) => boolean;
  prefix: (kind: keyof T) => string;
  prefixes: readonly string[];
} {
  for (const v of Object.values(map)) {
    if (!PREFIX_RE.test(v)) throw new Error(`invalid id prefix: ${v}`);
  }
  const prefixes = Object.freeze(Array.from(new Set(Object.values(map))));
  return {
    generate: (kind) => generateId(map[kind]),
    schema: (kind) => idSchema(map[kind]),
    isOf: (kind, v) => isId(map[kind], v),
    prefix: (kind) => map[kind],
    prefixes,
  };
}
