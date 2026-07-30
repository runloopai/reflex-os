/**
 * The URL is the state, so this exercises the hooks against a real router —
 * the pure `applyUrlPatch`/`parseUrlValue` tests cannot see the trap they
 * exist for: `useSearchParams` hands its setter the params of the render it
 * came from, so two setters fired from one handler drop the first write.
 *
 * The probe is the game view's pair (which panel, and whether the phone's
 * room sheet is over the game) with the markup taken away.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { useLocation } from 'react-router-dom';
import { urlParam, useUrlState, useUrlPatch } from '../web/src/lib/useUrlState.ts';
import {
  DEFAULT_PANEL,
  DEFAULT_ROOM,
  PANEL_KEYS,
  ROOM_MODES,
  type RoomMode,
} from '../web/src/lib/panels.ts';

function UrlStateProbe() {
  const [tab, setTab] = useUrlState('tab', PANEL_KEYS, DEFAULT_PANEL);
  const [room, setRoom] = useUrlState('room', ROOM_MODES, DEFAULT_ROOM);
  const patchUrl = useUrlPatch();
  const { search } = useLocation();

  // What the dock does: panel and room in a single navigation.
  const selectPanel = (panel: (typeof PANEL_KEYS)[number]) => {
    const open = !(room === 'open' && tab === panel);
    patchUrl({
      tab: urlParam(panel, DEFAULT_PANEL),
      room: urlParam<RoomMode>(open ? 'open' : 'closed', DEFAULT_ROOM),
    });
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <p data-testid="view">{`${tab} / ${room}`}</p>
      <p data-testid="search">{search}</p>
      {PANEL_KEYS.map((panel) => (
        <button key={panel} type="button" onClick={() => selectPanel(panel)}>
          {`Dock: ${panel}`}
        </button>
      ))}
      <button type="button" onClick={() => setTab('agent')}>
        Desktop tab: agent
      </button>
      <button type="button" onClick={() => setRoom('closed')}>
        Close the room
      </button>
      <button type="button" onClick={() => patchUrl({ tab: 'nope' })}>
        Break the URL
      </button>
    </div>
  );
}

const meta = {
  title: 'Arcade/UrlState',
  component: UrlStateProbe,
} satisfies Meta<typeof UrlStateProbe>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opening a panel from the dock moves both params, or one is lost. */
export const DockMovesPanelAndRoomTogether: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Dock: suggestions' }));
    await expect(canvas.getByTestId('view')).toHaveTextContent('suggestions / open');
    const search = canvas.getByTestId('search').textContent ?? '';
    const params = new URLSearchParams(search);
    await expect(params.get('tab')).toBe('suggestions');
    await expect(params.get('room')).toBe('open');
  },
};

/** Tapping the open panel hands the game back — and cleans up after itself. */
export const DefaultsNeverStayInTheUrl: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Dock: chat' }));
    await expect(canvas.getByTestId('view')).toHaveTextContent('chat / open');
    // Chat is the default panel, so only the room is worth naming.
    await expect(canvas.getByTestId('search').textContent).toBe('?room=open');
    await userEvent.click(canvas.getByRole('button', { name: 'Dock: chat' }));
    await expect(canvas.getByTestId('view')).toHaveTextContent('chat / closed');
    await expect(canvas.getByTestId('search').textContent).toBe('');
  },
};

/** A desktop tab click writes only its own param and leaves the room alone. */
export const OneSetterLeavesTheOtherParam: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Dock: suggestions' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Desktop tab: agent' }));
    await expect(canvas.getByTestId('view')).toHaveTextContent('agent / open');
    // And closing the sheet leaves the panel you were reading where it was.
    await userEvent.click(canvas.getByRole('button', { name: 'Close the room' }));
    await expect(canvas.getByTestId('view')).toHaveTextContent('agent / closed');
    await expect(canvas.getByTestId('search').textContent).toBe('?tab=agent');
  },
};

/** A stale link from a future version, or a typo, still opens on something. */
export const UnknownValueFallsBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Break the URL' }));
    await expect(canvas.getByTestId('search').textContent).toBe('?tab=nope');
    await expect(canvas.getByTestId('view')).toHaveTextContent('chat / closed');
  },
};
