/**
 * Event helpers for the Reflex chat components.
 *
 * This is the source of truth for stream parsing: the Reflex web app's own
 * client re-exports the shared pieces from `@runloop/reflex-ui` (which is
 * compiled from this file), so the product and SDK consumers run the same
 * logic. You own this file; adjust the message-building rules to fit your
 * product.
 */
import type { ReflexStreamEvent } from '@runloop/reflex-client';

/** Drop events whose `id` was already seen, preserving order. */
export function deduplicateEvents<T extends { id: string }>(events: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const e of events) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      result.push(e);
    }
  }
  return result;
}

/**
 * Safely parse an event payload that may be an object, a JSON string, or a
 * malformed JSON string (the agent bridge sometimes appends an extra `}`).
 */
export function parseEventPayload<T = Record<string, unknown>>(raw: unknown): T | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      try {
        return JSON.parse(raw.replace(/\}\s*\}$/, '}')) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** One rendered chat message, built from one or more stream events. */
export interface ChatMessage {
  /** Stable id (the first contributing event's id). */
  id: string;
  role: 'user' | 'agent';
  text: string;
  /** Epoch milliseconds of the first contributing event. */
  timestamp: number;
  /** True for the optimistic entry added while a send is in flight. */
  pending: boolean;
}

/** Event types rendered as user messages. */
const USER_MESSAGE_TYPES = new Set(['message', 'user_message_chunk']);

/**
 * Native Codex user prompts. `turn/start` opens a turn and `turn/steer`
 * injects into a running one; both carry the prompt in `params.input`.
 */
const CODEX_USER_PROMPT_TYPES = new Set(['turn/start', 'turn/steer']);

/** Event types rendered as (streaming) agent text. */
const AGENT_CHUNK_TYPES = new Set([
  'agent_message_chunk',
  'turn.message_chunk',
  'assistant',
  'item/agentMessage/delta',
]);

