import { describe, it, expect } from 'vitest';
import { BODY_LEN, createIdFactory, generateId, idSchema, idToUuid, isId, parseId } from './ids.js';

describe('generateId', () => {
  it('produces an id of shape <prefix>_<22 base62 chars>', () => {
    const id = generateId('agt');
    expect(id).toMatch(/^agt_[A-Za-z0-9]{22}$/);
  });

  it('rejects malformed prefixes', () => {
    expect(() => generateId('a')).toThrow(/invalid id prefix/);
    expect(() => generateId('AGT')).toThrow(/invalid id prefix/);
    expect(() => generateId('ag1')).toThrow(/invalid id prefix/);
    expect(() => generateId('agts')).toThrow(/invalid id prefix/);
  });

  it('yields distinct ids on repeated calls', () => {
    const a = generateId('agt');
    const b = generateId('agt');
    expect(a).not.toBe(b);
  });
});

describe('isId', () => {
  it('matches the matching prefix only', () => {
    const id = generateId('agt');
    expect(isId('agt', id)).toBe(true);
    expect(isId('usr', id)).toBe(false);
  });

  it('rejects garbage', () => {
    expect(isId('agt', '')).toBe(false);
    expect(isId('agt', 'agt-abc')).toBe(false);
    expect(isId('agt', 'agt_short')).toBe(false);
    expect(isId('agt', 'agt_!!!!!!!!!!!!!!!!!!!!!!')).toBe(false);
  });
});

describe('idSchema', () => {
  it('produces a zod string that accepts valid ids', () => {
    const schema = idSchema('agt');
    const id = generateId('agt');
    expect(schema.safeParse(id).success).toBe(true);
  });

  it('rejects ids with the wrong prefix', () => {
    const schema = idSchema('agt');
    const usr = generateId('usr');
    expect(schema.safeParse(usr).success).toBe(false);
  });
});

describe('parseId / idToUuid round trip', () => {
  it('decodes back to a canonical UUID', () => {
    const id = generateId('agt');
    const uuid = idToUuid(id);
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('round-trips through parseId', () => {
    const id = generateId('agt');
    const parsed = parseId(id);
    expect(parsed?.prefix).toBe('agt');
    expect(parsed?.body).toHaveLength(BODY_LEN);
  });

  it('parseId returns null for malformed ids', () => {
    expect(parseId('not-an-id')).toBeNull();
    expect(parseId('agt-foo')).toBeNull();
  });

  it('idToUuid throws on malformed ids', () => {
    expect(() => idToUuid('agt-foo')).toThrow(/invalid id/);
  });
});

describe('createIdFactory', () => {
  it('exposes generate/schema/isOf/prefix/prefixes', () => {
    const ids = createIdFactory({ alpha: 'aaa', beta: 'bbb' } as const);
    const a = ids.generate('alpha');
    expect(ids.isOf('alpha', a)).toBe(true);
    expect(ids.isOf('beta', a)).toBe(false);
    expect(ids.schema('alpha').safeParse(a).success).toBe(true);
    expect(ids.prefix('alpha')).toBe('aaa');
    expect(ids.prefixes).toEqual(expect.arrayContaining(['aaa', 'bbb']));
  });

  it('throws when constructed with an invalid prefix', () => {
    expect(() => createIdFactory({ broken: 'BAD' } as const)).toThrow(/invalid id prefix/);
  });

  it('de-duplicates repeated prefixes', () => {
    const ids = createIdFactory({ a: 'foo', b: 'foo' } as const);
    expect(ids.prefixes).toEqual(['foo']);
  });
});
