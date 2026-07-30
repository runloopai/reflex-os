/**
 * Complete chat pane for one Reflex agent: header, live transcript,
 * composer. Drop it anywhere under a `ReflexProvider`.
 *
 * ```tsx
 * <ReflexProvider baseUrl="https://reflex.example.com" apiKey={key} organizationId="my-org">
 *   <ChatPane agentId="agent_123" />
 * </ReflexProvider>
 * ```
 *
 * `readOnly` swaps the composer for a view-only footer (spectator mode);
 * `status` lets a host app supply the live agent status (ACP streams carry
 * no status events, so without it the header shows the mount-time status);
 * `enableAttachments` / `enableVoice` toggle the composer extras. The pane
 * is a thin composition: `header`/`footer` slots replace those regions, and
 * `renderItem` overrides individual transcript items — or skip the pane and
 * assemble `MessageList`, `ChatComposer`, and the primitives yourself.
 *
 * Layout uses plain Tailwind utilities; colors come from `--reflex-chat-*`
 * CSS variables (see `message-bubble` for the list), so you can restyle
 * without touching markup. You own this file.
 */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAgent } from '@runloop/reflex-client';
import { useAgentStream } from '../../hooks/reflex/use-agent-stream';
import { useInterruptAgent } from '../../hooks/reflex/use-interrupt-agent';
import { useSendMessage } from '../../hooks/reflex/use-send-message';
import { latestAgentStatus } from '../../lib/reflex/event-utils';
import type { AgentTimelineDisplayItem } from '../../lib/reflex/event-utils';
import { ChatComposer } from './chat-composer';
import { MessageList } from './message-list';

export interface ChatPaneProps {
  agentId: string;
  /** Header title; defaults to the agent's name. */
  title?: string;
  /** Hide the composer and show a view-only footer (for spectators). */
  readOnly?: boolean;
  /**
   * Live agent status supplied by the host. Falls back to what the stream
   * and the agent record report.
   */
  status?: string | null;
  /** Composer options: attachment picker and voice dictation. */
  enableAttachments?: boolean;
  enableVoice?: boolean;
  /** Replace the default header entirely. */
  header?: ReactNode;
  /** Replace the composer / view-only footer entirely. */
  footer?: ReactNode;
  /** Override rendering for individual transcript items (see MessageList). */
  renderItem?: (item: AgentTimelineDisplayItem) => ReactNode | undefined;
  /** Consecutive tool runs longer than this collapse behind an expander. */
  toolRunThreshold?: number;
}

export function ChatPane({
  agentId,
  title,
  readOnly = false,
  status,
  enableAttachments = true,
  enableVoice = true,
  header,
  footer,
  renderItem,
  toolRunThreshold,
}: ChatPaneProps) {
  // The agent record carries the streamId the socket subscription needs.
  const agentQuery = useQuery({
    queryKey: ['reflex-chat', 'agent', agentId] as const,
    queryFn: async () => {
      const { data } = await getAgent(agentId);
      return data;
    },
  });

  const streamQuery = useAgentStream(agentId, agentQuery.data?.streamId ?? null);
  const sendMessage = useSendMessage(agentId);
  const interrupt = useInterruptAgent(agentId);

  // Memoized so downstream useMemo deps stay referentially stable while
  // the stream has no data yet.
  const events = useMemo(() => streamQuery.data ?? [], [streamQuery.data]);
  const liveStatus = useMemo(
    () => status ?? latestAgentStatus(events) ?? agentQuery.data?.status ?? null,
    [status, events, agentQuery.data?.status],
  );
  // The stop button only makes sense while a turn is in flight.
  const canInterrupt = liveStatus === 'running';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {header !== undefined ? (
        header
      ) : (
        <header className="flex items-center gap-2 border-b border-[var(--reflex-chat-border,#e5e7eb)] px-4 py-3">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              liveStatus === 'running'
                ? 'animate-pulse bg-emerald-400'
                : 'bg-[var(--reflex-chat-accent,#4f46e5)]'
            }`}
            aria-hidden
          />
          <h2 className="truncate text-sm font-semibold text-[var(--reflex-chat-fg,#111827)]">
            {title ?? agentQuery.data?.name ?? 'Agent'}
          </h2>
          {liveStatus ? (
            <span className="ml-auto shrink-0 text-xs text-[var(--reflex-chat-muted-fg,#6b7280)]">
              {liveStatus}
            </span>
          ) : null}
        </header>
      )}

      <MessageList
        events={events}
        isLoading={streamQuery.isLoading || agentQuery.isLoading}
        renderItem={renderItem}
        toolRunThreshold={toolRunThreshold}
      />

      {footer !== undefined ? (
        footer
      ) : readOnly ? (
        <div className="mx-auto mb-2 w-fit rounded-full bg-zinc-900/70 px-3.5 py-1.5 text-center text-xs text-[var(--reflex-chat-muted-fg,#6b7280)] shadow-lg shadow-black/40 backdrop-blur-xl">
          View only — this agent is driven by its owner.
        </div>
      ) : (
        <ChatComposer
          onSend={(message, attachments) => sendMessage.mutate({ message, attachments })}
          sending={sendMessage.isPending}
          enableAttachments={enableAttachments}
          enableVoice={enableVoice}
          onInterrupt={canInterrupt ? () => interrupt.mutate() : undefined}
          interrupting={interrupt.isPending}
        />
      )}
    </div>
  );
}