function textFromPayload(payload: unknown): string | null {
  const parsed = parseEventPayload<Record<string, unknown>>(payload);
  if (!parsed) return typeof payload === 'string' ? payload : null;
  for (const key of ['message', 'text', 'content', 'delta']) {
    const value = parsed[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  // Native Codex frames nest their text one level down, under the JSON-RPC
  // `params`: `input` blocks on a prompt, `delta` on a streamed chunk.
  return codexPromptText(parsed) || firstString(codexParams(parsed), ['delta']);
}

/**
 * Reduce a raw event stream into displayable chat messages.
 *
 * - User events (`message`, `user_message_chunk`, native Codex `turn/start`
 *   and `turn/steer`) each become one bubble.
 * - Consecutive agent chunk events (`agent_message_chunk`,
 *   `turn.message_chunk`, `assistant`, native Codex
 *   `item/agentMessage/delta`) are concatenated into one streaming bubble;
 *   any other event type ends the current agent bubble.
 * - Events with ids starting `pending-` are the optimistic entries added by
 *   `use-send-message` and render in a pending state.
 * - Everything else (tool calls, lifecycle events, ...) is skipped. Extend
 *   here if you want to surface those in your UI.
 */
export function buildChatMessages(events: ReflexStreamEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let streaming: ChatMessage | null = null;

  for (const event of deduplicateEvents(events)) {
    if (
      USER_MESSAGE_TYPES.has(event.type) ||
      CODEX_USER_PROMPT_TYPES.has(event.type) ||
      event.origin === 'USER_EVENT'
    ) {
      const text = textFromPayload(event.payload);
      if (!text) continue;
      streaming = null;
      messages.push({
        id: event.id,
        role: 'user',
        text,
        timestamp: event.timestamp,
        pending: event.id.startsWith('pending-'),
      });
      continue;
    }

    if (AGENT_CHUNK_TYPES.has(event.type)) {
      const text = textFromPayload(event.payload);
      if (!text) continue;
      if (streaming) {
        streaming.text += text;
      } else {
        streaming = {
          id: event.id,
          role: 'agent',
          text,
          timestamp: event.timestamp,
          pending: false,
        };
        messages.push(streaming);
      }
      continue;
    }

    // Any other event type ends the current streaming agent bubble.
    streaming = null;
  }

  return messages;
}

// ── Agent-activity timeline ─────────────────────────────────────────────────
//
// The `buildChatMessages` reducer above renders only text bubbles. The
// timeline below keeps the agent's *work* visible, across every event
// dialect Reflex streams emit:
//
// - ACP agents (claude-code on current deployments): `session/prompt` for
//   user turns and `session/update` notifications whose `update.sessionUpdate`
//   discriminates message/thought chunks, tool calls, and plans.
// - Native Claude Code SDK: `assistant`/`user` events carrying a
//   `message.content` block array, plus `query` for the prompt.
// - Native Codex app-server: JSON-RPC frames whose event type IS the method
//   (`turn/start`, `item/agentMessage/delta`, `item/started`, ...) and whose
//   content sits under `params`.
// - Flat events (`message`, `agent_message_chunk`, `tool_call`, ...) used by
//   other agent brokers and the optimistic pending bubble.
//
// Lifecycle events (`turn.*`, `devbox.running`, `agent.daemon_started`,
// `agent.setup`, ...) become short system notes either way.

/** What a lifecycle note is about; SystemNote picks its icon from this. */
export type SystemNoteKind = 'devbox' | 'turn' | 'daemon' | 'agent' | 'setup' | 'plan';

export type AgentTimelineItem =
  | { kind: 'user'; id: string; text: string; timestamp: number; pending: boolean }
  | { kind: 'agent'; id: string; text: string; timestamp: number }
  | { kind: 'thought'; id: string; text: string; timestamp: number }
  | { kind: 'tool'; id: string; name: string; detail: string; done: boolean }
  | {
      kind: 'system';
      id: string;
      text: string;
      tone: 'info' | 'error';
      /** Event time (epoch ms), when the source event carried one. */
      at?: number;
      note?: SystemNoteKind;
    };

const TIMELINE_USER_TYPES = new Set(['message', 'user_message_chunk', 'user']);
const TIMELINE_AGENT_TEXT_TYPES = new Set([
  'assistant',
  'agent_message_chunk',
  'turn.message_chunk',
]);
const TIMELINE_TOOL_TYPES = new Set(['tool_call', 'turn.tool_call', 'agent.tool_use']);
const TIMELINE_TOOL_UPDATE_TYPES = new Set(['tool_call_update', 'turn.tool_call_update']);

type TimelinePayload = Record<string, unknown>;

function firstString(payload: TimelinePayload | null, keys: string[]): string | null {
  if (!payload) return null;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/** Text of one ACP content block, or a `prompt`/`content` array of blocks. */
function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).join('');
  if (value && typeof value === 'object') {
    const block = value as TimelinePayload;
    if (typeof block.text === 'string') return block.text;
  }
  return '';
}

function clamp(text: string, max = 100): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Compact one-line description of a tool invocation's input. */
function toolDetail(payload: TimelinePayload | null): string {
  const direct = firstString(payload, ['command', 'path', 'file_path', 'summary', 'description']);
  if (direct) return clamp(direct);
  const input = payload?.['rawInput'] ?? payload?.['input'] ?? payload?.['arguments'];
  if (input && typeof input === 'object') {
    const flat = Object.entries(input as TimelinePayload)
      .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(', ');
    if (flat) return clamp(flat);
  }
  if (typeof input === 'string') return clamp(input);
  return '';
}

type ToolItem = Extract<AgentTimelineItem, { kind: 'tool' }>;

interface TimelineBuilderState {
  items: AgentTimelineItem[];
  toolsById: Map<string, ToolItem>;
  streamingText: Extract<AgentTimelineItem, { kind: 'agent' | 'thought' }> | null;
  /**
   * Native Codex item ids whose text already streamed as deltas, so the
   * terminal frame — which replays the item's full text — is not rendered
   * a second time.
   */
  codexStreamedItems: Set<string>;
}

function pushText(
  state: TimelineBuilderState,
  kind: 'agent' | 'thought',
  id: string,
  text: string,
  timestamp: number,
): void {
  if (!text) return;
  if (state.streamingText?.kind === kind) {
    state.streamingText.text += text;
    return;
  }
  const item = { kind, id, text, timestamp } as Extract<
    AgentTimelineItem,
    { kind: 'agent' | 'thought' }
  >;
  state.items.push(item);
  state.streamingText = item;
}

/** Append one user bubble, ending whatever the agent was streaming. */
function pushUser(state: TimelineBuilderState, event: ReflexStreamEvent, text: string): void {
  if (!text) return;
  state.streamingText = null;
  state.items.push({
    kind: 'user',
    id: event.id,
    text,
    timestamp: event.timestamp,
    pending: event.id.startsWith('pending-'),
  });
}

function pushSystem(
  state: TimelineBuilderState,
  id: string,
  text: string,
  tone: 'info' | 'error' = 'info',
  meta: { at?: number; note?: SystemNoteKind } = {},
): void {
  state.streamingText = null;
  // Lifecycle events often repeat (daemon re-registrations, duplicate
  // status notes); collapse consecutive identical notes into one.
  const last = state.items[state.items.length - 1];
  if (last?.kind === 'system' && last.text === text && last.tone === tone) return;
  state.items.push({ kind: 'system', id, text, tone, ...meta });
}

function pushTool(
  state: TimelineBuilderState,
  id: string,
  callId: string | null,
  name: string,
  detail: string,
): ToolItem {
  state.streamingText = null;
  const item: ToolItem = { kind: 'tool', id, name, detail, done: false };
  state.items.push(item);
  if (callId) state.toolsById.set(callId, item);
  return item;
}

function applyToolUpdate(state: TimelineBuilderState, update: TimelinePayload): void {
  const callId = firstString(update, ['toolCallId', 'tool_call_id', 'id', 'callId', 'call_id']);
  const target = callId ? state.toolsById.get(callId) : undefined;
  if (!target) return;
  const status = firstString(update, ['status', 'state']);
  if (status === 'completed' || status === 'failed' || status === 'error' || status == null) {
    target.done = true;
  }
  // Later updates often carry the real input/title the call event lacked.
  const title = firstString(update, ['title', 'name']);
  if (title && (target.name === 'tool' || target.name.length < title.length)) target.name = title;
  if (!target.detail) target.detail = toolDetail(update);
  if (status === 'failed' || status === 'error') target.detail = `${target.detail} — failed`.trim();
}

/** One ACP `session/update` notification (payload.update). */
function applySessionUpdate(state: TimelineBuilderState, event: ReflexStreamEvent): void {
  const payload = parseEventPayload<TimelinePayload>(event.payload);
  const update = payload?.['update'];
  if (!update || typeof update !== 'object') return;
  const u = update as TimelinePayload;
  switch (u.sessionUpdate) {
    case 'agent_message_chunk':
      pushText(state, 'agent', event.id, contentText(u.content), event.timestamp);
      break;
    case 'agent_thought_chunk':
      pushText(state, 'thought', event.id, contentText(u.content), event.timestamp);
      break;
    case 'user_message_chunk':
      pushUser(state, event, contentText(u.content));
      break;
    case 'tool_call':
      pushTool(
        state,
        event.id,
        firstString(u, ['toolCallId', 'id']),
        firstString(u, ['title', 'name']) ?? 'tool',
        toolDetail(u),
      );
      break;
    case 'tool_call_update':
      applyToolUpdate(state, u);
      break;
    case 'plan': {
      const entries = Array.isArray(u.entries) ? u.entries : [];
      const first = contentText((entries[0] as TimelinePayload | undefined)?.['content']);
      pushSystem(
        state,
        event.id,
        entries.length
          ? `plan: ${clamp(first, 120)}${entries.length > 1 ? ` (+${entries.length - 1} steps)` : ''}`
          : 'plan updated',
        'info',
        { at: event.timestamp, note: 'plan' },
      );
      break;
    }
    default:
      // usage_update, available_commands_update, mode changes, ...
      break;
  }
}

/** Prompt text of a native Claude `query` frame. */
function claudeQueryText(payload: TimelinePayload | null): string {
  const message = asPayload(payload?.['message']);
  return contentText(message?.['content'] ?? payload?.['content']);
}

/**
 * True when the event is a native Claude Code SDK message — an `assistant`
 * or `user` event whose `message.content` is a block array (text, thinking,
 * tool_use, tool_result), rather than the flat `{ message: string }` shape.
 */
function isClaudeNativeMessage(type: string, payload: TimelinePayload | null): boolean {
  if (type !== 'assistant' && type !== 'user') return false;
  const message = payload?.['message'];
  return (
    typeof message === 'object' &&
    message !== null &&
    Array.isArray((message as TimelinePayload)['content'])
  );
}

/**
 * One native Claude Code SDK message. `assistant` blocks become agent text,
 * thoughts, and tool-call lines; `user` blocks are tool results that fold
 * into their call (marking it done/failed). The initial prompt arrives as a
 * separate `query` event, handled in the main loop.
 */
function applyClaudeNativeMessage(state: TimelineBuilderState, event: ReflexStreamEvent): void {
  const payload = parseEventPayload<TimelinePayload>(event.payload);
  const message = payload?.['message'] as TimelinePayload | undefined;
  const blocks = (message?.['content'] as unknown[]) ?? [];
  blocks.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) return;
    const block = raw as TimelinePayload;
    // Blocks share the event id; suffix by index for stable React keys.
    const id = `${event.id}:${index}`;
    switch (block['type']) {
      case 'text':
        pushText(state, 'agent', id, firstString(block, ['text']) ?? '', event.timestamp);
        break;
      case 'thinking': {
        const text = firstString(block, ['thinking', 'text']);
        if (text) pushText(state, 'thought', id, text, event.timestamp);
        break;
      }
      case 'tool_use':
        pushTool(
          state,
          id,
          firstString(block, ['id', 'toolUseId', 'tool_use_id']),
          firstString(block, ['name']) ?? 'tool',
          toolDetail(block),
        );
        break;
      case 'tool_result':
        applyToolUpdate(state, {
          toolCallId: firstString(block, ['tool_use_id', 'toolUseId', 'id']) ?? undefined,
          status: block['is_error'] ? 'failed' : 'completed',
        });
        break;
      default:
        break;
    }
  });
}

