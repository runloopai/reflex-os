import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ProviderKeyList } from '../web/src/components/ProviderKeyList.tsx';
import { makeAnthropicProvider, makeOpenAiProvider, makeProviderKey } from '../tests/fixtures.ts';

const anthropic = makeAnthropicProvider();
const openai = makeOpenAiProvider();

const keys = [
  makeProviderKey({ id: 'mps_user_1', name: 'Personal key' }),
  makeProviderKey({ id: 'mps_sub_1', name: 'Claude Max', type: 'subscription' }),
  makeProviderKey({ id: 'mps_team_1', name: 'Platform team', scope: 'team' }),
  makeProviderKey({ id: 'mps_org_1', name: 'Org key', scope: 'org' }),
];

const meta = {
  title: 'Arcade/ProviderKeyList',
  component: ProviderKeyList,
  args: { provider: anthropic, keys },
} satisfies Meta<typeof ProviderKeyList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const GroupedByTier: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const label of ['Your keys', 'Team keys', 'Organization keys']) {
      await expect(canvas.getByText(label)).toBeInTheDocument();
    }
    await expect(canvas.getByText('Claude Max')).toBeInTheDocument();
    await expect(canvas.getByText('Personal key')).toBeInTheDocument();
    await expect(canvas.queryByText(/not supported/)).not.toBeInTheDocument();
  },
};

export const UnsupportedKeyType: Story = {
  args: {
    provider: openai,
    keys: [
      makeProviderKey({ id: 'mps_openai', name: 'OpenAI key', provider: 'openai' }),
      makeProviderKey({
        id: 'mps_openai_sub',
        name: 'Codex',
        provider: 'openai',
        type: 'subscription',
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('OpenAI key')).toBeInTheDocument();
    await expect(canvas.getByText('Subscription not supported')).toBeInTheDocument();
  },
};

export const NoKeys: Story = {
  args: { provider: openai, keys },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No OpenAI keys available to you.')).toBeInTheDocument();
  },
};

export const NoKeyNeeded: Story = {
  args: { provider: { ...openai, displayName: 'OpenCode Zen', keyTypes: [] }, keys },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/needs no provider key/)).toBeInTheDocument();
  },
};

/** A failed lookup must not read as "you have no keys". */
export const LookupFailed: Story = {
  args: { provider: anthropic, keys: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Couldn’t load your Anthropic keys/)).toBeInTheDocument();
    await expect(canvas.queryByText(/No Anthropic keys/)).not.toBeInTheDocument();
  },
};

export const AmbiguousProvider: Story = {
  args: { provider: null, keys },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Pick a model/)).toBeInTheDocument();
  },
};

/**
 * The picker. "Automatic" is the default and names the key Reflex would
 * resolve to, so choosing a specific one is a decision, not a guess.
 */
export const PickingAKey: Story = {
  args: { onSelect: fn() },
  render: function Picking(args) {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <ProviderKeyList
        {...args}
        selectedKeyId={selected}
        onSelect={(id) => {
          setSelected(id);
          args.onSelect?.(id);
        }}
      />
    );
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // Automatic is selected, and says which tier it resolves in.
    const automatic = canvas.getByRole('radio', { name: /Automatic/ });
    await expect(automatic).toBeChecked();
    await expect(canvas.getByText(/Automatic/)).toHaveTextContent('your keys first');

    await userEvent.click(canvas.getByRole('radio', { name: /Org key/ }));
    await expect(args.onSelect).toHaveBeenCalledWith('mps_org_1');
    await expect(canvas.getByRole('radio', { name: /Org key/ })).toBeChecked();
    await expect(automatic).not.toBeChecked();
    await expect(canvas.getByText('This game launches under the key you picked.')).toBeVisible();
  },
};

/** A key the provider cannot authenticate is listed, but not choosable. */
export const UnsupportedKeyIsNotSelectable: Story = {
  args: {
    provider: openai,
    onSelect: fn(),
    keys: [
      makeProviderKey({ id: 'mps_openai', name: 'OpenAI key', provider: 'openai' }),
      makeProviderKey({
        id: 'mps_openai_sub',
        name: 'Codex',
        provider: 'openai',
        type: 'subscription',
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: /Codex/ })).toBeDisabled();
    await expect(canvas.getByRole('radio', { name: /OpenAI key/ })).toBeEnabled();
  },
};

/** Without `onSelect` it stays the read-only list it was. */
export const ReadOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('radio')).not.toBeInTheDocument();
  },
};
