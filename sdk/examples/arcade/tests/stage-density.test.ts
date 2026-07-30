/**
 * What the stage header shows at a given stage width.
 *
 * The rule exists because viewport breakpoints are the wrong ruler here: a
 * desktop stage shrinks as the sidebar is dragged out, so a 1024px laptop
 * can end up with a stage under 300px. Sizing by viewport put a full
 * control cluster in a column that narrow and squeezed the game's own title
 * to zero width.
 */
import { describe, expect, it } from 'vitest';
import { stageDensity } from '../web/src/lib/stage-density.ts';

describe('stageDensity', () => {
  it('keeps a narrow phone stage down to the essentials', () => {
    // 390px portrait phone: title + Play only, so the title stays readable.
    expect(stageDensity(390)).toEqual({
      viewers: true,
      timeline: false,
      openGame: false,
      meta: false,
    });
  });

  it('strips everything optional on the very narrowest stages', () => {
    expect(stageDensity(320)).toEqual({
      viewers: false,
      timeline: false,
      openGame: false,
      meta: false,
    });
  });

  it('treats a desktop stage squeezed by a dragged-out sidebar the same', () => {
    // The trap this rule was written for: a wide viewport whose stage is
    // not — 1024px laptop, sidebar dragged to its 720px maximum.
    expect(stageDensity(296).openGame).toBe(false);
    expect(stageDensity(296).meta).toBe(false);
  });

  it('shows the full header once the stage is desktop-sized', () => {
    expect(stageDensity(1010)).toEqual({
      viewers: true,
      timeline: true,
      openGame: true,
      meta: true,
    });
  });

  it('adds controls in priority order as the stage grows', () => {
    // Each control appears once, and never before a more useful one.
    const widths = [300, 340, 440, 560, 680, 1200];
    const counts = widths.map((w) => Object.values(stageDensity(w)).filter(Boolean).length);
    expect(counts).toEqual([0, 1, 2, 3, 4, 4]);
  });
});