// ── native Codex app-server dialect ─────────────────────────────────────────
//
// Codex speaks raw JSON-RPC over the stream: the durable event type IS the
// method name and the content sits under `params`. Agent text and reasoning
// arrive as deltas keyed by `itemId`; work arrives as `item/started` +
// `item/completed` pairs whose `params.item` discriminates on `type`.

/** Streamed agent text. */
const CODEX_TEXT_DELTA_TYPE = 'item/agentMessage/delta';

/** Streamed reasoning; Codex's equivalent of a thought chunk. */
const CODEX_THOUGHT_DELTA_TYPES = new Set([
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
]);

/** Requests that park the turn until a human (or the broker) answers. */
const CODEX_APPROVAL_TYPES = new Map([
  ['item/commandExecution/requestApproval', 'command approval requested'],
  ['execCommandApproval', 'command approval requested'],
  ['item/fileChange/requestApproval', 'file change approval requested'],
  ['applyPatchApproval', 'file change approval requested'],
  ['item/permissions/requestApproval', 'permission approval requested'],
  ['item/tool/requestUserInput', 'input requested'],
]);

/**
 * Frames with nothing to render. Listed explicitly so they are skipped
 * rather than falling through to the default branch, which would end the
 * streaming bubble and split one agent message into several.
 */
