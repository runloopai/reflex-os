import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { within, expect, userEvent, waitFor } from 'storybook/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { makeTestQueryClient } from '@reflex/ui/test-utils/providers';
import { queryKeys } from '@reflex/ui/client/query-keys';
import { WorkstationToolCallView } from './WorkstationToolCallView';
import { workstationsQueryKey } from './useWorkstations';
import type {
  ListDirectoryResult,
  ReadFileResult,
  RunCommandResult,
  WriteFileResult,
  Workstation,
} from '@runloop/reflex-workstation';

const meta: Meta<typeof WorkstationToolCallView> = {
  title: 'Plugins/Workstation/ToolCallView',
  component: WorkstationToolCallView,
  decorators: [
    (Story) => (
      <div className="max-w-2xl p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof WorkstationToolCallView>;

function runCommandOutput(overrides: Partial<RunCommandResult> = {}): string {
  const result: RunCommandResult = {
    stdout: 'Mach Virtual Memory Statistics:\nPages free: 3851\nPages active: 440699',
    stderr: '',
    exitCode: 0,
    durationMs: 187,
    truncated: false,
    timedOut: false,
    ...overrides,
  };
  return JSON.stringify(result);
}

export const RunCommandSuccess: Story = {
  name: 'run_command – success renders a terminal block',
  args: {
    toolName: 'workstation_run_command',
    status: 'completed',
    input: { command: 'vm_stat && sysctl hw.memsize' },
    outputText: runCommandOutput(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('vm_stat && sysctl hw.memsize')).toBeVisible();
    await expect(canvas.getByText(/Pages free: 3851/)).toBeVisible();
    await expect(canvas.getByText('exit 0')).toBeVisible();
    await expect(canvas.getByText('187ms')).toBeVisible();
    // Raw JSON must never leak into the display.
    await expect(canvas.queryByText(/"durationMs"/)).toBeNull();
  },
};

export const RunCommandNonZeroExit: Story = {
  name: 'run_command – non-zero exit shows stderr and red exit badge',
  args: {
    toolName: 'workstation_run_command',
    status: 'completed',
    input: { command: 'cat /missing/file' },
    outputText: runCommandOutput({
      stdout: '',
      stderr: 'cat: /missing/file: No such file or directory',
      exitCode: 1,
      durationMs: 12,
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('exit 1')).toBeVisible();
    await expect(canvas.getByText('stderr')).toBeVisible();
    await expect(canvas.getByText(/No such file or directory/)).toBeVisible();
  },
};

export const RunCommandTimedOut: Story = {
  name: 'run_command – killed by timeout',
  args: {
    toolName: 'workstation_run_command',
    status: 'completed',
    input: { command: 'sleep 600' },
    outputText: runCommandOutput({
      stdout: '',
      exitCode: null,
      durationMs: 30_000,
      timedOut: true,
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('killed')).toBeVisible();
    await expect(canvas.getByText('timed out')).toBeVisible();
    await expect(canvas.getByText('no output')).toBeVisible();
  },
};

export const RunCommandWaitingForApproval: Story = {
  name: 'run_command – in progress explains the TUI approval gate',
  args: {
    toolName: 'workstation_run_command',
    status: 'in_progress',
    input: { command: 'rm -rf ./build' },
    outputText: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Waiting for the workstation/)).toBeVisible();
    await expect(canvas.getByText(/approve this call in their TUI/)).toBeVisible();
  },
};

export const ReadFile: Story = {
  name: 'read_file – shows path, size, and content',
  args: {
    toolName: 'workstation_read_file',
    status: 'completed',
    input: { path: '~/notes/todo.md' },
    outputText: JSON.stringify({
      path: '/Users/dines/notes/todo.md',
      encoding: 'utf8',
      content: '# Todo\n- ship the tool call renderers',
      size: 42,
      truncated: false,
    } satisfies ReadFileResult),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('/Users/dines/notes/todo.md')).toBeVisible();
    await expect(canvas.getByText('42 B')).toBeVisible();
    await expect(canvas.getByText(/ship the tool call renderers/)).toBeVisible();
  },
};

export const ReadFileBinary: Story = {
  name: 'read_file – binary content stays hidden',
  args: {
    toolName: 'workstation_read_file',
    status: 'completed',
    input: { path: '/tmp/logo.png' },
    outputText: JSON.stringify({
      path: '/tmp/logo.png',
      encoding: 'base64',
      content: 'aGVsbG8=',
      size: 2048,
      truncated: false,
    } satisfies ReadFileResult),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Binary file/)).toBeVisible();
    await expect(canvas.queryByText('aGVsbG8=')).toBeNull();
  },
};

export const WriteFile: Story = {
  name: 'write_file – compact confirmation row',
  args: {
    toolName: 'workstation_write_file',
    status: 'completed',
    input: { path: '/tmp/out.txt' },
    outputText: JSON.stringify({
      path: '/tmp/out.txt',
      bytesWritten: 1337,
    } satisfies WriteFileResult),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('/tmp/out.txt')).toBeVisible();
    await expect(canvas.getByText(/1\.3 KB written/)).toBeVisible();
  },
};

