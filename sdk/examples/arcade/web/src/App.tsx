/**
 * App shell: top nav, routes, and the join gate (name -> localStorage key,
 * no logout). The current player is shared through SessionContext.
 *
 * Browsing is public. `/` and `/about` render signed out — the arcade's
 * shop window is the point, so a visitor sees the live shelf before picking
 * a name — and the gate goes up only on the routes that need an account
 * (opening a game, your own shelf, creating one, profiles).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { arcade, clearToken, getToken, setToken, type Me } from './lib/api.ts';
import { SessionContext, type Session } from './lib/session.ts';
import { arrivalSource } from './lib/referral.ts';
import { ArcadeSocketProvider } from './lib/socket.tsx';
import { Landing } from './pages/Landing.tsx';
import { MyGames } from './pages/MyGames.tsx';
import { NewGame } from './pages/NewGame.tsx';
import { GameView } from './pages/GameView.tsx';
import { GameSettings } from './pages/GameSettings.tsx';
import { GameTimeline } from './pages/GameTimeline.tsx';
import { About } from './pages/About.tsx';
import { Profile } from './pages/Profile.tsx';
import { AsciiHero, Aurora, Button, GradientText, Sparkle } from 'performative-ui';
import { Gamepad2, Info, Library, Plus } from 'lucide-react';
import { ProfileModal } from './components/ProfileModal.tsx';
import { Avatar } from './components/Avatar.tsx';
import { Tip } from './components/Tip.tsx';

function JoinScreen({ onJoined, reason }: { onJoined: (me: Me) => void; reason?: string }) {
  const [name, setName] = useState('');
  const [existingKey, setExistingKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await arcade.join(name, arrivalSource());
      setToken(token);
      onJoined(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Joining failed.');
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await arcade.login(existingKey.trim());
      setToken(token);
      onJoined(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That key did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    // The shell paints the aurora and the nav around this now: the join
    // screen is a gated route, not a screen that replaces the whole app.
    <main className="relative flex min-h-[70dvh] flex-1 items-center justify-center overflow-hidden p-6">
      {/* Inline position: pui's unlayered `.pui-ascii { position: relative }`
          beats Tailwind v4's layered `absolute`. Painted after the aurora and
          before the card, so DOM order keeps it sandwiched between them. */}
      <AsciiHero
        aria-hidden
        variant="bare"
        colorful
        reactive
        baseOpacity={0.1}
        spotlightOpacity={0.7}
        spotlightRadius={12}
        style={{ position: 'absolute', inset: 0 }}
      />
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-950/80 p-8 shadow-2xl shadow-violet-950/40 backdrop-blur-xl">
        <h1 className="text-2xl font-bold tracking-tight">
          Reflex <GradientText>Arcade</GradientText> <Sparkle />
        </h1>
        {reason ? <p className="mt-2 text-sm text-zinc-200">{reason}</p> : null}
        <p className="mt-2 text-sm text-zinc-400">
          Pick a name to get your player key — it is stored in this browser and is the only way back
          into your account, so keep it safe.
        </p>
        <form
          className="mt-6 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void join();
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={40}
            className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
          <Button type="submit" variant="glow" disabled={busy || !name.trim()} loading={busy}>
            Join
          </Button>
        </form>
        <details className="mt-4 text-sm text-zinc-400">
          <summary className="cursor-pointer select-none">Already have a player key?</summary>
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (existingKey.trim()) void login();
            }}
          >
            <input
              value={existingKey}
              onChange={(e) => setExistingKey(e.target.value)}
              placeholder="ark_..."
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-violet-500"
            />
            <button
              type="submit"
              disabled={busy || !existingKey.trim()}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              Sign in
            </button>
          </form>
        </details>
        {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
      </div>
    </main>
  );
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  `relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:min-h-11 ${
    isActive
      ? 'bg-white/[0.07] text-white after:absolute after:inset-x-3 after:-bottom-[7px] after:h-px after:rounded-full after:bg-gradient-to-r after:from-violet-500 after:to-fuchsia-500'
      : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
  }`;