const CODEX_IGNORED_TYPES = new Set([
  'thread/start',
  'thread/started',
  'thread/tokenUsage/updated',
  'response',
  // Command output streams into the tool line's detail only in the product
  // chat; the timeline shows the command itself.
  'item/commandExecution/outputDelta',
  'item/reasoning/summaryPartAdded',
]);

/** A nested object of a payload, or null for anything else. */
function asPayload(value: unknown): TimelinePayload | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as TimelinePayload)
    : null;
}

/**
 * The `params` of a native Codex JSON-RPC frame. Brokers that publish the
 * frame whole keep them under `params`; ones that publish only the
 * notification's body spread them across the payload itself — read either,
 * the way the Reflex chat's own Codex handler does.
 */
function codexParams(payload: TimelinePayload | null): TimelinePayload | null {
  return asPayload(payload?.['params']) ?? payload;
}

/** Prompt text of a native Codex `turn/start` / `turn/steer` frame. */
function codexPromptText(payload: TimelinePayload | null): string {
  return contentText(codexParams(payload)?.['input']);
}

/**
 * The runner republishes some brokers' frames under a `turn.<agent>.`
 * wrapper (`turn.claude.assistant`). Strip one so a wrapped Codex frame is
 * still recognised by its method.
 */
function unwrapProtocolType(type: string): string {
  const match = /^turn\.[a-z0-9-]+\.(.+)$/.exec(type);
  return match?.[1] ?? type;
}

