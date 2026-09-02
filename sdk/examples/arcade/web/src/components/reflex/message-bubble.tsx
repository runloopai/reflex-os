/**
 * One chat message. Agent messages render as full-width markdown blocks
 * (via `MarkdownContent`) — headings, lists, inline-code chips, fenced
 * code — matching the Reflex transcript; user messages stay compact accent
 * bubbles.
 *
 * Colors come from `--reflex-chat-*` CSS variables (with sensible
 * fallbacks), so you can restyle by setting variables on any ancestor
 * instead of editing markup:
 *
 * ```css
 * .my-chat {
 *   --reflex-chat-user-bubble: #0f766e;
 *   --reflex-chat-user-fg: #ffffff;
 *   --reflex-chat-agent-bubble: #f4f4f5;
 *   --reflex-chat-agent-fg: #18181b;
 *   --reflex-chat-muted-fg: #71717a;
 * }
 * ```
 *
 * You own this file; change the markup freely.
 */
import type { ChatMessage } from '../../lib/reflex/event-utils';
import { MarkdownContent } from './markdown-content';

export interface MessageBubbleProps {
  message: ChatMessage;
}

function stamp(message: ChatMessage): string {
  return message.pending
    ? 'Sending…'
    : new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({ message }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="flex w-full justify-end">
        <div
          className={`max-w-[82%] min-w-0 rounded-3xl rounded-br-lg bg-gradient-to-b from-violet-700 to-violet-900 px-4 py-2.5 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-[var(--reflex-chat-user-fg,#ffffff)] shadow-lg shadow-violet-950/50 ${
            message.pending ? 'opacity-60' : ''
          }`}
        >
          <p>{message.text}</p>
          <p className="mt-1 text-right text-[10px] text-[var(--reflex-chat-user-fg,#ffffff)]/60">
            {stamp(message)}
          </p>
        </div>
      </div>
    );
  }

  // Agent messages lead with a speaker line rather than trailing a bare
  // timestamp: in a transcript that is mostly tool lines and lifecycle
  // pills, "who is talking" is the thing worth labelling, and a dangling
  // time under every block was the transcript's loudest repeated element.
  return (
    <div className="w-full min-w-0 rounded-2xl rounded-bl-md bg-[var(--reflex-chat-agent-bubble,#f3f4f6)] px-4 py-3 text-[var(--reflex-chat-agent-fg,#111827)] shadow-md shadow-black/25 backdrop-blur-md">
      <p className="mb-1.5 flex items-baseline gap-2 text-[11px] text-[var(--reflex-chat-muted-fg,#6b7280)]">
        <span className="font-semibold tracking-wide text-[var(--reflex-chat-accent,#4f46e5)]">
          Agent
        </span>
        <span className="tabular-nums opacity-70">{stamp(message)}</span>
      </p>
      <MarkdownContent>{message.text}</MarkdownContent>
    </div>
  );
}
