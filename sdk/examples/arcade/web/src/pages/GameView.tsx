/**
 * The stream view: game iframe on the left (the agent's dev-mode daemon),
 * agent chat + suggestions on the right — Twitch, but the streamer is a
 * Reflex agent.
 *
 * The panel is a column beside the game on desktop and a sheet over it on
 * phones, where the game owns the screen and the dock opens the room. Both
 * are the same markup at two breakpoints, so nothing remounts on rotate.
 *
 * The panel runs the real Reflex SDK (`ReflexProvider`, `ChatPane`) pointed
 * at this app's per-game proxy: the arcade login token goes in as the "API
 * key" and the server swaps in the owner's real credentials. Owners get the
 * full chat pane; viewers get the read-only variant.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ReflexProvider } from '../lib/reflex/reflex-provider.tsx';
import { ChatPane } from '../components/reflex/chat-pane.tsx';
import { arcade, gameArtUrl, getToken, type Game } from '../lib/api.ts';
import { framePlayer, gameFrameUrl } from '../lib/game-frame.ts';
import { useSession } from '../lib/session.ts';
import { stageDensity } from '../lib/stage-density.ts';
import { urlParam, useUrlPatch, useUrlState } from '../lib/useUrlState.ts';
import { agentChip } from '../lib/agent-status.ts';
import {
  ArrowLeft,
  Bot,
  Crown,
  Eye,
  History,
  Lightbulb,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  X,
} from 'lucide-react';
import { WibblingSpinner } from 'performative-ui';
import type { AgentTimelineDisplayItem } from '../lib/reflex/event-utils.ts';
import { useArcadeFrames, useArcadeReconnect, useWatchGame } from '../lib/socket.tsx';
import { Tip } from '../components/Tip.tsx';
import { UserRef } from '../components/UserRef.tsx';
import { StatusPill } from '../components/StatusPill.tsx';
import { SuggestionsPanel } from '../components/SuggestionsPanel.tsx';
import { GameChatPanel } from '../components/GameChatPanel.tsx';
import { PanelDock } from '../components/PanelDock.tsx';
import { ShareButton } from '../components/ShareButton.tsx';
import {
  DEFAULT_PANEL,
  DEFAULT_ROOM,
  PANEL_KEYS,
  PANELS,
  ROOM_MODES,
  type PanelKey,
  type RoomMode,
} from '../lib/panels.ts';

/**
 * Dispatched suggestions arrive in the transcript as big prompt walls;
 * render them as a compact card instead — who asked, what they asked for.
 */
const SUGGESTION_PROMPT_RE =
  /^Player suggestion from (.+?) \(top of the room's queue\):\n\n([\s\S]*?)(?:\n\nNote from the game owner: ([\s\S]*?))?\n\nImplement this suggestion now/;

function DispatchedSuggestion({
  author,
  body,
  note,
}: {
  author: string;
  body: string;
  note?: string;
}) {
  return (
    <div className="flex w-full justify-end">
      <div className="max-w-[85%] min-w-0 rounded-2xl rounded-br-sm border border-violet-500/40 bg-violet-500/10 px-3.5 py-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest text-violet-300 uppercase">
          <Lightbulb size={11} aria-hidden /> Suggestion
        </p>
        <p className="mt-1.5 text-sm [overflow-wrap:anywhere] break-words whitespace-pre-wrap text-zinc-100">
          {body}
        </p>
        {note ? (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-400/10 px-2 py-1.5 text-xs text-amber-100/90">
            <Crown
              size={11}
              strokeWidth={2.5}
              aria-hidden
              className="mt-0.5 shrink-0 text-amber-300"
            />
            <span className="min-w-0 break-words">{note}</span>
          </p>
        ) : null}
        <p className="mt-1.5 text-[10px] text-zinc-500">
          suggested by <span className="font-medium text-zinc-400">{author}</span>, sent to the
          agent from the room&rsquo;s queue
        </p>
      </div>
    </div>
  );
}

/** Custom transcript rendering: suggestion dispatches become cards. */
function renderArcadeItem(item: AgentTimelineDisplayItem): React.ReactNode | undefined {
  if (item.kind === 'user') {
    const match = SUGGESTION_PROMPT_RE.exec(item.text);
    if (match) return <DispatchedSuggestion author={match[1]!} body={match[2]!} note={match[3]} />;
  }
  return undefined;
}

function BuildingPlaceholder({ game }: { game: Game }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <WibblingSpinner className="text-lg text-violet-300" />
      <p className="font-medium">
        {game.status === 'error'
          ? 'The agent hit an error.'
          : game.status === 'stopped'
            ? 'This game is stopped.'
            : 'The agent is building this game...'}
      </p>
      <p className="max-w-sm text-sm text-zinc-500">
        {game.status === 'creating'
          ? 'The dev server appears here the moment the agent registers its daemon. Watch the agent chat to follow along.'
          : game.agentStatus
            ? `Agent status: ${game.agentStatus}`
            : ''}
      </p>
    </div>
  );
}

