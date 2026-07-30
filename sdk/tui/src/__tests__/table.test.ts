import { describe, expect, it } from 'vitest';
import { formatRelativeTime, renderKv, renderTable } from '../output/table.js';

// Not a TTY in tests, so output is plain (no ANSI escapes to strip).
describe('renderTable', () => {
  it('aligns columns to the widest cell', () => {
    const out = renderTable(
      [
        { key: 'id', header: 'id' },
        { key: 'name', header: 'name' },
      ],
      [
        { id: 'agt_1', name: 'fix flaky test' },
        { id: 'agt_23456', name: 'ship' },
      ],
    );
    expect(out.split('\n')).toEqual([
      'ID         NAME',
      'agt_1      fix flaky test',
      'agt_23456  ship',
    ]);
  });
});

describe('renderKv', () => {
  it('skips empty values and aligns keys', () => {
    const out = renderKv([
      ['id', 'agt_1'],
      ['model', undefined],
      ['status', 'running'],
    ]);
    expect(out.split('\n')).toEqual(['id:     agt_1', 'status: running']);
  });
});

describe('formatRelativeTime', () => {
  it('scales units with age', () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe('30s ago');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRelativeTime(now - 72 * 3_600_000, now)).toBe('3d ago');
  });
});
