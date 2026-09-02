/**
 * The app's bottom edge: wordmark, one line of what this is, and the links
 * off the arcade.
 *
 * App-level rather than per-page. It started on the shelf only, which left
 * every other page — my games, a profile, settings — ending in whatever
 * height the content happened to have, with the aurora running out below it
 * and nothing to say the page was over. The stream view opts out: it is a
 * theater sized to the viewport and has no bottom to reach.
 */
import { Link } from 'react-router-dom';
import { GradientText } from 'performative-ui';
import { EXTERNAL_LINKS } from '../lib/external-links.ts';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-white/5 bg-zinc-950/60">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-8 safe-x">
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight">
            Reflex <GradientText>Arcade</GradientText>
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Built live by agents — watch, suggest, heart.
          </p>
        </div>
        <nav className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500">
          <Link to="/about" className="transition hover:text-zinc-200">
            About
          </Link>
          {EXTERNAL_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-zinc-200"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
