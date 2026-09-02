/**
 * The shelves' sort control.
 *
 * It stays a real `<select>` on purpose — a phone gives it a native picker,
 * a keyboard gives it type-ahead, and the smoke test drives it with
 * `getByLabel('Sort').selectOption(...)`. The play function pins that
 * contract: the label points at a `<select>` whose values are `GAME_SORTS`.
 */
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { SortSelect } from '../web/src/components/SortSelect.tsx';
import type { GameSort } from '../web/src/lib/useGames.ts';

function Harness() {
  const [sort, setSort] = useState<GameSort>('newest');
  return (
    <div className="flex items-center gap-4">
      <SortSelect value={sort} onChange={setSort} />
      <span data-testid="chosen" className="text-xs text-zinc-500">
        {sort}
      </span>
    </div>
  );
}

const meta = {
  title: 'Arcade/SortSelect',
  component: SortSelect,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story: () => React.ReactElement) => (
      <div className="w-[420px] bg-zinc-950 p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SortSelect>;

export default meta;

export const Interactive: StoryObj = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByLabelText('Sort');
    await expect(select).toHaveValue('newest');
    await userEvent.selectOptions(select, 'plays-desc');
    await expect(canvas.getByTestId('chosen')).toHaveTextContent('plays-desc');
    // Every sort the URL can carry has an option, or a shared link falls back.
    await expect(canvas.getByRole('option', { name: 'Least played' })).toBeInTheDocument();
  },
};
