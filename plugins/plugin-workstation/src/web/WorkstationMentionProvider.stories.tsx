import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, within, expect, userEvent } from 'storybook/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@reflex/ui/test-utils/providers';
import { Command, CommandGroup, CommandList } from '@reflex/ui/components/ui/command';
import type { PluginAttachmentValue } from '@runloop/reflex-contract';
import { WorkstationMentionProvider } from './WorkstationMentionProvider';
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
  ...onlineWorkstation,
  id: 'wks_offline234567890abcde',
  name: 'Desktop',
  hostname: 'alice-desktop',
  platform: 'linux',
  status: 'offline',
};

function Frame({
  attachments = {},
  onApply = fn(),
}: {
  attachments?: Record<string, PluginAttachmentValue>;
  onApply?: (result: unknown) => void;
}) {
  const client = makeTestQueryClient();
  client.setQueryData(workstationsQueryKey('global'), [onlineWorkstation, offlineWorkstation]);
  return (
    <QueryClientProvider client={client}>
      <div className="w-[360px] rounded border bg-popover p-2 text-popover-foreground">
        <Command shouldFilter={false}>
          <CommandList>
            <CommandGroup heading="Workstations">
              <WorkstationMentionProvider
                query=""
                attachments={attachments}
                selectedPersonaId={null}
                onApply={onApply}
                onClose={fn()}
                limit={5}
              />
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </QueryClientProvider>
  );
}

const meta: Meta<typeof WorkstationMentionProvider> = {
  title: 'Plugins/Workstation/MentionProvider',
  component: WorkstationMentionProvider,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof WorkstationMentionProvider>;

export const ListsOnlineWorkstations: Story = {
  render: () => <Frame />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Each online machine is a single row (mode is chosen later in the picker)…
    await expect(
      canvas.getByTestId(`workstation-mention-${onlineWorkstation.id}`),
    ).toBeInTheDocument();
    // …while offline machines are not selectable and stay out of the menu.
    await expect(canvas.queryByText('Desktop')).toBeNull();
  },
};

export const SelectingAttachesReadWrite: Story = {
  args: {
    query: '',
    attachments: {},
    selectedPersonaId: null,
    onApply: fn(),
    onClose: fn(),
  },
  render: (args) => <Frame onApply={args.onApply} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByTestId(`workstation-mention-${onlineWorkstation.id}`));
    // Selecting attaches with the default (read & write); read-only is a
    // follow-up choice in the attachment picker, not a separate menu row.
    await expect(args.onApply).toHaveBeenCalledWith({
      kind: 'set-attachment',
      attachmentId: 'workstation',
      pluginName: 'workstation',
      config: {
        workstationId: onlineWorkstation.id,
        workstationName: onlineWorkstation.name,
        mode: 'read-write',
      },
    });
  },
};
