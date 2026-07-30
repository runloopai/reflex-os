/**
 * One game tile: a dim neon cover (hue derived from the game id) with a
 * status chip, agent-state chip, live-viewer overlay, and a shine sweep on
 * hover, then title, idea, owner, and play count. Rows line up across the
 * grid regardless of text length: the title keeps one line, the idea keeps
 * exactly two, and the meta row pins to the bottom. Shared by the Games and
 * My games pages; the visibility badge only makes sense where public and
 * private mix, so it's opt-in (`showVisibility`).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatusDot } from 'performative-ui';
import {
  ArrowUpRight,
  Bot,
  Eye,
  Gamepad2,
  Globe,
  Lock,
  PackageCheck,
  Settings2,
} from 'lucide-react';
import { gameArtUrl, type Game, type GameStatus } from '../lib/api.ts';
import { agentChip } from '../lib/agent-status.ts';
import { Tip } from './Tip.tsx';
import { UserRef } from './UserRef.tsx';

function hueFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

const COVER_STATUS: Record<GameStatus, { label: string; dot: string; className: string }> = {
  live: { label: 'LIVE', dot: '#f43f5e', className: 'text-rose-100' },
  creating: { label: 'BUILDING', dot: '#fbbf24', className: 'text-amber-100' },
  error: { label: 'ERROR', dot: '#f87171', className: 'text-rose-200' },
  stopped: { label: 'OFFLINE', dot: '#a1a1aa', className: 'text-zinc-300' },
};

export function GameCard({
  game,
  showVisibility = false,
  showSettings = false,
}: {
  game: Game;
  /** Show the public/private chip — useful only where the two mix. */
  showVisibility?: boolean;
  /** Shortcut to the game's settings — for the owner's own listings. */
  showSettings?: boolean;
}) {
  const navigate = useNavigate();
  const hue = hueFor(game.id);
  const hue2 = (hue + 80) % 360;
  const status = COVER_STATUS[game.status];
  const agent = agentChip(game.agentStatus);
  const preview = gameArtUrl(game, 'preview');
  const previewAnim = gameArtUrl(game, 'preview-anim');
  const icon = gameArtUrl(game, 'icon');
  // Hover intent: after a short delay the cover comes alive — the agent's
  // animated art immediately, and for live games the actual running game
  // (scaled down, inert) as a true "video" of it.
  const [hovering, setHovering] = useState(false);
  const [liveLoaded, setLiveLoaded] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (hoverTimer.current && clearTimeout(hoverTimer.current)), []);
  const startHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovering(true), 350);
  };
  const endHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHovering(false);
    setLiveLoaded(false);
  };
  const showLive = hovering && game.status === 'live' && Boolean(game.daemonUrl);
  return (
    <Link
      to={`/g/${game.id}`}
      onMouseEnter={startHover}
      onMouseLeave={endHover}
      className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/50 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-violet-400/40 hover:shadow-2xl hover:shadow-violet-950/40"
    >
      {/* Cover: muted neon corners + dot grid, zooming slightly on hover. */}
      <div aria-hidden className="relative h-28 overflow-hidden">
        <div
          className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.05]"
          style={{
            background: `radial-gradient(120% 140% at 14% 112%, hsl(${hue} 60% 32% / 0.5), transparent 55%), radial-gradient(130% 150% at 86% -22%, hsl(${hue2} 65% 38% / 0.4), transparent 52%), linear-gradient(165deg, #131020, #0a0812)`,
          }}
        >
          <span className="absolute inset-0 [background-image:radial-gradient(rgba(255,255,255,0.55)_1px,transparent_1.3px)] [mask-image:linear-gradient(to_bottom,black,transparent)] [background-size:16px_16px] opacity-[0.12]" />
          {preview ? (
            /* Agent-drawn cover; the gradient stays behind as the loading fill. */
            <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute bottom-1.5 left-3 text-3xl font-black tracking-tight text-white/15 select-none">
              {game.title.slice(0, 2).toUpperCase()}
            </span>
          )}
          {hovering && previewAnim ? (
            /* The agent's looping animated cover takes over on hover. */
            <img src={previewAnim} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
        </div>
        {showLive ? (
          /* The real game, playing live inside the tile. Inert (no pointer
             events) and rendered at half scale so more of it fits. */
          <span className="absolute inset-0 overflow-hidden" aria-hidden>
            <iframe
              src={game.daemonUrl!}
              title=""
              tabIndex={-1}
              sandbox="allow-scripts allow-same-origin"
              onLoad={() => setLiveLoaded(true)}
              className={`pointer-events-none h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-black transition-opacity duration-500 ${liveLoaded ? 'opacity-100' : 'opacity-0'}`}
            />
          </span>
        ) : null}
        {/* Shine sweep across the cover on hover. */}
        <span className="absolute inset-y-[-40%] left-[-60%] w-1/3 rotate-12 bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-[440%]" />
        <span
          className={`absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold tracking-widest backdrop-blur ${status.className} ${game.status === 'creating' ? 'animate-pulse' : ''}`}
        >
          <StatusDot color={status.dot} static={game.status !== 'live'} /> {status.label}
        </span>
        {game.viewers > 0 ? (
          <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-emerald-300 backdrop-blur">
            <Eye size={12} aria-hidden /> {game.viewers}
          </span>
        ) : null}
        {agent ? (
          <span
            className={`absolute right-2 bottom-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium backdrop-blur ${agent.className}`}
          >
            <Bot size={12} aria-hidden className={agent.pulse ? 'animate-pulse' : ''} />
            {agent.label}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center gap-2">
          {icon ? (
            <img src={icon} alt="" className="h-5 w-5 shrink-0 rounded-md object-cover" />
          ) : null}
          <h3 className="min-w-0 truncate font-semibold transition-colors group-hover:text-violet-300">
            {game.title}
          </h3>
          <ArrowUpRight
            size={15}
            aria-hidden
            className="ml-auto shrink-0 -translate-x-1 text-violet-300 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100"
          />
        </div>
        {/* Exactly two lines reserved so meta rows align across the grid. */}
        <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 text-zinc-400">{game.prompt}</p>
        <div className="mt-auto flex items-center gap-2 pt-4 text-xs text-zinc-500">
          <span className="flex min-w-0 items-center gap-1 truncate">
            by <UserRef userId={game.ownerId} name={game.ownerName} isOwner avatarSize={14} />
          </span>
          {showVisibility ? (
            game.isPublic ? (
              <Tip label="Public — anyone can watch and suggest">
                <span className="flex items-center gap-1 rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                  <Globe size={10} aria-hidden /> public
                </span>
              </Tip>
            ) : (
              <Tip label="Private — only you can see this game">
                <span className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
                  <Lock size={10} aria-hidden /> private
                </span>
              </Tip>
            )
          ) : null}
          {game.shippedCount ? (
            <Tip label={`${game.shippedCount} suggestions shipped by the agent`}>
              <span
                aria-label={`${game.shippedCount} suggestions shipped`}
                className="flex items-center gap-1 text-emerald-400/90"
              >
                <PackageCheck size={12} aria-hidden /> {game.shippedCount}
              </span>
            </Tip>
          ) : null}
          <Tip label={`${game.plays} plays`} className="ml-auto">
            <span className="flex items-center gap-1">
              <Gamepad2 size={12} aria-hidden /> {game.plays}
            </span>
          </Tip>
          {showSettings ? (
            <Tip label="Game settings">
              <button
                type="button"
                aria-label={`Settings for ${game.title}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/g/${game.id}/settings`);
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
              >
                <Settings2 size={12} aria-hidden />
              </button>
            </Tip>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
