/**
 * Regression cover for the resync-on-reconnect contract.
 *
 * Hub frames are fire and forget: anything pushed while the socket is down
 * is never replayed. Without a resync, a suggestion dispatched during the
 * gap stayed in "Up next" and the agent banner stayed on "idle" until the
 * page was reloaded by hand. `useArcadeReconnect` is what closes that gap,
 * so it gets a test that actually drops a socket.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { ArcadeSocketProvider, useArcadeReconnect } from '../web/src/lib/socket.tsx';

/** Minimal stand-in for the browser WebSocket the provider opens. */
class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  readyState = 0;

  constructor() {
    FakeSocket.last = this;
  }
  send(): void {}
  close(): void {
    this.drop();
  }
  /** Complete the handshake, as the real socket does asynchronously. */
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function Counter() {
  const [resyncs, setResyncs] = useState(0);
  useArcadeReconnect(() => setResyncs((n) => n + 1));
  return <p data-testid="resyncs">resyncs: {resyncs}</p>;
}

const meta = {
  title: 'Arcade/ArcadeSocketReconnect',
  component: Counter,
  decorators: [
    (Story) => {
      localStorage.setItem('reflex-arcade:token', 'ark_story');
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
      return (
        <ArcadeSocketProvider>
          <Story />
        </ArcadeSocketProvider>
      );
    },
  ],
} satisfies Meta<typeof Counter>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The provider retries 2s after a close, so each cycle waits for a fresh
 * socket instance before completing its handshake.
 */
async function nextSocket(previous: FakeSocket | null): Promise<FakeSocket> {
  for (let i = 0; i < 100; i++) {
    if (FakeSocket.last && FakeSocket.last !== previous) return FakeSocket.last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the provider never opened a new socket');
}

export const ResyncsOnlyAfterADrop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // First connect is not a resync: the view's mount fetch already covers it.
    const first = await nextSocket(null);
    first.open();
    await expect(canvas.getByTestId('resyncs')).toHaveTextContent('resyncs: 0');

    // Drop and come back — the gap is exactly when frames go missing.
    first.drop();
    const second = await nextSocket(first);
    second.open();
    await waitFor(() => expect(canvas.getByTestId('resyncs')).toHaveTextContent('resyncs: 1'));

    second.drop();
    const third = await nextSocket(second);
    third.open();
    await waitFor(() => expect(canvas.getByTestId('resyncs')).toHaveTextContent('resyncs: 2'));
  },
};
