import type { ComponentType } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { within, expect } from 'storybook/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@reflex/ui/test-utils/providers';
import { WorkstationsPage } from './WorkstationsPage';
import { workstationsQueryKey } from './useWorkstations';
import type { Workstation } from '@runloop/reflex-workstation';

const now = 1_750_000_000_000;

const onlineWorkstation: Workstation = {
  id: 'wks_online1234567890abcde',
  name: 'MacBook Pro',
  hostname: 'alices-mbp.local',
  platform: 'darwin',
  toolRoot: '/Users/alice/dev',
  status: 'online',
  userId: 'usr_1',
  organizationId: 'org_1',
  connectedAt: now - 60_000,
  lastSeenAt: now,
  createdAt: now - 86_400_000,
};

const offlineWorkstation: Workstation = {
  id: 'wks_offline234567890abcde',
  name: 'Desktop',
  hostname: 'alice-desktop',
  platform: 'linux',
  toolRoot: '/home/alice/code',
  status: 'offline',
  userId: 'usr_1',
  organizationId: 'org_1',
  connectedAt: null,
  lastSeenAt: now - 3_600_000,
  createdAt: now - 172_800_000,
};

function withWorkstations(workstations: Workstation[]) {
  return (Story: ComponentType) => {
    const client = makeTestQueryClient();
    client.setQueryData(workstationsQueryKey('global'), workstations);
    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof WorkstationsPage> = {
  title: 'Plugins/Workstation/WorkstationsPage',
  component: WorkstationsPage,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof WorkstationsPage>;

export const Default: Story = {
  decorators: [withWorkstations([onlineWorkstation, offlineWorkstation])],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Workstations')).toBeVisible();
    await expect(canvas.getByTestId('workstations-list')).toBeVisible();

    const onlineRow = within(canvas.getByTestId(`workstation-row-${onlineWorkstation.id}`));
    await expect(onlineRow.getByText('MacBook Pro')).toBeVisible();
    await expect(onlineRow.getByText('online')).toBeVisible();
    await expect(onlineRow.getByText(/alices-mbp\.local · darwin/)).toBeVisible();

    const offlineRow = within(canvas.getByTestId(`workstation-row-${offlineWorkstation.id}`));
    await expect(offlineRow.getByText('Desktop')).toBeVisible();
    await expect(offlineRow.getByText('offline')).toBeVisible();
    await expect(offlineRow.getByText(/last seen/)).toBeVisible();

    // Connect instructions stay reachable even when machines already exist.
    await expect(canvas.getByText('Connect another machine')).toBeVisible();
    await expect(canvas.getByText('reflex-cli connect --dir ~/dev')).toBeVisible();
  },
};

export const EmptyTeachesConnectFlow: Story = {
  decorators: [withWorkstations([])],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Workstations')).toBeVisible();
    await expect(canvas.getByTestId('workstations-empty')).toBeVisible();
    await expect(canvas.getByText(/No workstations yet/)).toBeVisible();
    await expect(canvas.getByText('reflex-cli connect --dir ~/dev')).toBeVisible();
  },
};
