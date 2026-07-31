import type { ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { within, expect } from 'storybook/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@reflex/ui/test-utils/providers';
import type { PluginAgentRef } from '@reflex/plugin-api';
import { WorkstationAgentSection } from './WorkstationAgentSection';
import { workstationsQueryKey } from './useWorkstations';
import { workstationCallsQueryKey } from './useWorkstationCalls';
import type { Workstation, WorkstationToolCallRecord } from '@runloop/reflex-workstation';

const now = 1_750_000_000_000;

const workstation: Workstation = {
  id: 'wks_section123456789abcde',
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

const calls: WorkstationToolCallRecord[] = [
  {
    id: 'wtc_1',
    workstationId: workstation.id,
    organizationId: 'org_1',
    userId: 'usr_1',
    agentId: 'agt_1',
    tool: 'workstation_run_command',
    summary: 'pnpm test',
    ok: true,
    error: null,
    durationMs: 42_000,
    createdAt: now - 60_000,
  },
  {
    id: 'wtc_2',
    workstationId: workstation.id,
    organizationId: 'org_1',
    userId: 'usr_1',
    agentId: 'agt_1',
    tool: 'workstation_write_file',
    summary: 'src/index.ts',
    ok: false,
    error: 'denied by the workstation owner',
    durationMs: 3_000,
    createdAt: now - 30_000,
  },
];

const agent: PluginAgentRef = {
  id: 'agt_1',
  devboxId: null,
  streamId: 'str_1',
  status: 'running',
  attachments: [
    {
      attachmentId: 'workstation',
      pluginName: 'workstation',
      config: { workstationId: workstation.id, workstationName: workstation.name },
    },
  ],
};

function Wrapper({
  children,
  seedCalls = calls,
}: {
  children: ReactNode;
  seedCalls?: WorkstationToolCallRecord[];
}) {
  const client = makeTestQueryClient();
  client.setQueryData(workstationsQueryKey('global'), [workstation]);
  client.setQueryData(workstationCallsQueryKey('global', workstation.id), seedCalls);
  return (
    <QueryClientProvider client={client}>
      <div className="w-80 p-4">{children}</div>
    </QueryClientProvider>
  );
}

const meta: Meta<typeof WorkstationAgentSection> = {
  title: 'Plugins/Workstation/AgentSection',
  component: WorkstationAgentSection,
};

export default meta;
type Story = StoryObj<typeof WorkstationAgentSection>;

export const WithRecentCalls: Story = {
  args: { agent },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('workstation-section')).toBeVisible();
    await expect(canvas.getByText('MacBook Pro')).toBeVisible();
    await expect(canvas.getByText('online')).toBeVisible();
    await expect(canvas.getByTestId('workstation-section-calls')).toBeVisible();
    await expect(canvas.getByText('pnpm test')).toBeVisible();
    await expect(canvas.getByText('src/index.ts')).toBeVisible();
  },
};

export const NoCallsYet: Story = {
  args: { agent },
  decorators: [
    (Story) => (
      <Wrapper seedCalls={[]}>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No tool calls yet.')).toBeVisible();
  },
};

export const NoWorkstationAttachment: Story = {
  args: { agent: { ...agent, attachments: [] } },
  decorators: [
    (Story) => (
      <Wrapper>
        <Story />
      </Wrapper>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('workstation-section-empty')).toBeVisible();
  },
};
