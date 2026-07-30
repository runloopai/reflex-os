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
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--reflex-chat-muted-fg,#6b7280)]">
        Loading transcript…
      </div>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--reflex-chat-muted-fg,#6b7280)]">
        Waiting for the agent's first events…
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex h-full flex-col gap-2 overflow-x-hidden overflow-y-auto p-4"
      >
        {timeline.map((item) => (
          <div key={item.id}>{renderItem?.(item) ?? renderTimelineItem(item)}</div>
        ))}
      </div>
      {showJump ? (
        <button
          type="button"
          aria-label="Jump to latest"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full bg-zinc-900/80 text-[var(--reflex-chat-fg,#111827)] shadow-lg shadow-black/50 backdrop-blur-xl transition hover:bg-zinc-800/80"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 4v15m0 0l-6-6m6 6l6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
