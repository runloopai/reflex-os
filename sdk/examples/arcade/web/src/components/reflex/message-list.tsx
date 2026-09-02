/**
 * Scrolling transcript of the agent-activity timeline.
 *
 * Composes the standalone primitives — `MessageBubble`, `ThoughtBlock`,
 * `ToolCallLine`/`ToolCallGroup`, `SystemNote` — over `buildAgentTimeline`,
 * collapsing long tool runs behind an expander. Every piece is replaceable:
 * pass `renderItem` to override how any timeline item renders (return
 * `undefined` to keep the default), or skip this component entirely and
 * compose the primitives yourself.
 *
 * Scrolling pins to the newest item only while the reader is at the bottom;
 * scrolling up unpins and shows a jump-to-latest button. Colors come from
 * `--reflex-chat-*` CSS variables. You own this file.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ReflexStreamEvent } from '@runloop/reflex-client';
import { buildAgentTimeline, groupToolRuns } from '../../lib/reflex/event-utils';
import type { AgentTimelineDisplayItem } from '../../lib/reflex/event-utils';
import { MessageBubble } from './message-bubble';
import { SystemNote } from './system-note';
import { ThoughtBlock } from './thought-block';
import { ToolCallGroup, ToolCallLine } from './tool-call-line';

export interface MessageListProps {
  events: ReflexStreamEvent[];
  /** Shown while the initial history request is in flight. */
  isLoading?: boolean;
  /**
   * Consecutive tool runs longer than this collapse behind an expander.
   * Pass `Infinity` to never collapse.
   */
  toolRunThreshold?: number;
  /**
   * Override rendering for any timeline item. Return `undefined` to fall
   * back to the default rendering for that item.
   */
  renderItem?: (item: AgentTimelineDisplayItem) => ReactNode | undefined;
}

/** Default rendering for one display item; exported for custom layouts. */
export function renderTimelineItem(item: AgentTimelineDisplayItem): ReactNode {
  switch (item.kind) {
    case 'user':
    case 'agent':
      return (
        <MessageBubble
          message={{
            id: item.id,
            role: item.kind,
            text: item.text,
            timestamp: item.timestamp,
            pending: item.kind === 'user' ? item.pending : false,
          }}
        />
      );
    case 'thought':
      return <ThoughtBlock>{item.text}</ThoughtBlock>;
    case 'tool':
      return <ToolCallLine tool={item} />;
    case 'tool-group':
      return <ToolCallGroup tools={item.tools} />;
    case 'system':
      return (
        <SystemNote tone={item.tone} kind={item.note} at={item.at}>
          {item.text}
        </SystemNote>
      );
  }
}

/** How close to the bottom (px) still counts as pinned. */
const PIN_THRESHOLD_PX = 48;

export function MessageList({
  events,
  isLoading = false,
  toolRunThreshold = 3,
  renderItem,
}: MessageListProps) {
  const timeline = useMemo(
    () => groupToolRuns(buildAgentTimeline(events), toolRunThreshold),
    [events, toolRunThreshold],
  );

  // Pin to the newest item by scrolling this container directly (never
  // `scrollIntoView`, which can also scroll ancestors) — and only while the
  // reader is already at the bottom, so scrolling up to read is never
  // yanked away.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [timeline.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX;
    pinnedRef.current = pinned;
    setShowJump(!pinned);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJump(false);
  };

  if (isLoading) {
    // A skeleton rather than a line of text: the pane is the width of the
    // sidebar, and "Loading transcript…" centred in it reads as an error.
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" aria-busy>
        <span className="sr-only">Loading transcript…</span>
        {[68, 40, 92].map((width, index) => (
          <span
            key={width}
            aria-hidden
            className="animate-pulse rounded-2xl bg-white/[0.06]"
            style={{ width: `${width}%`, height: index === 1 ? '1.75rem' : '4rem' }}
          />
        ))}
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <span
          aria-hidden
          className="flex h-9 w-9 animate-pulse items-center justify-center rounded-full bg-[var(--reflex-chat-accent,#4f46e5)]/15 text-[var(--reflex-chat-accent,#4f46e5)]"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <rect x="3" y="5" width="10" height="8" rx="2" fill="none" stroke="currentColor" />
            <path d="M8 5V2.5M5.5 2.5h5" fill="none" stroke="currentColor" />
            <circle cx="6" cy="9" r="1" />
            <circle cx="10" cy="9" r="1" />
          </svg>
        </span>
        <p className="text-sm font-medium text-[var(--reflex-chat-fg,#111827)]">
          Waiting for the agent&rsquo;s first events…
        </p>
        <p className="max-w-[28ch] text-xs text-[var(--reflex-chat-muted-fg,#6b7280)]">
          Everything it thinks, runs, and ships shows up here as it happens.
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex h-full flex-col gap-3 overflow-x-hidden overflow-y-auto p-4"
      >
        {timeline.map((item) => (
          <div key={item.id}>{renderItem?.(item) ?? renderTimelineItem(item)}</div>
        ))}
      </div>
      {showJump ? (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[var(--reflex-chat-accent,#4f46e5)] px-3 py-1.5 text-xs font-semibold text-[var(--reflex-chat-accent-fg,#ffffff)] shadow-lg shadow-black/50 transition hover:brightness-110"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 4v15m0 0l-6-6m6 6l6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