/** Whether the event is a frame of the native Codex app-server dialect. */
function isCodexEvent(rawType: string, payload: TimelinePayload | null): boolean {
  const type = unwrapProtocolType(rawType);
  if (type.startsWith('item/') || type.startsWith('turn/') || type.startsWith('thread/')) {
    return true;
  }
  if (type === 'response' || type === 'codex.command.result') return true;
  // The pre-`item/` approval methods carry no dialect prefix.
  if (CODEX_APPROVAL_TYPES.has(type)) return true;
  // `error` exists in the Claude dialect too; native frames keep their
  // JSON-RPC method in the payload, which tells the two apart.
  return type === 'error' && payload?.['method'] === 'error';
}

/** Name + one-line detail for one Codex thread item that did work. */
function codexToolPresentation(item: TimelinePayload): { name: string; detail: string } | null {
  switch (item['type']) {
    case 'commandExecution':
      return { name: 'shell', detail: clamp(firstString(item, ['command']) ?? '') };
    case 'fileChange': {
      const changes = Array.isArray(item['changes']) ? item['changes'] : [];
      const paths = changes
        .map((change) => firstString(asPayload(change), ['path']))
        .filter((path): path is string => path !== null);
      return { name: 'edit', detail: clamp(paths.join(', ')) };
    }
    case 'mcpToolCall': {
      const tool = firstString(item, ['tool']) ?? 'tool';
      const server = firstString(item, ['server']);
      return {
        name: server ? `${server}/${tool}` : tool,
        detail: toolDetail({ input: item['arguments'] }),
      };
    }
    case 'webSearch':
      return { name: 'search', detail: clamp(firstString(item, ['query']) ?? '') };
    default:
      return null;
  }
}

/**
 * One `item/started` or `item/completed` frame. Command / file / MCP / search
 * items become tool lines that the completion marks done; message and
 * reasoning items render only when their deltas never arrived (a stream
 * replayed after the fact, or a client that opted out of delta notifications).
 */
function applyCodexItem(
  state: TimelineBuilderState,
  event: ReflexStreamEvent,
  item: TimelinePayload,
  completed: boolean,
): void {
  const itemId = firstString(item, ['id']);
  const presentation = codexToolPresentation(item);

  if (presentation) {
    const existing = itemId ? state.toolsById.get(itemId) : undefined;
    const tool =
      existing ?? pushTool(state, event.id, itemId, presentation.name, presentation.detail);
    if (existing) {
      // The terminal frame carries the item's final command / paths.
      existing.name = presentation.name;
      if (presentation.detail) existing.detail = presentation.detail;
    }
    if (!completed) return;
    tool.done = true;
    const status = firstString(item, ['status']);
    if (status === 'failed' || status === 'declined') {
      tool.detail = `${tool.detail} — ${status}`.trim();
    }
    return;
  }

  if (!completed) return;
  const streamed = itemId !== null && state.codexStreamedItems.has(itemId);
  if (item['type'] === 'agentMessage') {
    if (!streamed)
      pushText(state, 'agent', event.id, firstString(item, ['text']) ?? '', event.timestamp);
    // The item is finished either way: end the bubble so the next message
    // does not merge into it.
    state.streamingText = null;
    return;
  }
  if (item['type'] === 'reasoning') {
    if (!streamed) {
      const text = [contentText(item['summary']), contentText(item['content'])]
        .filter(Boolean)
        .join('\n');
      pushText(state, 'thought', event.id, text, event.timestamp);
    }
    state.streamingText = null;
  }
}

