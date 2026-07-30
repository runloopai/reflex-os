/**
 * @runloop/reflex-ui — importable Reflex chat components for React.
 *
 * Compiled from the same templates `@runloop/reflex-chat-kit` copies into
 * consumer apps (see `sdk/chat-kit/registry/`, synced by
 * `scripts/sync-registry.mjs`). Import from here or from the subpaths
 * (`@runloop/reflex-ui/components/chat-pane`, ...) to pull in one piece.
 */
export { ReflexProvider, useReflex } from './lib/reflex-provider';
export type { ReflexProviderProps } from './lib/reflex-provider';
export {
  buildAgentTimeline,
  buildChatMessages,
  deduplicateEvents,
  groupToolRuns,
  latestAgentStatus,
  parseEventPayload,
} from './lib/event-utils';
export type { AgentTimelineDisplayItem, AgentTimelineItem, ChatMessage } from './lib/event-utils';
export { agentStreamKey, useAgentStream } from './hooks/use-agent-stream';
export { useInterruptAgent } from './hooks/use-interrupt-agent';
export { useSendMessage } from './hooks/use-send-message';
export type { ChatAttachment, OutgoingMessage } from './hooks/use-send-message';
export { ReflexAgentChat } from './components/agent-chat';
export type { ReflexAgentChatProps } from './components/agent-chat';
export { ChatPane } from './components/chat-pane';
export type { ChatPaneProps } from './components/chat-pane';
export { MessageList, renderTimelineItem } from './components/message-list';
export type { MessageListProps } from './components/message-list';
export { MessageBubble } from './components/message-bubble';
export type { MessageBubbleProps } from './components/message-bubble';
export { ChatComposer } from './components/chat-composer';
export type { ComposerAttachment } from './components/chat-composer';
export { MarkdownContent, markdownComponents } from './components/markdown-content';
export type { MarkdownContentProps } from './components/markdown-content';
export { ToolCallGroup, ToolCallLine } from './components/tool-call-line';
export type {
  ToolCallGroupProps,
  ToolCallLineProps,
  ToolTimelineItem,
} from './components/tool-call-line';
export { ThoughtBlock } from './components/thought-block';
export type { ThoughtBlockProps } from './components/thought-block';
export { SystemNote } from './components/system-note';
export type { SystemNoteProps } from './components/system-note';
export type { ChatComposerProps } from './components/chat-composer';
