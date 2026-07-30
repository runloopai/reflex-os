/**
 * The three room panels of the stream view — chat, the agent transcript,
 * suggestions — in the order they appear. One list so the desktop tab strip,
 * the phone dock, and the sheet's title bar can never drift apart.
 */
import { Bot, Lightbulb, MessageSquare } from 'lucide-react';

export const PANELS = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'agent', label: 'Agent', icon: Bot },
  { key: 'suggestions', label: 'Suggestions', icon: Lightbulb },
] as const;

export type PanelKey = (typeof PANELS)[number]['key'];

/** The keys alone, for parsing the panel out of the URL. */
export const PANEL_KEYS = PANELS.map((panel) => panel.key);

/** The panel a game opens on when the URL does not say otherwise. */
export const DEFAULT_PANEL: PanelKey = 'chat';

/**
 * Whether the phone's room sheet is over the game. Desktop ignores it — the
 * panel is always in the layout there — so a game opens on the game.
 */
export const ROOM_MODES = ['open', 'closed'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];
export const DEFAULT_ROOM: RoomMode = 'closed';
