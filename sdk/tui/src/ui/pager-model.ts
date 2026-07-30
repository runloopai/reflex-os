/** Scroll actions the tool-output pager understands. */
export type ScrollAction = 'up' | 'down' | 'page-up' | 'page-down' | 'top' | 'bottom';

/**
 * Next top line for a pager window: single steps, near-full-page jumps
 * (one overlap line for continuity), and jumps to either end, always
 * clamped so the window never scrolls past the content.
 */
export function stepScroll(
  top: number,
  total: number,
  height: number,
  action: ScrollAction,
): number {
  const maxTop = Math.max(0, total - height);
  const page = Math.max(1, height - 1);
  switch (action) {
    case 'up':
      return Math.max(0, top - 1);
    case 'down':
      return Math.min(maxTop, top + 1);
    case 'page-up':
      return Math.max(0, top - page);
    case 'page-down':
      return Math.min(maxTop, top + page);
    case 'top':
      return 0;
    case 'bottom':
      return maxTop;
  }
}
