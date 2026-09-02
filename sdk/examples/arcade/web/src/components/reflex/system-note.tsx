/**
 * One lifecycle note (`Devbox running`, `Turn complete`, errors in red): a
 * small centered pill with an icon, a sentence-cased label, and the event
 * time.
 *
 * The kit ships these as full-width hairline dividers. The arcade restyles
 * them as pills because an arcade turn emits four of them back to back
 * (`turn complete` / `agent needs input` / `agent running` / `turn started`)
 * and four rules slicing a narrow sidebar read as the transcript's main
 * event instead of its margin notes.
 *
 * `message-list` composes this; import it directly to annotate your own
 * layouts. Colors come from `--reflex-chat-*` CSS variables. You own this
 * file.
 */
import type { SystemNoteKind } from '../../lib/reflex/event-utils';

export interface SystemNoteProps {
  children: string;
  tone?: 'info' | 'error';
  /** What the note is about; picks the icon. */
  kind?: SystemNoteKind;
  /** Event time (epoch ms); renders as a local wall-clock time. */
  at?: number;
}

/** 16-box inline icons, `currentColor`, no icon library required. */
const ICONS: Record<SystemNoteKind, React.ReactNode> = {
  devbox: (
    <>
      <rect x="2" y="3" width="12" height="4.5" rx="1.2" stroke="none" />
      <rect x="2" y="8.5" width="12" height="4.5" rx="1.2" stroke="none" />
      <circle cx="4.6" cy="5.2" r="0.9" fill="var(--reflex-chat-bg,#09090b)" stroke="none" />
      <circle cx="4.6" cy="10.7" r="0.9" fill="var(--reflex-chat-bg,#09090b)" stroke="none" />
    </>
  ),
  turn: <path d="M3 8a5 5 0 1 1 1.5 3.5M3 8V4.5M3 8h3.5" fill="none" strokeWidth="1.6" />,
  daemon: (
    <>
      <circle cx="8" cy="8" r="5.5" fill="none" strokeWidth="1.4" />
      <path
        d="M2.5 8h11M8 2.5c-3.5 3.5-3.5 7.5 0 11 3.5-3.5 3.5-7.5 0-11z"
        fill="none"
        strokeWidth="1.2"
      />
    </>
  ),
  agent: (
    <>
      <rect x="3" y="5" width="10" height="8" rx="2" fill="none" strokeWidth="1.5" />
      <path d="M8 5V2.5M5.5 2.5h5" fill="none" strokeWidth="1.5" />
      <circle cx="6" cy="9" r="1" stroke="none" />
      <circle cx="10" cy="9" r="1" stroke="none" />
    </>
  ),
  setup: (
    <path
      d="M8 5.5A2.5 2.5 0 1 0 8 10.5 2.5 2.5 0 0 0 8 5.5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"
      fill="none"
      strokeWidth="1.4"
    />
  ),
  plan: <path d="M4 3.5h8M4 8h8M4 12.5h5" fill="none" strokeWidth="1.6" strokeLinecap="round" />,
};

/** States that read as "alive" get the accent color; the rest stay muted. */
const ACTIVE = /\b(running|started|complete|registered|ready)\b/;

export function SystemNote({ children, tone = 'info', kind, at }: SystemNoteProps) {
  const iconColor =
    tone === 'error'
      ? 'text-rose-400'
      : ACTIVE.test(children)
        ? 'text-[var(--reflex-chat-accent,#34d399)]'
        : 'text-[var(--reflex-chat-muted-fg,#6b7280)]';
  return (
    <div className="flex justify-center">
      <span
        className={`flex max-w-full min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] ${
          tone === 'error'
            ? 'bg-rose-500/10 text-rose-300'
            : 'bg-white/[0.04] text-[var(--reflex-chat-muted-fg,#6b7280)]'
        }`}
      >
        {kind ? (
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className={`h-3 w-3 shrink-0 ${iconColor}`}
            fill="currentColor"
            stroke="currentColor"
          >
            {ICONS[kind]}
          </svg>
        ) : null}
        <span className="truncate first-letter:uppercase">{children}</span>
        {at ? (
          <time
            dateTime={new Date(at).toISOString()}
            className="shrink-0 tabular-nums opacity-60"
            // Spelled out rather than left to `toLocaleTimeString`'s default,
            // which varies by locale — a pill that has to hold the label too
            // cannot afford a format it did not choose.
          >
            {new Date(at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </time>
        ) : null}
      </span>
    </div>
  );
}
