import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { within, expect, userEvent, waitFor } from 'storybook/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@reflex/ui/test-utils/providers';
import { TooltipProvider } from '@reflex/ui/components/ui/tooltip';
import type { Workstation, WorkstationAttachmentConfig } from '@runloop/reflex-workstation';
import { WorkstationChip } from './WorkstationChip';
import { workstationsQueryKey } from './useWorkstations';

const now = 1_750_000_000_000;

const workstation: Workstation = {
  id: 'wks_chip1234567890abcdef',
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

const config: WorkstationAttachmentConfig = {
  workstationId: workstation.id,
  workstationName: workstation.name,
};

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

function wrap(workstations?: Workstation[]): Decorator {
  return (Story) => (
    <Wrapper workstations={workstations}>
      <Story />
    </Wrapper>
  );
}

/** The hover card portals into `document.body`, outside the canvas element. */
async function openPopover(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.hover(canvas.getByTestId('workstation-chip'));
  const body = within(canvasElement.ownerDocument.body);
  await waitFor(() => expect(body.getByTestId('resource-preview-card')).toBeVisible());
  return body;
}

const meta: Meta<typeof WorkstationChip> = {
  title: 'Plugins/Workstation/WorkstationChip',
  component: WorkstationChip,
  args: { config },
};

export default meta;
type Story = StoryObj<typeof WorkstationChip>;

/** Live machine: name plus a green presence dot. */
export const Online: Story = {
  decorators: [wrap()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByTestId('workstation-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveTextContent('MacBook Pro');
    await expect(canvas.getByTestId('workstation-chip-dot-online')).toBeInTheDocument();
  },
};

/** An offline machine keeps its name but flips the dot to amber. */
export const Offline: Story = {
  decorators: [wrap([{ ...workstation, status: 'offline' }])],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('workstation-chip-dot-offline')).toBeInTheDocument();
    await expect(canvas.queryByTestId('workstation-chip-dot-online')).toBeNull();
  },
};

/**
 * Without a live row (a non-owner, or a machine that has never connected)
 * there is no presence to show, so the dot is omitted entirely.
 */
export const NoPresenceForNonOwner: Story = {
  decorators: [wrap([])],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByTestId('workstation-chip');
    // Falls back to the attachment's recorded name.
    await expect(chip).toHaveTextContent('MacBook Pro');
    await expect(canvas.queryByTestId('workstation-chip-dot-online')).toBeNull();
    await expect(canvas.queryByTestId('workstation-chip-dot-offline')).toBeNull();
  },
};

/** With neither a live row nor a recorded name, the id is the label. */
export const FallsBackToWorkstationId: Story = {
  args: { config: { workstationId: workstation.id } },
  decorators: [wrap([])],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('workstation-chip')).toHaveTextContent(workstation.id);
  },
};

/** Callers can rename the chip's testid so multiple chips stay addressable. */
export const CustomTestId: Story = {
  args: { 'data-testid': 'workstation-source-chip', className: 'bg-muted' },
  decorators: [wrap()],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByTestId('workstation-source-chip');
    await expect(chip).toHaveClass('bg-muted');
    await expect(canvas.getByTestId('workstation-source-chip-dot-online')).toBeInTheDocument();
  },
};

/** Hovering answers "which machine is this?" with the full detail card. */
export const PopoverShowsDetails: Story = {
  decorators: [wrap()],
  play: async ({ canvasElement }) => {
    const body = await openPopover(canvasElement);
    await expect(body.getByTestId('workstation-preview-mode')).toHaveTextContent('Read & write');
    await expect(body.getByTestId('workstation-preview-status')).toHaveTextContent('Online');
    await expect(body.getByText(/alices-mbp\.local · darwin/)).toBeVisible();
    await expect(body.getByText('/Users/alice/dev')).toBeVisible();
    await expect(body.getByRole('link', { name: /Open Workstations/ })).toBeVisible();
  },
};

/** Read-only attachments say so, so nobody expects writes to land. */
export const PopoverReadOnlyMode: Story = {
  args: { config: { ...config, mode: 'read' } },
  decorators: [wrap()],
  play: async ({ canvasElement }) => {
    const body = await openPopover(canvasElement);
    await expect(body.getByTestId('workstation-preview-mode')).toHaveTextContent('Read-only');
  },
};

/** Offline machines get the reconnect instruction, not just a status. */
export const PopoverOfflineShowsReconnectHint: Story = {
  decorators: [wrap([{ ...workstation, status: 'offline', connectedAt: null }])],
  play: async ({ canvasElement }) => {
    const body = await openPopover(canvasElement);
    await expect(body.getByTestId('workstation-preview-status')).toHaveTextContent('Offline');
    await expect(body.getByText(/Last seen/)).toBeVisible();
    await expect(body.getByText(/reflex-cli connect/)).toBeVisible();
  },
};

/** Non-owners see the attachment details without any presence data. */
export const PopoverNonOwnerHidesPresence: Story = {
  decorators: [wrap([])],
  play: async ({ canvasElement }) => {
    const body = await openPopover(canvasElement);
    await expect(body.getByText(/only visible to the workstation's owner/)).toBeVisible();
    await expect(body.queryByTestId('workstation-preview-status')).toBeNull();
  },
};