// Thumb-sized on touch, except on a landscape phone: a 44px control in a
// 342px-tall screen is a row of the game, and `short:` outranks
// `pointer-coarse:` because it is registered after it.
const ICON_BUTTON =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 pointer-coarse:h-11 pointer-coarse:w-11 short:h-9 short:w-9';

export function GameView() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { me } = useSession();
  const [game, setGame] = useState<Game | null>(null);
  const [role, setRole] = useState<'owner' | 'viewer'>('viewer');
  const [error, setError] = useState<string | null>(null);
  // In the URL: a refresh, a Back, or a pasted link all land on the tab you
  // were actually reading instead of dropping you back into chat.
  const [tab, setTab] = useUrlState('tab', PANEL_KEYS, DEFAULT_PANEL);
  const [viewers, setViewers] = useState(0);
  /**
   * Below `lg` the panel is a sheet over the game rather than a column
   * beside it, and it starts closed — you opened a game to play it. Desktop
   * never reads this: there the panel is always in the layout and `tab`
   * alone decides what it shows. In the URL for the same reason as the tab:
   * refreshing while reading the room should not hand you back the game.
   */
  const [room, setRoom] = useUrlState('room', ROOM_MODES, DEFAULT_ROOM);
  const sheetOpen = room === 'open';
  /**
   * What arrived while a panel was behind the dock, for its badge. Tagged
   * with the game it was counted in, so walking straight from one stream to
   * another starts the badges over without an effect to reset them.
   */
  const [unread, setUnread] = useState<{
    room: string | undefined;
    counts: Partial<Record<PanelKey, number>>;
  }>({ room: gameId, counts: {} });
  const countsForRoom = (old: typeof unread) => (old.room === gameId ? old.counts : {});
  // The whole panel collapses to give the game the full stage.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('reflex-arcade:sidebarCollapsed') === '1',
  );
  const toggleCollapsed = () => {
    setCollapsed((old) => {
      localStorage.setItem('reflex-arcade:sidebarCollapsed', old ? '' : '1');
      return !old;
    });
  };
  // Sidebar width is draggable and remembered across sessions.
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const stored = Number(localStorage.getItem('reflex-arcade:sidebarWidth'));
    return Number.isFinite(stored) && stored >= 280 && stored <= 720 ? stored : 384;
  });
  const dragging = useRef(false);
  // The stage's own width drives its header density — see `stageDensity`.
  // A callback ref, not an effect on mount: this component returns early
  // while the game loads, so the stage does not exist yet when a mount
  // effect would run, and an observer attached then would watch nothing.
  const [stageWidth, setStageWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect();
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageWidth(entry.contentRect.width);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  const density = stageDensity(stageWidth);

  /**
   * Open a panel over the game; tapping the open one hands the game back.
   * Panel and room move in one navigation — two `useUrlState` setters in one
   * handler would leave the second one's write on top of a stale URL.
   */
  const patchUrl = useUrlPatch();
  const selectPanel = (panel: PanelKey) => {
    const open = !(sheetOpen && tab === panel);
    patchUrl({
      tab: urlParam(panel, DEFAULT_PANEL),
      room: urlParam<RoomMode>(open ? 'open' : 'closed', DEFAULT_ROOM),
    });
    setUnread((old) => ({ room: gameId, counts: { ...countsForRoom(old), [panel]: 0 } }));
  };
  const closeSheet = useCallback(() => setRoom('closed'), [setRoom]);

  // Escape leaves the sheet, the same way it leaves every other overlay here.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, closeSheet]);

  // Announce presence for the viewer count (and the play counter).
  useWatchGame(gameId ?? null);

  const onDividerPointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    dragging.current = true;
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const width = Math.min(720, Math.max(280, window.innerWidth - e.clientX));
      setSidebarWidth(width);
    };
    const onUp = () => {
      dragging.current = false;
      setSidebarWidth((width) => {
        localStorage.setItem('reflex-arcade:sidebarWidth', String(width));
        return width;
      });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  useEffect(() => {
    if (!gameId) return;
    arcade
      .getGame(gameId)
      .then(({ game, role }) => {
        setGame(game);
        setRole(role);
        setViewers(game.viewers);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the game.'));
  }, [gameId]);

  useArcadeFrames((frame) => {
    if (frame.type === 'game' && frame.game.id === gameId) setGame(frame.game);
    if (frame.type === 'game.removed' && frame.gameId === gameId) navigate('/', { replace: true });
    if (frame.type === 'viewers' && frame.gameId === gameId) setViewers(frame.count);
    // A closed sheet is the only place the room can go unseen; badge it.
    const arrival: PanelKey | null =
      frame.type === 'chat.message' && frame.message.gameId === gameId
        ? 'chat'
        : frame.type === 'suggestion' && frame.suggestion.gameId === gameId
          ? 'suggestions'
          : null;
    if (arrival && !(sheetOpen && tab === arrival)) {
      setUnread((old) => {
        const counts = countsForRoom(old);
        return { room: gameId, counts: { ...counts, [arrival]: (counts[arrival] ?? 0) + 1 } };
      });
    }
  });

  // Hub frames are the primary update path; this reconcile covers frames
  // missed while the socket reconnects (tab in background, tunnel hiccups).
  // It refetches on focus, plus every 15s only while the game is still
  // being built — real devbox provisioning takes minutes and the initial
  // load happens long before the daemon URL exists.
  const refetchGame = useCallback(() => {
    if (!gameId) return;
    void arcade
      .getGame(gameId)
      .then(({ game }) => setGame(game))
      .catch(() => {
        // Transient failures are fine; the next tick retries.
      });
  }, [gameId]);

  // A focused tab whose socket dropped got no focus event and, once the
  // game was past `creating`, no interval either — so agent status froze at
  // whatever it was when the socket died. Reconnect is the signal that
  // frames were missed.
  useArcadeReconnect(refetchGame);

  useEffect(() => {
    if (!gameId) return;
    const onFocus = () => refetchGame();
    window.addEventListener('focus', onFocus);
    const interval = game?.status === 'creating' ? setInterval(refetchGame, 15_000) : null;
    return () => {
      window.removeEventListener('focus', onFocus);
      if (interval) clearInterval(interval);
    };
  }, [gameId, game?.status, refetchGame]);

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-sm text-zinc-400">
        {error}
      </main>
    );
  }
  if (!game || !gameId) {
    return <main className="flex-1 p-8 text-sm text-zinc-500">Loading game...</main>;
  }

  const isOwner = role === 'owner';
  const token = getToken() ?? '';
  // The game is told who is playing, so it never has to ask for a name.
  const frameUrl = game.daemonUrl
    ? gameFrameUrl(game.daemonUrl, framePlayer(me, window.location.origin, isOwner))
    : null;
  const agent = agentChip(game.agentStatus);
  const icon = gameArtUrl(game, 'icon');
  const activePanel = PANELS.find((panel) => panel.key === tab)!;
  const ActivePanelIcon = activePanel.icon;
  const tabClass = (active: boolean) =>
    `flex min-h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-500/70 ${
      active
        ? 'bg-white/10 text-white shadow-md shadow-black/30'
        : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
    }`;

  return (
    // Viewport-locked (not flex-1): inside the shell's min-h-dvh column a
    // flex-grown child stretches with its content, which would defeat the
    // fixed height and let the transcript scroll the whole page. Phones get
    // the whole viewport because the app nav hides itself on this route;
    // desktop keeps its padding + gaps, floating stage and panel as cards.
    <main className="flex h-[100dvh] min-h-0 flex-col overflow-hidden lg:h-[calc(100dvh-3.5rem)] lg:flex-row lg:gap-2 lg:p-3">
      {/* The stage's stacking context on phones, where the panel is a sheet
          over it. At `lg` the wrapper stops being a box at all, so stage,
          divider, and panel become the flex row this view has always been. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 lg:contents">
        {/* Stage: full-bleed on a phone, a floating card on desktop. */}
        <section
          ref={stageRef}
          className="flex min-w-0 flex-1 flex-col overflow-hidden border-white/10 bg-zinc-950/70 backdrop-blur-sm lg:rounded-2xl lg:border"
        >
          {/* The phone runs this view edge to edge under the notch, so the
              row that touches it pads itself back out with the real insets;
              at `lg` the app shell is back and `px-4` is enough. */}
          <header className="flex items-center gap-2 border-b border-white/5 px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 max-lg:safe-x sm:gap-3 sm:px-4">
            {/* The phone has no app nav on this route — the way back out of
                a game is here, where a thumb expects it. */}
            <Link to="/" aria-label="Back to games" className={`${ICON_BUTTON} lg:hidden`}>
              <ArrowLeft size={18} aria-hidden />
            </Link>
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              {icon ? (
                <img src={icon} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
              ) : null}
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-sm font-semibold">{game.title}</h1>
                  <StatusPill status={game.status} />
                </div>
                <p
                  className={`mt-0.5 min-w-0 items-center gap-1 truncate text-xs text-zinc-500 ${
                    density.meta ? 'flex' : 'hidden'
                  }`}
                >
                  by <UserRef userId={game.ownerId} name={game.ownerName} isOwner avatarSize={13} />
                  {game.agentType ? <span className="shrink-0">· {game.agentType}</span> : null}
                  {game.model ? <span className="truncate">· {game.model}</span> : null}
                </p>
              </div>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <Tip label={`${viewers} watching now`}>
                <span
                  className={`items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-300 ${
                    density.viewers ? 'flex' : 'hidden'
                  }`}
                >
                  <Eye size={12} aria-hidden /> {viewers}
                </span>
              </Tip>
              {game.isPublic ? (
                <ShareButton
                  url={`${location.origin}/g/${game.id}`}
                  title={game.title}
                  className={density.timeline ? 'flex' : 'hidden'}
                />
              ) : null}
              <Tip label="Timeline — the ask, every prompt, every suggestion">
                <Link
                  to={`/g/${gameId}/timeline`}
                  aria-label="Game timeline"
                  className={`h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 pointer-coarse:h-10 pointer-coarse:w-10 ${
                    density.timeline ? 'flex' : 'hidden'
                  }`}
                >
                  <History size={14} aria-hidden />
                </Link>
              </Tip>
              {isOwner && collapsed ? (
                <Tip label="Game settings">
                  <Link
                    to={`/g/${gameId}/settings`}
                    aria-label="Game settings"
                    className="hidden h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 lg:flex"
                  >
                    <Settings2 size={14} aria-hidden />
                  </Link>
                </Tip>
              ) : null}
              {frameUrl ? (
                <a
                  href={frameUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`items-center rounded-lg border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/5 pointer-coarse:min-h-10 ${
                    density.openGame ? 'flex' : 'hidden'
                  }`}
                >
                  Open game ↗
                </a>
              ) : null}
              {collapsed ? (
                <Tip label="Show the panel">
                  <button
                    type="button"
                    aria-label="Show the panel"
                    onClick={toggleCollapsed}
                    className="hidden h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-zinc-400 hover:bg-white/5 hover:text-zinc-100 lg:flex"
                  >
                    <PanelRightOpen size={14} aria-hidden />
                  </button>
                </Tip>
              ) : null}
            </div>
          </header>
          <div className="touch-stage min-h-0 flex-1 bg-black/70">
            {frameUrl ? (
              <iframe
                src={frameUrl}
                title={game.title}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
              />
            ) : (
              <BuildingPlaceholder game={game} />
            )}
          </div>
        </section>

        {/* Drag to resize the sidebar / stage split. */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={onDividerPointerDown}
          className={`hidden w-1 shrink-0 cursor-col-resize rounded-full bg-transparent transition-colors hover:bg-violet-600/60 active:bg-violet-500 ${
            collapsed ? '' : 'lg:block'
          }`}
        />

        {/* Panel: room chat, agent transcript, suggestions. A sheet over the
            game below `lg`, a column beside it above — one tree either way,
            so the transcript survives a rotate. Collapsing is a desktop
            preference applied in CSS: a phone that inherited `collapsed`
            from localStorage must still get the room. */}
        <aside
          id="game-panel"
          className={`min-h-0 flex-col gap-2 lg:flex lg:w-[var(--sidebar-w)] lg:flex-none lg:shrink-0 ${
            sheetOpen
              ? 'max-lg:absolute max-lg:inset-0 max-lg:z-30 max-lg:flex max-lg:bg-zinc-950/95 max-lg:py-2 max-lg:safe-x max-lg:backdrop-blur-xl'
              : 'max-lg:hidden'
          } ${collapsed ? 'lg:hidden' : ''}`}
          style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` }}
        >
          {/* Phone: the room is a screen of its own, so it gets a title bar
              — and the game-level controls the narrow stage header drops. */}
          <div className="flex items-center gap-1 rounded-2xl bg-zinc-900/70 p-1 pl-3 shadow-xl shadow-black/50 backdrop-blur-xl lg:hidden">
            <ActivePanelIcon size={15} aria-hidden className="shrink-0 text-violet-300" />
            <span className="truncate text-sm font-semibold">{activePanel.label}</span>
            <Link
              to={`/g/${gameId}/timeline`}
              aria-label="Game timeline"
              className={`${ICON_BUTTON} ml-auto`}
            >
              <History size={16} aria-hidden />
            </Link>
            {isOwner ? (
              <Link to={`/g/${gameId}/settings`} aria-label="Game settings" className={ICON_BUTTON}>
                <Settings2 size={16} aria-hidden />
              </Link>
            ) : null}
            <button
              type="button"
              aria-label="Close the room"
              onClick={closeSheet}
              className={ICON_BUTTON}
            >
              <X size={18} aria-hidden />
            </button>
          </div>

          {/* Desktop: tabs swap the panel in place. */}
          <div className="hidden items-center gap-1 rounded-2xl bg-zinc-900/70 p-1 shadow-xl shadow-black/50 backdrop-blur-xl lg:flex">
            {PANELS.map((panel) => {
              const Icon = panel.icon;
              return (
                <button
                  key={panel.key}
                  type="button"
                  className={tabClass(tab === panel.key)}
                  onClick={() => setTab(panel.key)}
                >
                  <Icon size={13} aria-hidden className="shrink-0 opacity-80" />
                  <span className="truncate">{panel.label}</span>
                </button>
              );
            })}
            {isOwner ? (
              <Tip label="Game settings">
                <Link
                  to={`/g/${gameId}/settings`}
                  aria-label="Game settings"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                >
                  <Settings2 size={14} aria-hidden />
                </Link>
              </Tip>
            ) : null}
            <Tip label="Hide the panel">
              <button
                type="button"
                aria-label="Hide the panel"
                onClick={toggleCollapsed}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              >
                <PanelRightClose size={14} aria-hidden />
              </button>
            </Tip>
          </div>

          <div className="min-h-0 flex-1">
            {tab === 'chat' ? (
              <GameChatPanel gameId={gameId} ownerId={game.ownerId} />
            ) : tab === 'agent' ? (
              <ReflexProvider baseUrl={`${window.location.origin}/reflex/${gameId}`} apiKey={token}>
                <ChatPane
                  agentId={game.agentId}
                  readOnly={!isOwner}
                  status={game.agentStatus}
                  renderItem={renderArcadeItem}
                  header={
                    agent ? (
                      <div
                        className={`mx-1 mt-1 flex w-fit items-center gap-1.5 rounded-full bg-zinc-900/70 px-3.5 py-1.5 text-xs shadow-lg shadow-black/40 backdrop-blur-xl ${agent.className}`}
                      >
                        <Bot size={13} aria-hidden className={agent.pulse ? 'animate-pulse' : ''} />
                        Agent {agent.label}
                      </div>
                    ) : null
                  }
                />
              </ReflexProvider>
            ) : (
              <SuggestionsPanel
                gameId={gameId}
                isOwner={isOwner}
                autoApprove={game.autoApprove}
                agentStatus={game.agentStatus}
                currentTask={game.currentTask}
                currentTaskKind={game.currentTaskKind}
                gameTitle={game.title}
                shareable={game.isPublic}
              />
            )}
          </div>
        </aside>
      </div>

      <PanelDock
        active={sheetOpen ? tab : null}
        unread={countsForRoom(unread)}
        onSelect={selectPanel}
        className="lg:hidden"
      />
    </main>
  );
}
