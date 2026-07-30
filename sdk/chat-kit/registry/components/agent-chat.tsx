/**
 * The drop-in: one component that renders a complete Reflex agent chat —
 * provider, live stream, activity transcript, composer — from just a
 * server origin, an API key, and an agent id:
 *
 * ```tsx
 * <div className="h-[600px] w-[420px]">
 *   <ReflexAgentChat
 *     baseUrl="https://reflex.runloop.ai"
 *     apiKey={key}
 *     organizationId="my-org"
 *     agentId="agent_123"
 *   />
 * </div>
 * ```
 *
 * It fills its container's height. Prefer composing `ReflexProvider` +
 * `ChatPane` yourself when you mount several panes or already own a
 * QueryClient. You own this file.
 */
import { ReflexProvider } from '../lib/reflex-provider';
import type { ReflexProviderProps } from '../lib/reflex-provider';
import { ChatPane } from './chat-pane';
import type { ChatPaneProps } from './chat-pane';

export type ReflexAgentChatProps = Omit<ReflexProviderProps, 'children'> & ChatPaneProps;

export function ReflexAgentChat({
  baseUrl,
  apiKey,
  organizationId,
  queryClient,
  ...paneProps
}: ReflexAgentChatProps) {
  return (
    <ReflexProvider
      baseUrl={baseUrl}
      apiKey={apiKey}
      organizationId={organizationId}
      queryClient={queryClient}
    >
      <ChatPane {...paneProps} />
    </ReflexProvider>
  );
}
