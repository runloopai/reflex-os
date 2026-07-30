import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConnectReflex } from '../web/src/components/ConnectReflex.tsx';

const waiting = {
  connectionId: 'con_1',
  userCode: 'WXYZ-1234',
  approveUrl: 'https://reflex.test/connect?code=WXYZ-1234',
};

const meta = {
  title: 'Arcade/ConnectReflex',
  component: ConnectReflex,
  args: { state: { phase: 'idle' }, onConnect: fn(), onCancel: fn() },
} satisfies Meta<typeof ConnectReflex>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId('connect-button'));
    await expect(args.onConnect).toHaveBeenCalled();
    await expect(canvas.getByText(/never sees your Reflex password/)).toBeInTheDocument();
  },
};

export const Starting: Story = {
  args: { state: { phase: 'starting' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('connect-button')).toBeDisabled();
  },
};

/**
 * The code is the whole point of this state: the player checks that the page
 * Reflex opened is about this connection, and the link is there for when the
 * browser blocked the new tab.
 */
export const Waiting: Story = {
  args: { state: { phase: 'waiting', waiting } },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('WXYZ-1234')).toBeVisible();
    const link = canvas.getByRole('link', { name: /Open the approval page/ });
    await expect(link).toHaveAttribute('href', waiting.approveUrl);
    await expect(link).toHaveAttribute('target', '_blank');

    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(args.onCancel).toHaveBeenCalled();
  },
};

export const Failed: Story = {
  args: { state: { phase: 'error', message: 'You turned down the connection in Reflex.' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('connect-error')).toHaveTextContent(/turned down/);
    // A failed attempt still offers the button, not a dead end.
    await expect(canvas.getByTestId('connect-button')).toBeEnabled();
  },
};

/**
 * Once an account is connected this control is no longer the point of the
 * screen — it is "add another", sitting under the accounts already listed,
 * and the explainer has been read.
 */
export const AlreadyConnected: Story = {
  args: { compact: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByTestId('connect-button');
    await expect(button).toHaveTextContent('Connect another account');
    await expect(canvas.queryByText(/never sees your Reflex password/)).not.toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onConnect).toHaveBeenCalled();
  },
};

/** The approval step is the same at either size — code, link, cancel. */
export const CompactWaiting: Story = {
  args: { compact: true, state: { phase: 'waiting', waiting } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('connect-code')).toHaveTextContent('WXYZ-1234');
  },
};

/** A failure still surfaces in the quiet form. */
export const CompactFailed: Story = {
  args: { compact: true, state: { phase: 'error', message: 'Reflex turned it down.' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('connect-error')).toHaveTextContent(/turned it down/);
    await expect(canvas.getByTestId('connect-button')).toBeEnabled();
  },
};
