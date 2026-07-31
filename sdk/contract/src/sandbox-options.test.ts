import { describe, it, expect } from 'vitest';
import { SandboxOptionsSchema, resolveSandboxOptions } from './sandbox-options.js';

describe('SandboxOptionsSchema', () => {
  it('accepts an empty object (no overrides)', () => {
    expect(SandboxOptionsSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a full set of options', () => {
    const result = SandboxOptionsSchema.safeParse({
      blueprintName: 'my-blueprint',
      blueprintId: 'bp_123',
      resourceSize: 'LARGE',
      dockerd: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts a snapshotId', () => {
    const result = SandboxOptionsSchema.safeParse({ snapshotId: 'snp_1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.snapshotId).toBe('snp_1');
  });

  it('rejects a non-boolean dockerd', () => {
    expect(SandboxOptionsSchema.safeParse({ dockerd: 'yes' }).success).toBe(false);
  });

  it('rejects an unknown size', () => {
    const result = SandboxOptionsSchema.safeParse({ resourceSize: 'HUGE' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const result = SandboxOptionsSchema.safeParse({ extraField: 'value' });
    expect(result.success).toBe(false);
  });
});

describe('resolveSandboxOptions', () => {
  it('returns null when nothing is set', () => {
    expect(resolveSandboxOptions({})).toBeNull();
    expect(
      resolveSandboxOptions({ sandboxOptions: {}, blueprintId: null, blueprintName: null }),
    ).toBeNull();
  });

  it('falls back to legacy blueprint fields when sandboxOptions is empty', () => {
    expect(resolveSandboxOptions({ blueprintName: 'base' })).toEqual({ blueprintName: 'base' });
    expect(resolveSandboxOptions({ blueprintId: 'bp_1' })).toEqual({ blueprintId: 'bp_1' });
  });

  it('prefers sandboxOptions fields over legacy fields', () => {
    const result = resolveSandboxOptions({
      sandboxOptions: { blueprintName: 'new-bp' },
      blueprintName: 'legacy-bp',
    });
    expect(result).toEqual({ blueprintName: 'new-bp' });
  });

  it('carries resourceSize through', () => {
    const result = resolveSandboxOptions({
      sandboxOptions: { resourceSize: 'MEDIUM' },
      blueprintName: 'base',
    });
    expect(result).toEqual({ blueprintName: 'base', resourceSize: 'MEDIUM' });
  });

  it('drops null fields from the result', () => {
    const result = resolveSandboxOptions({
      sandboxOptions: { blueprintName: null, resourceSize: 'SMALL' },
    });
    expect(result).toEqual({ resourceSize: 'SMALL' });
  });

  it('carries snapshotId through', () => {
    expect(resolveSandboxOptions({ sandboxOptions: { snapshotId: 'snp_1' } })).toEqual({
      snapshotId: 'snp_1',
    });
    expect(
      resolveSandboxOptions({ sandboxOptions: { snapshotId: 'snp_1', resourceSize: 'SMALL' } }),
    ).toEqual({ snapshotId: 'snp_1', resourceSize: 'SMALL' });
  });

  it('drops a null snapshotId from the result', () => {
    expect(resolveSandboxOptions({ sandboxOptions: { snapshotId: null } })).toBeNull();
  });

  it('carries dockerd through and normalises it to true', () => {
    expect(resolveSandboxOptions({ sandboxOptions: { dockerd: true } })).toEqual({ dockerd: true });
  });

  it('carries computerUse through and normalises it to true', () => {
    expect(resolveSandboxOptions({ sandboxOptions: { computerUse: true } })).toEqual({
      computerUse: true,
    });
  });

  it('omits computerUse when false', () => {
    expect(resolveSandboxOptions({ sandboxOptions: { computerUse: false } })).toBeNull();
    expect(
      resolveSandboxOptions({ sandboxOptions: { computerUse: false, resourceSize: 'SMALL' } }),
    ).toEqual({ resourceSize: 'SMALL' });
  });

  it('carries artifactMirrors through, preserving an explicit false', () => {
    // Mirrors are on by default, so the explicit opt-out is the value that
    // must survive (like resumeOnHttp's explicit false).
    expect(resolveSandboxOptions({ sandboxOptions: { artifactMirrors: true } })).toEqual({
      artifactMirrors: true,
    });
    expect(resolveSandboxOptions({ sandboxOptions: { artifactMirrors: false } })).toEqual({
      artifactMirrors: false,
    });
  });

  it('carries customSize through', () => {
    const customSize = { name: 'builder-xl', cpuCores: 8, gbMemory: 64 };
    expect(resolveSandboxOptions({ sandboxOptions: { customSize } })).toEqual({ customSize });
  });

  it('omits dockerd when false', () => {
    expect(resolveSandboxOptions({ sandboxOptions: { dockerd: false } })).toBeNull();
    expect(
      resolveSandboxOptions({ sandboxOptions: { dockerd: false, resourceSize: 'SMALL' } }),
    ).toEqual({ resourceSize: 'SMALL' });
  });

  it('carries resumeOnHttp through, preserving an explicit false', () => {
    // Unlike dockerd, `false` is meaningful (opt out of http wake), so it
    // must survive; only unset collapses to the default.
    expect(resolveSandboxOptions({ sandboxOptions: { resumeOnHttp: true } })).toEqual({
      resumeOnHttp: true,
    });
    expect(resolveSandboxOptions({ sandboxOptions: { resumeOnHttp: false } })).toEqual({
      resumeOnHttp: false,
    });
    expect(resolveSandboxOptions({ sandboxOptions: { resumeOnHttp: null } })).toBeNull();
  });
});
