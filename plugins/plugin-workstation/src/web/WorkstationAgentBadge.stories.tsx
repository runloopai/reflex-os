import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { within, expect, userEvent, waitFor } from 'storybook/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@reflex/ui/test-utils/providers';
import { TooltipProvider } from '@reflex/ui/components/ui/tooltip';
import type { PluginAgentRef } from '@reflex/plugin-api';
import { WorkstationAgentBadge } from './WorkstationAgentBadge';
import { workstationsQueryKey } from './useWorkstations';
import type { Workstation, WorkstationAccessMode } from '@runloop/reflex-workstation';

const now = 1_750_000_000_000;

const workstation: Workstation = {
  id: 'wks_badge1234567890abcdef',
  name: 'MacBook Pro',
  hostname: 'alices-mbp.local',
  platform: 'darwin',
  toolRoot: '/Users/alice/dev',
  status: 'online',
  userId: 'usr_1',
  organizationId: 'org_1',
  connectedAt: now,
  lastSeenAt: now,
  createdAt: now - 86_400_000,
};

function makeAgent(withAttachment: boolean, mode?: WorkstationAccessMode): PluginAgentRef {
  return {
    id: 'agt_1',
    devboxId: null,
    streamId: 'str_1',
    status: 'running',
    attachments: withAttachment
      ? [
          {
            attachmentId: 'workstation',
            pluginName: 'workstation',
            config: {
              workstationId: workstation.id,
              workstationName: workstation.name,
              ...(mode ? { mode } : {}),
            },
          },
        ]
      : [],
  };
}

function Wrapper({
  children,
  workstations = [workstation],
}: {
  children: ReactNode;
  workstations?: Workstation[];
}) {
  const client = makeTestQueryClient();
  client.setQueryData(workstationsQueryKey('global'), workstations);
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <div className="p-4">{children}</div>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

/** The hover-card portals into `document.body`, outside the canvas element. */
function bodyOf(canvasElement: HTMLElement) {
  return within(canvasElement.ownerDocument.body);
}

async function openPopover(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.hover(canvas.getByTestId('workstation-agent-badge'));
  const body = bodyOf(canvasElement);
  await waitFor(() => expect(body.getByTestId('resource-preview-card')).toBeVisible());
  return body;
}

const meta: Meta<typeof WorkstationAgentBadge> = {
  title: 'Plugins/Workstation/AgentBadge',
  component: WorkstationAgentBadge,
};

export default meta;
type Story = StoryObj<typeof WorkstationAgentBadge>;

export const Online: Story = {
  args: { agent: makeAgent(true) },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('workstation-agent-badge')).toBeVisible();
    await expect(canvas.getByText('MacBook Pro')).toBeVisible();
    await expect(canvas.getByTestId('workstation-agent-badge-dot-online')).toBeInTheDocument();
  },
};

export const PopoverShowsDetails: Story = {
  name: 'Hover opens details: mode, host, tool root, presence',
  args: { agent: makeAgent(true) },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const body = await openPopover(canvasElement);
    await expect(body.getByTestId('workstation-preview-mode')).toHaveTextContent('Read & write');
    await expect(body.getByTestId('workstation-preview-status')).toHaveTextContent('Online');
    await expect(body.getByText(/alices-mbp\.local · darwin/)).toBeVisible();
    await expect(body.getByText('/Users/alice/dev')).toBeVisible();
    await expect(body.getByRole('link', { name: /Open Workstations/ })).toBeVisible();
  },
};

export const PopoverReadOnlyMode: Story = {
  name: 'Hover popover marks read-only attachments',
  args: { agent: makeAgent(true, 'read') },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const body = await openPopover(canvasElement);
    await expect(body.getByTestId('workstation-preview-mode')).toHaveTextContent('Read-only');
  },
};

export const OfflineShowsAmberDot: Story = {
  args: { agent: makeAgent(true) },
  decorators: [
    (Story) => (
      <Wrapper workstations={[{ ...workstation, status: 'offline' }]}>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('workstation-agent-badge-dot-offline')).toBeInTheDocument();
  },
};

export const PopoverOfflineShowsReconnectHint: Story = {
  name: 'Hover popover explains how to reconnect an offline machine',
  args: { agent: makeAgent(true) },
  decorators: [
    (Story) => (
      <Wrapper workstations={[{ ...workstation, status: 'offline', connectedAt: null }]}>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const body = await openPopover(canvasElement);
    await expect(body.getByTestId('workstation-preview-status')).toHaveTextContent('Offline');
    await expect(body.getByText(/Last seen/)).toBeVisible();
    await expect(body.getByText(/reflex-cli connect/)).toBeVisible();
  },
};

export const PopoverNonOwnerHidesPresence: Story = {
  name: 'Hover popover for non-owners omits presence details',
  args: { agent: makeAgent(true) },
  decorators: [
    (Story) => (
      <Wrapper workstations={[]}>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const body = await openPopover(canvasElement);
    await expect(body.getByText(/only visible to the workstation's owner/)).toBeVisible();
    await expect(body.queryByTestId('workstation-preview-status')).toBeNull();
  },
};

export const NoAttachmentRendersNothing: Story = {
  args: { agent: makeAgent(false) },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('workstation-agent-badge')).not.toBeInTheDocument();
  },
};