export const ListDirectory: Story = {
  name: 'list_directory – directories first, sizes on files',
  args: {
    toolName: 'workstation_list_directory',
    status: 'completed',
    input: { path: '.' },
    outputText: JSON.stringify({
      path: '/Users/dines/source',
      entries: [
        { name: 'zeta.txt', type: 'file', size: 512 },
        { name: 'agent-flow', type: 'directory' },
        { name: 'alpha.md', type: 'file', size: 2048 },
        { name: 'link', type: 'symlink' },
      ],
    } satisfies ListDirectoryResult),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('/Users/dines/source')).toBeVisible();
    await expect(canvas.getByText('4 entries')).toBeVisible();
    const names = canvas
      .getAllByRole('listitem')
      .map((li) => li.querySelector('span')?.textContent);
    await expect(names).toEqual(['agent-flow', 'alpha.md', 'link', 'zeta.txt']);
  },
};

export const OfflineError: Story = {
  name: 'failed – workstation_offline explains itself',
  args: {
    toolName: 'workstation_run_command',
    status: 'failed',
    input: { command: 'ls' },
    outputText: 'workstation_offline: no live connection for wks_abc',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Workstation offline')).toBeVisible();
    await expect(canvas.getByText(/reflex-cli connect/)).toBeVisible();
  },
};

export const ReadOnlyDenied: Story = {
  name: 'failed – read-only attachment blocks writes',
  args: {
    toolName: 'workstation_write_file',
    status: 'failed',
    input: { path: '/tmp/x' },
    outputText:
      'workstation_read_only: "workstation_write_file" is not permitted under read-only access',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Blocked by read-only access')).toBeVisible();
  },
};

export const OwnerDenied: Story = {
  name: 'failed – owner denied the call in the TUI',
  args: {
    toolName: 'workstation_run_command',
    status: 'failed',
    input: { command: 'rm -rf /' },
    outputText: 'denied by workstation owner',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Denied by the workstation owner')).toBeVisible();
  },
};

export const UnparseableFallsBackToRaw: Story = {
  name: 'unexpected payload falls back to raw text',
  args: {
    toolName: 'workstation_run_command',
    status: 'completed',
    input: { command: 'ls' },
    outputText: 'plain text that is not JSON',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('plain text that is not JSON')).toBeVisible();
  },
};

// --- "on <workstation>" source attribution ---

const now = 1_750_000_000_000;

const sourceWorkstation: Workstation = {
  id: 'wks_source1234567890abcd',
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

const SOURCE_AGENT_ID = 'agt_toolcallsource1';

/**
 * Seed the query cache the way the live chat sees it: the agent (with its
 * Connect attachment) and the caller's workstation list. `agentId` on the
 * story args makes the view render the source row from that cache.
 */
function makeSourceDecorator(workstations: Workstation[]) {
  return function SourceDecorator(Story: ComponentType) {
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.agent('global', SOURCE_AGENT_ID), {
      id: SOURCE_AGENT_ID,
      status: 'running',
      attachments: [
        {
          attachmentId: 'workstation',
          pluginName: 'workstation',
          config: {
            workstationId: sourceWorkstation.id,
            workstationName: sourceWorkstation.name,
          },
        },
      ],
    });
    client.setQueryData(workstationsQueryKey('global'), workstations);
    return (
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <div className="max-w-2xl p-4">
            <Story />
          </div>
        </QueryClientProvider>
      </MemoryRouter>
    );
  };
}

export const SourceChipNamesTheWorkstation: Story = {
  name: 'source chip names the machine under the output',
  args: {
    toolName: 'workstation_run_command',
    status: 'completed',
    input: { command: 'vm_stat' },
    outputText: runCommandOutput(),
    agentId: SOURCE_AGENT_ID,
  },
  decorators: [makeSourceDecorator([sourceWorkstation])],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByTestId('workstation-tool-call-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveTextContent('MacBook Pro');
    await expect(canvas.getByTestId('workstation-tool-call-chip-dot-online')).toBeInTheDocument();
  },
};

export const SourceChipHoverOpensDetails: Story = {
  name: 'hovering the source chip opens the workstation popover',
  args: {
    toolName: 'workstation_run_command',
    status: 'completed',
    input: { command: 'vm_stat' },
    outputText: runCommandOutput(),
    agentId: SOURCE_AGENT_ID,
  },
  decorators: [makeSourceDecorator([sourceWorkstation])],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(canvas.getByTestId('workstation-tool-call-chip'));
    // The hover-card portals into `document.body`, outside the canvas element.
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByTestId('resource-preview-card')).toBeVisible());
    await expect(body.getByText(/alices-mbp\.local · darwin/)).toBeVisible();
    await expect(body.getByTestId('workstation-preview-mode')).toHaveTextContent('Read & write');
  },
};

export const NoAttachmentNoSourceChip: Story = {
  name: 'agents without a workstation attachment get no source row',
  args: {
    toolName: 'workstation_run_command',
    status: 'completed',
    input: { command: 'ls' },
    outputText: runCommandOutput(),
    agentId: 'agt_without_workstation',
  },
  decorators: [
    (Story) => {
      const client = makeTestQueryClient();
      client.setQueryData(queryKeys.agent('global', 'agt_without_workstation'), {
        id: 'agt_without_workstation',
        status: 'running',
        attachments: [],
      });
      return (
        <MemoryRouter>
          <QueryClientProvider client={client}>
            <div className="max-w-2xl p-4">
              <Story />
            </div>
          </QueryClientProvider>
        </MemoryRouter>
      );
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('exit 0')).toBeVisible();
    await expect(canvas.queryByTestId('workstation-tool-call-source')).toBeNull();
  },
};