/** One frame of the native Codex dialect, folded into the timeline. */
function applyCodexEvent(
  state: TimelineBuilderState,
  event: ReflexStreamEvent,
  payload: TimelinePayload | null,
): void {
  const params = codexParams(payload);
  const type = unwrapProtocolType(event.type);

  if (CODEX_IGNORED_TYPES.has(type)) return;

  if (CODEX_USER_PROMPT_TYPES.has(type)) {
    pushUser(state, event, codexPromptText(payload));
    return;
  }

  if (type === CODEX_TEXT_DELTA_TYPE || CODEX_THOUGHT_DELTA_TYPES.has(type)) {
    const delta = firstString(params, ['delta']);
    if (!delta) return;
    const itemId = firstString(params, ['itemId']);
    if (itemId) state.codexStreamedItems.add(itemId);
    const kind = type === CODEX_TEXT_DELTA_TYPE ? 'agent' : 'thought';
    pushText(state, kind, event.id, delta, event.timestamp);
    return;
  }

  if (type === 'item/started' || type === 'item/completed') {
    const item = asPayload(params?.['item']);
    if (item) applyCodexItem(state, event, item, type === 'item/completed');
    return;
  }

  if (type === 'turn/started') {
    pushSystem(state, event.id, 'turn started', 'info', { at: event.timestamp, note: 'turn' });
    return;
  }

  if (type === 'turn/completed') {
    const turn = asPayload(params?.['turn']);
    const status = firstString(turn, ['status']);
    const failed = status === 'failed';
    const text = failed
      ? (firstString(turn, ['error']) ?? 'turn failed')
      : status === 'interrupted'
        ? 'turn interrupted'
        : 'turn complete';
    pushSystem(state, event.id, text, failed ? 'error' : 'info', {
      at: event.timestamp,
      note: 'turn',
    });
    return;
  }

  const approval = CODEX_APPROVAL_TYPES.get(type);
  if (approval) {
    const detail = firstString(params, ['reason', 'command']);
    pushSystem(state, event.id, detail ? `${approval}: ${clamp(detail, 120)}` : approval, 'info', {
      at: event.timestamp,
      note: 'agent',
    });
    return;
  }

  if (type === 'codex.command.result') {
    // A reflex-domain durable event, not a JSON-RPC frame: the slash command's
    // outcome is spread across the payload itself.
    const command = firstString(payload, ['command']);
    const message = firstString(payload, ['message']);
    const failed = payload?.['status'] === 'error';
    pushSystem(
      state,
      event.id,
      [command ? `/${command}` : 'command', message ? clamp(message, 160) : null]
        .filter(Boolean)
        .join(' — '),
      failed ? 'error' : 'info',
      { at: event.timestamp, note: 'agent' },
    );
    return;
  }

  if (type === 'error') {
    const message =
      firstString(asPayload(params?.['error']), ['message']) ?? firstString(params, ['message']);
    pushSystem(state, event.id, message ?? 'codex error', 'error', {
      at: event.timestamp,
      note: 'agent',
    });
    return;
  }

  // An unrecognized Codex frame (a newer method) ends the streaming bubble,
  // matching the main loop's default.
  state.streamingText = null;
}

/**
 * Reduce the raw stream into renderable items. Consecutive text chunks of
 * the same kind merge into one bubble; tool updates fold into their call's
 * line; lifecycle events become short system notes. Unknown events are
 * skipped.
 */
