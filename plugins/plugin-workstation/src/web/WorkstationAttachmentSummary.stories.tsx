import type { Meta, StoryObj } from '@storybook/react-vite';
import { within, expect } from 'storybook/test';
import { WorkstationAttachmentSummary } from './WorkstationAttachmentSummary';

const meta: Meta<typeof WorkstationAttachmentSummary> = {
  title: 'Plugins/Workstation/AttachmentSummary',
  component: WorkstationAttachmentSummary,
};

export default meta;
type Story = StoryObj<typeof WorkstationAttachmentSummary>;

export const NamedWorkstation: Story = {
  args: { value: { workstationId: 'wks_abc', workstationName: 'MacBook Pro' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('MacBook Pro')).toBeVisible();
  },
};

export const ReadOnlyWorkstation: Story = {
  args: {
    value: { workstationId: 'wks_abc', workstationName: 'MacBook Pro', mode: 'read' },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/MacBook Pro \(read-only\)/)).toBeVisible();
  },
};

export const FallsBackToId: Story = {
  args: { value: { workstationId: 'wks_abc' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('wks_abc')).toBeVisible();
  },
};

export const EmptyValue: Story = {
  args: { value: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Added')).toBeVisible();
  },
};
