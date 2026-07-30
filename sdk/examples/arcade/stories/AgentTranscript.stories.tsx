/**
 * The agent transcript, rendered from a raw Reflex event stream.
 *
 * Reflex streams speak the agent's own protocol, and the chat kit's
 * `buildAgentTimeline` has to understand each one. These stories pin the two
 * an arcade game can be launched with: `claude-code`'s flat events, and
 * `codex`'s native app-server dialect — JSON-RPC frames whose event type IS
 * the method and whose content sits under `params`. The Codex stream used to
 * render as an empty pane.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import type { ReflexStreamEvent } from '@runloop/reflex-client';
import { MessageList } from '../web/src/components/reflex/message-list.tsx';

const START = Date.parse('2026-07-20T10:00:00.000Z');
let seq = 0;

function event(
  type: string,
  payload: unknown,
  extra: Partial<ReflexStreamEvent> = {},
): ReflexStreamEvent {
  seq += 1;
  return {
    id: `evt_${seq}`,
    streamId: 'strm_story',
    type,
    payload,
    timestamp: START + seq * 1_000,
    ...extra,
  } as ReflexStreamEvent;
}

/** One native Codex notification: the event type is the JSON-RPC method. */
function codex(method: string, params: Record<string, unknown>): ReflexStreamEvent {
  return event(method, { jsonrpc: '2.0', method, params });
}

const codexEvents: ReflexStreamEvent[] = [
  event(
    'turn/start',
    {
      jsonrpc: '2.0',
      method: 'turn/start',
      params: { input: [{ type: 'text', text: 'Add a scoreboard to the snake game' }] },
    },
    { origin: 'USER_EVENT' },
  ),
  codex('turn/started', { turn: { id: 'turn_1' } }),
  codex('item/reasoning/summaryTextDelta', {
    itemId: 'r1',
    delta: 'The score already lives in the game loop, so this is a render-only change.',
  }),
  codex('item/agentMessage/delta', { itemId: 'm1', delta: 'Adding a scoreboard — ' }),
  codex('item/agentMessage/delta', { itemId: 'm1', delta: 'top right, updated every tick.' }),
  codex('item/started', {
    item: {
      id: 'c1',
      type: 'commandExecution',
      command: 'rg -n "score" src/',
      cwd: '/home/user/game',
    },
  }),
  codex('item/completed', {
    item: {
      id: 'c1',
      type: 'commandExecution',
      command: 'rg -n "score" src/',
      status: 'completed',
      exitCode: 0,
    },
  }),
  codex('item/started', {
    item: { id: 'f1', type: 'fileChange', changes: [{ path: 'src/hud.ts', diff: '@@' }] },
  }),
  codex('item/completed', {
    item: {
      id: 'f1',
      type: 'fileChange',
      status: 'completed',
      changes: [{ path: 'src/hud.ts', diff: '@@' }],
    },
  }),
  codex('item/completed', {
    item: {
      id: 'm1',
      type: 'agentMessage',
      text: 'Adding a scoreboard — top right, updated every tick.',
    },
  }),
  event('agent.daemon_started', { name: 'game-dev', url: 'http://localhost:5173' }),
  codex('item/agentMessage/delta', {
    itemId: 'm2',
    delta: 'Shipped. The dev server picked it up automatically.',
  }),
  codex('turn/completed', { turn: { status: 'completed', durationMs: 4_200 } }),
];

const flatEvents: ReflexStreamEvent[] = [
  event('message', { message: 'Add a scoreboard to the snake game' }, { origin: 'USER_EVENT' }),
  event('turn.started', {}),
  event('assistant', { message: 'Adding a scoreboard — top right, updated every tick.' }),
  event('tool_call', { id: 't1', name: 'Bash', input: { command: 'rg -n "score" src/' } }),
  event('tool_call_update', { id: 't1', status: 'completed' }),
  event('tool_call', { id: 't2', name: 'Edit', input: { path: 'src/hud.ts' } }),
  event('tool_call_update', { id: 't2', status: 'completed' }),
  event('agent.daemon_started', { name: 'game-dev', url: 'http://localhost:5173' }),
  event('assistant', { message: 'Shipped. The dev server picked it up automatically.' }),
  event('turn.completed', {}),
];

const meta = {
  title: 'Arcade/AgentTranscript',
  component: MessageList,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story: () => React.ReactElement) => (
      <div className="h-[560px] w-[520px] overflow-hidden rounded-xl border border-zinc-800 bg-[var(--reflex-chat-bg)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A `codex` game: native app-server frames render like any other agent. */
export const NativeCodex: Story = {
  args: { events: codexEvents },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Add a scoreboard to the snake game')).toBeVisible();
    // Deltas merge into one bubble; the terminal frame does not repeat them.
    await expect(
      canvas.getByText('Adding a scoreboard — top right, updated every tick.'),
    ).toBeVisible();
    await expect(canvas.getByText('rg -n "score" src/')).toBeVisible();
    await expect(canvas.getByText('src/hud.ts')).toBeVisible();
    await expect(canvas.getByText(/turn complete/)).toBeVisible();
  },
};

/** The same turn on a `claude-code` game, for comparison. */
export const FlatDialect: Story = {
  args: { events: flatEvents },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Add a scoreboard to the snake game')).toBeVisible();
    await expect(canvas.getByText(/turn complete/)).toBeVisible();
  },
};