export function buildAgentTimeline(events: ReflexStreamEvent[]): AgentTimelineItem[] {
  const state: TimelineBuilderState = {
    items: [],
    toolsById: new Map(),
    streamingText: null,
    codexStreamedItems: new Set(),
  };

  for (const event of deduplicateEvents(events)) {
    const payload = parseEventPayload<TimelinePayload>(event.payload);

    // ── native Codex app-server dialect ──
    // Checked first: its `turn/start` prompts carry the USER_EVENT origin the
    // flat branch claims, and its frames nest everything under `params`.
    if (isCodexEvent(event.type, payload)) {
      applyCodexEvent(state, event, payload);
      continue;
    }

    // ── ACP dialect ──
    if (event.type === 'session/update') {
      applySessionUpdate(state, event);
      continue;
    }
    if (event.type === 'session/prompt') {
      pushUser(state, event, contentText(payload?.['prompt']));
      continue;
    }

    // ── native Claude Code SDK dialect ──
    // `assistant`/`user` events with a `message.content` block array. Checked
    // before the flat branches, which would otherwise swallow `assistant`
    // and `user` and find no string to render.
    if (isClaudeNativeMessage(event.type, payload)) {
      applyClaudeNativeMessage(state, event);
      continue;
    }
    if (event.type === 'query') {
      // The launch prompt (and later user turns) in the native dialect.
      pushUser(state, event, claudeQueryText(payload));
      continue;
    }

    // ── flat dialect (other brokers, optimistic pending bubble, mock) ──
    if (TIMELINE_USER_TYPES.has(event.type) || event.origin === 'USER_EVENT') {
      pushUser(state, event, firstString(payload, ['message', 'text', 'content']) ?? '');
      continue;
    }
    if (TIMELINE_AGENT_TEXT_TYPES.has(event.type)) {
      pushText(
        state,
        'agent',
        event.id,
        firstString(payload, ['message', 'text', 'content', 'delta']) ?? '',
        event.timestamp,
      );
      continue;
    }
    if (event.type === 'agent_thought_chunk') {
      pushText(
        state,
        'thought',
        event.id,
        firstString(payload, ['message', 'text', 'content', 'delta']) ?? '',
        event.timestamp,
      );
      continue;
    }
    if (TIMELINE_TOOL_TYPES.has(event.type)) {
      pushTool(
        state,
        event.id,
        firstString(payload, ['id', 'toolCallId', 'tool_call_id', 'callId', 'call_id']),
        firstString(payload, ['name', 'toolName', 'tool_name', 'tool', 'title']) ?? 'tool',
        toolDetail(payload),
      );
      continue;
    }
    if (TIMELINE_TOOL_UPDATE_TYPES.has(event.type)) {
      if (payload) applyToolUpdate(state, payload);
      continue;
    }

    // ── lifecycle notes (both dialects) ──
    switch (event.type) {
      case 'agent.status_change': {
        const status = firstString(payload, ['status']);
        if (status)
          pushSystem(state, event.id, `agent ${status.replace(/_/g, ' ')}`, 'info', {
            at: event.timestamp,
            note: 'agent',
          });
        break;
      }
      case 'agent.daemon_started': {
        const name = firstString(payload, ['name']) ?? 'daemon';
        pushSystem(
          state,
          event.id,
          `dev server "${name}" registered — game preview updating`,
          'info',
          {
            at: event.timestamp,
            note: 'daemon',
          },
        );
        break;
      }
      case 'agent.setup': {
        const step = firstString(payload, ['step']);
        if (step)
          pushSystem(state, event.id, `setup: ${step}`, 'info', {
            at: event.timestamp,
            note: 'setup',
          });
        break;
      }
      case 'devbox.running':
        pushSystem(state, event.id, 'devbox running', 'info', {
          at: event.timestamp,
          note: 'devbox',
        });
        break;
      case 'devbox.suspended':
        pushSystem(state, event.id, 'devbox suspended', 'info', {
          at: event.timestamp,
          note: 'devbox',
        });
        break;
      case 'devbox.shutdown':
        pushSystem(state, event.id, 'devbox shut down', 'info', {
          at: event.timestamp,
          note: 'devbox',
        });
        break;
      case 'devbox.failed':
        pushSystem(state, event.id, 'devbox failed', 'error', {
          at: event.timestamp,
          note: 'devbox',
        });
        break;
      case 'agent.plan': {
        const plan = firstString(payload, ['message', 'plan', 'text']);
        if (plan)
          pushSystem(state, event.id, `plan: ${clamp(plan, 160)}`, 'info', {
            at: event.timestamp,
            note: 'plan',
          });
        break;
      }
      case 'turn.started':
        pushSystem(state, event.id, 'turn started', 'info', { at: event.timestamp, note: 'turn' });
        break;
      case 'turn.completed':
        pushSystem(state, event.id, 'turn complete', 'info', { at: event.timestamp, note: 'turn' });
        break;
      case 'turn.cancelled':
        pushSystem(state, event.id, 'turn interrupted', 'info', {
          at: event.timestamp,
          note: 'turn',
        });
        break;
      case 'agent.error':
      case 'turn.failed':
        pushSystem(
          state,
          event.id,
          firstString(payload, ['message', 'error']) ?? 'agent error',
          'error',
          { at: event.timestamp, note: 'agent' },
        );
        break;
      default:
        // Any other event just ends the current streaming bubble.
        state.streamingText = null;
        break;
    }
  }
  return state.items;
}