export default function App() {
  const { pathname } = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  // Only worth blocking the first paint when a stored token needs validating.
  const [checking, setChecking] = useState(() => Boolean(getToken()));
  const [editingProfile, setEditingProfile] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    arcade
      .me()
      .then(({ user }) => setMe(user))
      .catch(() => {
        // Token no longer valid (e.g. server data reset) — drop it and
        // browse as a visitor. Keeping it would leave the hub socket
        // dialing a credential the server 401s, reconnecting forever.
        clearToken();
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) return null;

  const session: Session | null = me
    ? {
        me,
        refresh: async () => {
          const { user } = await arcade.me();
          setMe(user);
        },
      }
    : null;

  // The stream view is a full-width theater: on desktop the nav follows it
  // out to the edges (aligned with the stage card's padding) instead of
  // staying in the centered column every other page uses; on a phone it
  // steps aside entirely and the view takes the viewport. Only when the
  // stage is actually there: signed out that route is the join screen, and
  // hiding the nav on a phone would strand a shared link with no way out.
  const theater = Boolean(me) && /^\/g\/[^/]+$/.test(pathname);

  // Routes that need an account show the join screen in place of the page,
  // saying what the name is for rather than dumping the visitor on `/`.
  const gate = (reason: string, element: ReactNode) =>
    me ? element : <JoinScreen onJoined={setMe} reason={reason} />;

  return (
    <SessionContext.Provider value={session}>
      {/* Keyed by player: joining mid-browse remounts the hub socket so it
          reconnects with the token and starts receiving private frames. */}
      <ArcadeSocketProvider key={me?.id ?? 'anonymous'}>
        {/* `dvh`, never `vh`: on iOS `100vh` is the LARGE viewport, which
            pretends the browser toolbars are not there. The stream view
            sizes itself to `100dvh`, so a `100vh` shell around it is taller
            than the screen by exactly the toolbar height — a strip of empty
            aurora below the dock that a thumb can scroll up into. */}
        <div className="relative flex min-h-dvh flex-col">
          {/* Inline position: pui's unlayered `.pui-aurora { position: absolute;
              inset: -20% }` beats Tailwind's layered `fixed inset-0` and would
              otherwise stretch the document past the footer. */}
          <Aurora
            aria-hidden
            className="pointer-events-none opacity-40"
            style={{ position: 'fixed', inset: 0 }}
            blobs={[
              { color: '#7c3aed', x: 15, y: 10, size: 55 },
              { color: '#db2777', x: 85, y: 20, size: 45 },
              { color: '#0ea5e9', x: 55, y: 95, size: 50 },
            ]}
          />
          {/* Near-opaque so content scrolling beneath never ghosts through.
              On a phone the stream view is a screen of its own — the app nav
              stands down so the game gets the height, and the stage header's
              back arrow is the way out. */}
          <header
            className={`sticky top-0 z-20 border-b border-white/5 bg-zinc-950/95 backdrop-blur-xl ${
              theater ? 'max-lg:hidden' : ''
            }`}
          >
            <div
              // One row on phones: wrapping pushed the avatar onto a second
              // line and ate a third of a small screen before any content.
              className={`flex min-h-14 items-center gap-x-2 py-1.5 sm:gap-x-4 ${
                theater ? 'px-3' : 'mx-auto max-w-7xl px-3 sm:px-4'
              }`}
            >
              <Link
                to="/"
                className="flex items-center gap-2 text-base font-bold tracking-tight pointer-coarse:min-h-11"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-900/50">
                  <Gamepad2 size={15} aria-hidden />
                </span>
                <span className="hidden xs:inline">
                  Reflex <GradientText>Arcade</GradientText>
                </span>
              </Link>
              <nav className="flex min-w-0 items-center gap-0.5 sm:gap-1">
                <NavLink to="/" end className={navLink}>
                  <Gamepad2 size={15} aria-hidden className="opacity-80" />
                  <span className="hidden sm:inline">Games</span>
                </NavLink>
                {me ? (
                  <NavLink to="/mine" className={navLink}>
                    <Library size={15} aria-hidden className="opacity-80" />
                    <span className="hidden sm:inline">My games</span>
                  </NavLink>
                ) : null}
                <NavLink to="/about" className={navLink}>
                  <Info size={15} aria-hidden className="opacity-80" />
                  <span className="hidden sm:inline">About</span>
                </NavLink>
                <NavLink
                  to="/games/new"
                  aria-label="New game"
                  className="ml-0.5 flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:brightness-110 sm:ml-1 sm:px-3.5 sm:py-1.5 pointer-coarse:min-h-11"
                >
                  <Plus size={15} aria-hidden />
                  <span className="hidden sm:inline">New game</span>
                </NavLink>
              </nav>
              <div className="ml-auto flex items-center">
                {me ? (
                  <Tip label="Profile & player key">
                    <button
                      type="button"
                      onClick={() => setEditingProfile(true)}
                      aria-label="Profile and player key"
                      className="flex items-center gap-2 rounded-full border border-zinc-800 p-1 text-sm text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 sm:py-1 sm:pr-3 sm:pl-1"
                    >
                      <Avatar userId={me.id} name={me.name} avatar={me.avatar} size={22} />
                      <span className="hidden max-w-32 truncate sm:inline">{me.name}</span>
                    </button>
                  </Tip>
                ) : (
                  <NavLink
                    to="/join"
                    className="rounded-full border border-zinc-800 px-3.5 py-1.5 text-sm font-medium text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 pointer-coarse:min-h-11"
                  >
                    Join
                  </NavLink>
                )}
              </div>
            </div>
          </header>
          <Routes>
            {/* Public: the shelf and the pitch need no account. */}
            <Route path="/" element={<Landing />} />
            <Route path="/about" element={<About />} />
            <Route
              path="/join"
              element={me ? <Navigate to="/" replace /> : <JoinScreen onJoined={setMe} />}
            />
            {/* Gated: everything that reads or writes as a player. */}
            <Route
              path="/mine"
              element={gate('Pick a name to keep a shelf of your own games.', <MyGames />)}
            />
            <Route
              path="/games/new"
              element={gate('Pick a name to create a game of your own.', <NewGame />)}
            />
            <Route
              path="/u/:userId"
              element={gate('Pick a name to see other players.', <Profile />)}
            />
            <Route
              path="/g/:gameId"
              element={gate('Pick a name to watch this game and suggest features.', <GameView />)}
            />
            <Route
              path="/g/:gameId/settings"
              element={gate('Pick a name to manage your games.', <GameSettings />)}
            />
            <Route
              path="/g/:gameId/timeline"
              element={gate("Pick a name to read this game's story.", <GameTimeline />)}
            />
          </Routes>
          {editingProfile ? <ProfileModal onClose={() => setEditingProfile(false)} /> : null}
        </div>
      </ArcadeSocketProvider>
    </SessionContext.Provider>
  );
}
