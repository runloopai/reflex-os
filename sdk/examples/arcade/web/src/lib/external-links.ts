/**
 * The off-arcade destinations, in one place.
 *
 * The footer and the About page both point at Reflex, Runloop and the repo;
 * as two hand-maintained lists they were already free to drift. The label
 * is the display text, `host` the bare domain About prints under its cards.
 */
export interface ExternalLink {
  label: string;
  href: string;
  host: string;
}

export const REFLEX_LINK: ExternalLink = {
  label: 'Reflex',
  href: 'https://reflex.runloop.ai',
  host: 'reflex.runloop.ai',
};

export const RUNLOOP_LINK: ExternalLink = {
  label: 'Runloop',
  href: 'https://runloop.ai',
  host: 'runloop.ai',
};

export const REPO_LINK: ExternalLink = {
  label: 'GitHub',
  href: 'https://github.com/runloopai/reflex',
  host: 'github.com/runloopai/reflex',
};

/** What the site footer offers, in order. */
export const EXTERNAL_LINKS: ExternalLink[] = [REFLEX_LINK, RUNLOOP_LINK, REPO_LINK];