/** Latest agent status observed on the stream, else null. */
export function latestAgentStatus(events: ReflexStreamEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === 'agent.status_change') {
      const status = parseEventPayload<TimelinePayload>(event.payload)?.['status'];
      if (typeof status === 'string') return status;
    }
  }
  return null;
}

/** A timeline item for display: as built, or a collapsed run of tool calls. */
export type AgentTimelineDisplayItem =
  | AgentTimelineItem
  | { kind: 'tool-group'; id: string; tools: Extract<AgentTimelineItem, { kind: 'tool' }>[] };

/**
 * Collapse consecutive runs of tool calls longer than `threshold` into one
 * `tool-group` display item (the transcript renders these behind an
 * expander). Pure and order-preserving; runs at or under the threshold stay
 * as individual items.
 */
export function groupToolRuns(
  items: AgentTimelineItem[],
  threshold = 3,
): AgentTimelineDisplayItem[] {
  const out: AgentTimelineDisplayItem[] = [];
  let run: Extract<AgentTimelineItem, { kind: 'tool' }>[] = [];

  const flush = () => {
    if (run.length > threshold) {
      out.push({ kind: 'tool-group', id: `group-${run[0]!.id}`, tools: run });
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const item of items) {
    if (item.kind === 'tool') {
      run.push(item);
      continue;
    }
    flush();
    out.push(item);
  }
  flush();
  return out;
}

/**
 * Text of a user-authored event across all dialects (flat `message`,
 * ACP `session/prompt`, native Claude `query`, native Codex `turn/start` and
 * `turn/steer`), or null for anything else.
 */
export function userEventText(event: {
  type: string;
  payload?: unknown;
  origin?: string;
}): string | null {
  // Type first, payload second: streams are mostly agent traffic, and
  // parsing every one of those payloads is wasted work.
  const isUser =
    CODEX_USER_PROMPT_TYPES.has(event.type) ||
    event.type === 'session/prompt' ||
    event.type === 'query' ||
    TIMELINE_USER_TYPES.has(event.type) ||
    event.origin === 'USER_EVENT';
  if (!isUser) return null;

  const payload = parseEventPayload<TimelinePayload>(event.payload);
  if (CODEX_USER_PROMPT_TYPES.has(event.type)) return codexPromptText(payload) || null;
  if (event.type === 'session/prompt') return contentText(payload?.['prompt']) || null;
  if (event.type === 'query') return claudeQueryText(payload) || null;
  return firstString(payload, ['message', 'text', 'content']);
}

/**
 * Drop optimistic `pending-*` entries that the server has confirmed.
 *
 * A send is "confirmed" when a real user-authored event with the same text
 * exists in the stream — whether it arrived as the POST response or as the
 * socket echo (which often lands first; without this the transcript briefly
 * shows the message twice, once "Sending…" and once real).
 */
export function reconcilePendingEvents(events: ReflexStreamEvent[]): ReflexStreamEvent[] {
  const pending = events.filter((e) => e.id.startsWith('pending-'));
  if (pending.length === 0) return events;

  const confirmed = new Set<string>();
  for (const event of events) {
    if (event.id.startsWith('pending-')) continue;
    const text = userEventText(event);
    if (text) confirmed.add(text);
  }
  if (confirmed.size === 0) return events;

  return events.filter((event) => {
    if (!event.id.startsWith('pending-')) return true;
    const text = userEventText(event);
    // Attachment suffixes (📎 ...) keep the pending text distinct from the
    // plain echo; match on the first line, which is the typed message.
    const firstLine = text?.split('\n')[0] ?? '';
    return !(text && (confirmed.has(text) || confirmed.has(firstLine)));
  });
}
