import { describe, it, expect } from 'vitest';
import { coerceResourceSize, isBaseBlueprint } from './resource-size.js';

describe('isBaseBlueprint', () => {
  it('returns true when metadata.type is "base"', () => {
    expect(isBaseBlueprint({ name: 'anything', metadata: { type: 'base' } })).toBe(true);
  });

  it('returns true for the canonical singleton named "base"', () => {
    expect(isBaseBlueprint({ name: 'base', metadata: undefined })).toBe(true);
  });

  it('returns true when the name contains "_base" (legacy convention)', () => {
    expect(isBaseBlueprint({ name: 'node_base', metadata: undefined })).toBe(true);
    expect(isBaseBlueprint({ name: 'node_base_arm', metadata: undefined })).toBe(true);
  });

  it('returns false for unrelated names without the metadata tag', () => {
    expect(isBaseBlueprint({ name: 'my-blueprint', metadata: undefined })).toBe(false);
    expect(isBaseBlueprint({ name: 'database-runner', metadata: {} })).toBe(false);
    expect(isBaseBlueprint({ name: 'mybase', metadata: undefined })).toBe(false);
  });
});

describe('coerceResourceSize', () => {
  it('passes through every size in our enum', () => {
    for (const size of ['SMALL', 'MEDIUM', 'LARGE', 'X_LARGE', 'XX_LARGE'] as const) {
      expect(coerceResourceSize(size)).toBe(size);
    }
  });

  it('maps Runloop sizes outside our enum to null', () => {
    expect(coerceResourceSize('X_SMALL')).toBeNull();
    expect(coerceResourceSize('CUSTOM_SIZE')).toBeNull();
  });

  it('maps unknown, empty, null, and undefined to null', () => {
    expect(coerceResourceSize('gigantic')).toBeNull();
    expect(coerceResourceSize('')).toBeNull();
    expect(coerceResourceSize(null)).toBeNull();
    expect(coerceResourceSize(undefined)).toBeNull();
  });
});
