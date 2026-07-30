import { describe, expect, it } from 'vitest';
import { stepScroll } from '../ui/pager-model.js';

describe('stepScroll', () => {
  it('steps by one line and clamps at both ends', () => {
    expect(stepScroll(0, 100, 10, 'up')).toBe(0);
    expect(stepScroll(5, 100, 10, 'up')).toBe(4);
    expect(stepScroll(89, 100, 10, 'down')).toBe(90);
    expect(stepScroll(90, 100, 10, 'down')).toBe(90);
  });

  it('pages with one line of overlap', () => {
    expect(stepScroll(0, 100, 10, 'page-down')).toBe(9);
    expect(stepScroll(9, 100, 10, 'page-up')).toBe(0);
    expect(stepScroll(85, 100, 10, 'page-down')).toBe(90);
  });

  it('jumps to the ends', () => {
    expect(stepScroll(42, 100, 10, 'top')).toBe(0);
    expect(stepScroll(0, 100, 10, 'bottom')).toBe(90);
  });

  it('never scrolls content shorter than the window', () => {
    for (const action of ['down', 'page-down', 'bottom'] as const) {
      expect(stepScroll(0, 5, 10, action)).toBe(0);
    }
  });
});
