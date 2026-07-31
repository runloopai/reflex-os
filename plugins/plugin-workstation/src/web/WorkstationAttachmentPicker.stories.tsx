import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { within, expect, fn, userEvent } from 'storybook/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@reflex/ui/test-utils/providers';
import { TooltipProvider } from '@reflex/ui/components/ui/tooltip';
import { WorkstationAttachmentPicker } from './WorkstationAttachmentPicker';
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

interface WrapperProps {
  workstations?: Workstation[];
  children: ReactNode;
}

function Wrapper({
  workstations = [onlineWorkstation, offlineWorkstation],
  children,
}: WrapperProps) {
  const client = makeTestQueryClient();
  client.setQueryData(workstationsQueryKey('global'), workstations);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <div className="w-80 p-4">{children}</div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const meta: Meta<typeof WorkstationAttachmentPicker> = {
  title: 'Plugins/Workstation/AttachmentPicker',
  component: WorkstationAttachmentPicker,
};

export default meta;
type Story = StoryObj<typeof WorkstationAttachmentPicker>;

export const Default: Story = {
  args: { value: null, onChange: fn() },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const onlinePill = canvas.getByTestId(`workstation-pill-${onlineWorkstation.id}`);
    await expect(onlinePill).toBeVisible();
    await expect(canvas.getByText('MacBook Pro')).toBeVisible();
    // Offline machines render but cannot be selected.
    const offlinePill = canvas.getByTestId(`workstation-pill-${offlineWorkstation.id}`);
    await expect(offlinePill).toBeDisabled();
    // Selecting an online workstation emits its config, defaulting to full access.
    await userEvent.click(onlinePill);
    await expect(args.onChange).toHaveBeenCalledWith({
      workstationId: onlineWorkstation.id,
      workstationName: onlineWorkstation.name,
      mode: 'read-write',
    });
  },
};

export const ChoosesReadOnlyAccess: Story = {
  args: {
    value: { workstationId: onlineWorkstation.id, workstationName: onlineWorkstation.name },
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // The access toggle only appears once a machine is selected.
    await expect(canvas.getByTestId('workstation-mode-toggle')).toBeVisible();
    await userEvent.click(canvas.getByTestId('workstation-mode-read'));
    await expect(args.onChange).toHaveBeenCalledWith({
      workstationId: onlineWorkstation.id,
      workstationName: onlineWorkstation.name,
      mode: 'read',
    });
  },
};

export const SelectedClearsOnSecondClick: Story = {
  args: {
    value: { workstationId: onlineWorkstation.id, workstationName: onlineWorkstation.name },
    onChange: fn(),
  },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const onlinePill = canvas.getByTestId(`workstation-pill-${onlineWorkstation.id}`);
    await userEvent.click(onlinePill);
    await expect(args.onChange).toHaveBeenCalledWith(null);
  },
};

export const EmptyStateExplainsConnect: Story = {
  args: { value: null, onChange: fn() },
  decorators: [
    (Story) => (
      <Wrapper workstations={[]}>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('workstation-picker-empty')).toBeVisible();
    await expect(canvas.getByText('reflex-cli connect')).toBeVisible();
  },
};
