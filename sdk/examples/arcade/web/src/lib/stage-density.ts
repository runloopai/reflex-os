/**
 * How much of the stage header fits at a given stage width.
 *
 * The stage is not the viewport: on desktop it is whatever the sidebar
 * leaves it, and a 720px sidebar dragged out on a 1024px laptop leaves it
 * under 300px. Sizing its header off viewport breakpoints put a full-width
 * control cluster in a column that narrow, which squeezed the game's own
 * title to zero — the one thing in that header that must never disappear.
 *
 * Pure, so the thresholds are testable without a browser.
 */
export interface StageDensity {
  /** The "by owner · agent · model" line. */
  meta: boolean;
  /** The live viewer count pill. */
  viewers: boolean;
  /** Link to the timeline view. */
  timeline: boolean;
  /** Link that opens the game's own dev server in a new tab. */
  openGame: boolean;
}

/**
 * Widths are the point at which each control still leaves room for a
 * readable title, measured against the real header at 320-1200px. Ordered
 * by how much a player would miss it: the game's title and the Play button
 * are never in this list, because they always stay.
 */
export function stageDensity(width: number): StageDensity {
  return {
    viewers: width >= 340,
    timeline: width >= 440,
    openGame: width >= 560,
    meta: width >= 680,
  };
}
