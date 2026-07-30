/**
 * Game creation.
 *
 * The Reflex connection is a user-level setting: saved named keys, one
 * active, each bound to an organization. Connecting is the usual way to get
 * one — Reflex mints the key itself after the player approves the arcade
 * (see `lib/connect.ts`) — and pasting a personal key stays as a fallback,
 * with its organization picked from the orgs that key can act in (listed
 * live via `listOrganizations`). Game creation always launches under the
 * active key.
 *
 * Agent and model pickers are fed from `GET /api/reflex/catalog`, which the
 * arcade server assembles from the SDK's `getAgentModelSupport` — the same
 * catalog Reflex's own launch dialog reads, including which providers have
 * usable keys.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, EyebrowPill, GradientText, StatusDot } from 'performative-ui';
import { Cloud, Radio, Sparkles, Wrench } from 'lucide-react';
import { arcade, type Catalog, type CatalogAgent, type OrgOption } from '../lib/api.ts';
import { ConnectReflex, type ConnectPhase } from '../components/ConnectReflex.tsx';
import { ProviderKeyList } from '../components/ProviderKeyList.tsx';
import { browserConnectDeps, connectWithReflex } from '../lib/connect.ts';
import { groupProviderKeys, keepSelectableKey, resolveProvider } from '../lib/provider-keys.ts';
import { useSession } from '../lib/session.ts';

const inputClass =
  'rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm font-normal outline-none focus:border-violet-500';

function OrgPicker({
  keyId,
  organizations,
  onSaved,
}: {
  keyId: string;
  organizations: OrgOption[] | null;
  onSaved: () => void;
}) {
  const [orgs, setOrgs] = useState<OrgOption[] | null>(organizations);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (orgs) return;
    arcade
      .keyOrganizations(keyId)
      .then(({ organizations }) => setOrgs(organizations))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not list orgs.'));
  }, [keyId, orgs]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await arcade.setKeyOrg(keyId, choice);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving the organization failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-2">
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className={`${inputClass} flex-1`}
      >
        <option value="">
          {orgs ? 'Pick the organization this key acts in' : 'Loading organizations...'}
        </option>
        {(orgs ?? []).map((org) => (
          <option key={org.id} value={org.id}>
            {org.name} ({org.slug})
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={busy || !choice}
        onClick={() => void save()}
        className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold hover:bg-violet-500 disabled:opacity-50"
      >
        {busy ? 'Saving...' : 'Use org'}
      </button>
      {error ? <span className="text-xs text-rose-400">{error}</span> : null}
    </div>
  );
}

/** User-level Reflex connection: saved keys, active selection, org binding. */
function ConnectionCard() {
  const { me, refresh } = useSession();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Disconnect has its own slot: its failure ("this key runs 2 games")
  // belongs next to the key row, not inside the paste-a-key panel.
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  // Orgs returned when a key was just added, keyed by key id (saves a refetch).
  const [freshOrgs, setFreshOrgs] = useState<Record<string, OrgOption[]>>({});
  const [connectState, setConnectState] = useState<ConnectPhase>({ phase: 'idle' });
  const connectRun = useRef<AbortController | null>(null);

  const connectDeps = useMemo(
    () =>
      browserConnectDeps({
        start: () => arcade.startReflexConnect(),
        poll: (connectionId) => arcade.pollReflexConnect(connectionId),
        cancel: (connectionId) => arcade.cancelReflexConnect(connectionId),
      }),
    [],
  );

  // Leaving the page abandons the flow: the poll loop would otherwise keep
  // running against a component nobody is looking at.
  useEffect(() => () => connectRun.current?.abort(), []);

  const startConnect = () => {
    connectRun.current?.abort();
    const run = new AbortController();
    connectRun.current = run;
    setConnectState({ phase: 'starting' });
    // Only the newest run may write the phase. Starting again supersedes the
    // one before it, and its late answer must not drag the panel back to a
    // state the player has already moved on from. Cancelling does NOT
    // supersede, so the cancelled run still gets to clear the panel.
    const settle = (next: ConnectPhase) => {
      if (connectRun.current === run) setConnectState(next);
    };
    void connectWithReflex(
      connectDeps,
      (waiting) => settle({ phase: 'waiting', waiting }),
      run.signal,
    ).then(async (outcome) => {
      if (outcome.status === 'approved') {
        settle({ phase: 'idle' });
        await refresh();
        return;
      }
      settle(
        outcome.status === 'cancelled'
          ? { phase: 'idle' }
          : { phase: 'error', message: outcome.message },
      );
    });
  };

  const addKey = async () => {
    setBusy(true);
    setError(null);
    try {
      const { keyId, organizations } = await arcade.addReflexKey({
        name: name.trim(),
        apiKey: apiKey.trim(),
      });
      setFreshOrgs((old) => ({ ...old, [keyId]: organizations }));
      setName('');
      setApiKey('');
      setShowAdd(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving the key failed.');
    } finally {
      setBusy(false);
    }
  };

  const activate = async (keyId: string) => {
    await arcade.setActiveKey(keyId);
    await refresh();
  };

  const disconnect = async (keyId: string) => {
    // Guarded: a second DELETE lands as a 404 that would overwrite the
    // first one's success with an error.
    if (disconnecting) return;
    setDisconnecting(keyId);
    setDisconnectError(null);
    try {
      await arcade.deleteReflexKey(keyId);
      await refresh();
    } catch (err) {
      // The server refuses while games still run under the key; say so
      // rather than leaving the row looking stuck.
      setDisconnectError(err instanceof Error ? err.message : 'Disconnecting failed.');
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <fieldset>
      <p className="text-xs text-zinc-500">
        Games launch under your active key. Keys are stored on your player account, used only on the
        arcade server, and never shown to other players.
      </p>
      {me.keys.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {me.keys.map((key) => {
            const isActive = me.activeKeyId === key.id;
            return (
              <div
                key={key.id}
                className={`rounded-lg border px-3 py-2 ${
                  isActive ? 'border-violet-600 bg-violet-600/10' : 'border-zinc-800'
                }`}
              >
                <div className="flex items-center gap-2 text-sm">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="active-key"
                      checked={isActive}
                      onChange={() => void activate(key.id)}
                      className="accent-violet-500"
                    />
                    <span className="truncate font-medium">{key.name}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{key.preview}</span>
                    {key.org ? (
                      <span className="ml-auto shrink-0 text-xs text-zinc-500">org: {key.org}</span>
                    ) : (
                      <span className="ml-auto shrink-0 text-xs text-amber-400">
                        needs an organization
                      </span>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={() => void disconnect(key.id)}
                    disabled={disconnecting !== null}
                    aria-label={`Disconnect ${key.name}`}
                    className="shrink-0 text-xs text-zinc-500 hover:text-rose-400 disabled:opacity-50"
                  >
                    {disconnecting === key.id ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </div>
                {isActive && !key.org ? (
                  <OrgPicker
                    keyId={key.id}
                    organizations={freshOrgs[key.id] ?? null}
                    onSaved={() => void refresh()}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">
          No connection yet — connect Reflex to start agents under your account.
        </p>
      )}

      {disconnectError ? <p className="mt-2 text-xs text-rose-400">{disconnectError}</p> : null}

      {/* The full call-to-action is for the first connection only; after
          that it is one more account among the ones listed above. */}
      <ConnectReflex
        state={connectState}
        onConnect={startConnect}
        onCancel={() => connectRun.current?.abort()}
        compact={me.keys.length > 0}
      />

      {showAdd ? (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
          <p className="text-xs text-zinc-500">
            Already minted a personal API key in Reflex (profile &gt; API keys)? Paste it here
            instead. Its organizations are listed automatically after validation.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. work)"
              maxLength={60}
              className={inputClass}
            />
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="rfx_..."
              className={inputClass}
            />
          </div>
          {error ? <p className="mt-2 text-xs text-rose-400">{error}</p> : null}
          <button
            type="button"
            disabled={busy || !apiKey.trim()}
            onClick={() => void addKey()}
            className="mt-3 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? 'Checking key...' : 'Validate and save'}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="mt-2 text-xs text-zinc-500 hover:text-zinc-300"
        >
          Paste a key instead
        </button>
      )}
    </fieldset>
  );
}

function ModelPicker({
  agent,
  model,
  onChange,
}: {
  agent: CatalogAgent | null;
  model: string;
  onChange: (model: string) => void;
}) {
  if (!agent || agent.providers.length === 0) {
    return (
      <div>
        <input value="Agent default" disabled className={`mt-1 w-full ${inputClass} opacity-60`} />
        <span className="mt-1 block text-xs font-normal text-zinc-500">
          {agent ? 'This agent type picks its own model.' : 'Pick an agent first.'}
        </span>
      </div>
    );
  }
  return (
    <div>
      <select
        value={model}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1 w-full ${inputClass}`}
      >
        <option value="">
          Agent default{agent.defaultModel ? ` (${agent.defaultModel})` : ''}
        </option>
        {agent.providers.map((provider) => (
          <optgroup
            key={provider.id}
            label={`${provider.displayName}${provider.available ? '' : ' — no provider key'}`}
          >
            {provider.models.map((m) => (
              <option key={m.id} value={m.id} disabled={!provider.available}>
                {m.displayName}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="mt-1 block text-xs font-normal text-zinc-500">
        Providers without a usable key in the org are shown disabled.
      </span>
    </div>
  );
}

/** One numbered form section in the glass style. */
function Section({
  step,
  title,
  children,
}: {
  step: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 backdrop-blur-sm">
      <h2 className="flex items-baseline gap-2.5">
        <span className="text-xs font-black text-violet-400/70 tabular-nums">{step}</span>
        <span className="font-semibold">{title}</span>
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Tap-to-fill example briefs, for the blank-page moment. */
const SPARKS: Array<{ title: string; prompt: string }> = [
  {
    title: 'Comet Courier',
    prompt:
      'Deliver packages between drifting asteroids on a hoverbike. Momentum-based movement, a timer per delivery, and a combo meter for smooth landings.',
  },
  {
    title: 'Garden of Bugs',
    prompt:
      'A cozy garden where you collect and breed glowing beetles at night. Click to catch, drag to plant flowers that attract rarer species.',
  },
  {
    title: 'Turbo Toast',
    prompt:
      'A frantic kitchen racer: launch slices of toast across a breakfast table, bank shots off jam jars, land them butter-side up for points.',
  },
  {
    title: 'MMO Bomberman',
    prompt:
      'Multiplayer Bomberman: everyone who opens the page drops into one shared grid arena. Bombs, chain explosions, power-ups, fast respawns, and a live scoreboard of who is online.',
  },
  {
    title: 'MMO Snake',
    prompt:
      'Multiplayer snake in one shared world: every visitor steers their own glowing snake, eating pellets and each other, slither-style. Live leaderboard, instant respawns, names above snakes.',
  },
  {
    title: 'MMO Asteroids',
    prompt:
      'Multiplayer Asteroids in a single shared starfield: each player flies a ship, asteroids split when shot, friendly fire is on. Names above ships and a kill feed in the corner.',
  },
];

function hueFor(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

/** Live mock of the game tile this stream will get on the shelf. */
function PreviewTile({ title, prompt, name }: { title: string; prompt: string; name: string }) {
  const hue = hueFor(title || 'untitled');
  const hue2 = (hue + 80) % 360;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/50">
      <div aria-hidden className="relative h-24">
        <div
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 140% at 14% 112%, hsl(${hue} 60% 32% / 0.5), transparent 55%), radial-gradient(130% 150% at 86% -22%, hsl(${hue2} 65% 38% / 0.4), transparent 52%), linear-gradient(165deg, #131020, #0a0812)`,
          }}
        >
          <span className="absolute bottom-1.5 left-3 text-3xl font-black tracking-tight text-white/15 select-none">
            {(title || 'It').slice(0, 2).toUpperCase()}
          </span>
        </div>
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold tracking-widest text-amber-100 backdrop-blur">
          <StatusDot color="#fbbf24" static /> BUILDING
        </span>
      </div>
      <div className="p-4">
        <h3 className="truncate font-semibold">{title || 'Your game'}</h3>
        <p className="mt-1.5 line-clamp-2 min-h-10 text-sm leading-5 text-zinc-400">
          {prompt || 'The brief you write shows up here, on the shelf, for everyone browsing.'}
        </p>
        <p className="mt-3 text-xs text-zinc-500">by {name}</p>
      </div>
    </div>
  );
}

const NEXT_STEPS = [
  { icon: Cloud, text: 'The agent boots its own Runloop devbox.' },
  { icon: Wrench, text: 'It scaffolds TypeScript + Vite and starts building.' },
  {
    icon: Radio,
    text: 'The dev server streams into your game page — suggestions steer from there.',
  },
] as const;

export function NewGame() {
  const { me } = useSession();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agentType, setAgentType] = useState('');
  const [model, setModel] = useState('');
  // `null` means "let Reflex resolve it" — the default, and what every
  // launch did before this picker existed.
  const [providerKeyId, setProviderKeyId] = useState<string | null>(null);
  const [isPublic, setIsPublic] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);
  // Stamped with the key it was fetched under: switching (or disconnecting)
  // the active key changes org, and a catalog from the previous one lists
  // keys this launch cannot use.
  const [fetchedCatalog, setFetchedCatalog] = useState<{
    keyId: string | null;
    catalog: Catalog;
  } | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeKey = me.keys.find((key) => key.id === me.activeKeyId) ?? null;
  const connectionReady = Boolean(activeKey?.org);
  // The catalog is only meaningful behind a connected key+org, and only the
  // one it was fetched under; deriving both gates (instead of resetting
  // state in the effect) keeps renders pure and never shows another org's
  // keys during the refetch.
  const catalog =
    connectionReady && fetchedCatalog?.keyId === me.activeKeyId ? fetchedCatalog.catalog : null;

  // The launch catalog needs a connected key+org; refetch when that changes.
  useEffect(() => {
    if (!connectionReady) return;
    let cancelled = false;
    arcade
      .catalog()
      .then(({ catalog }) => {
        if (cancelled) return;
        setFetchedCatalog({ keyId: me.activeKeyId, catalog });
        setCatalogError(null);
        setAgentType(
          (current) => current || (catalog.defaultAgentType ?? catalog.agents[0]?.agentType ?? ''),
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalogError(err instanceof Error ? err.message : 'Could not load the catalog.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionReady, me.activeKeyId]);

  const selectedAgent = catalog?.agents.find((agent) => agent.agentType === agentType) ?? null;
  // The provider that will actually serve this launch, and the keys behind it.
  const selectedProvider = resolveProvider(selectedAgent, model);
  const keyGroups =
    selectedProvider && catalog?.keys ? groupProviderKeys(catalog.keys, selectedProvider) : [];
  // Derived, not stored: changing agent or model can move the launch to a
  // provider the pinned key cannot serve, and a stale pin would launch under
  // the wrong account. Reading it through the guard keeps the render pure.
  const activeProviderKeyId = keepSelectableKey(providerKeyId, keyGroups);
  const canCreate = Boolean(title.trim() && prompt.trim() && connectionReady && agentType);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { game } = await arcade.createGame({
        title,
        prompt,
        agentType,
        model: model || null,
        providerKeyId: activeProviderKeyId,
        isPublic,
        autoApprove,
      });
      navigate(`/g/${game.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Creating the game failed.');
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
      <EyebrowPill statusColor="#a78bfa">Start a stream</EyebrowPill>
      <h1 className="mt-4 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
        Give an agent <GradientText>a game to build</GradientText>
      </h1>
      <p className="mt-3 max-w-xl text-zinc-400">
        Describe it once. A Reflex agent boots its own devbox, builds it with Vite, and streams
        every step live — while the room steers with suggestions and hearts.
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) void create();
          }}
        >
          <Section step="01" title="The concept">
            <label className="block text-sm font-medium">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={60}
                placeholder="Asteroid Gardener"
                className={`mt-1 w-full ${inputClass}`}
              />
            </label>
            <label className="mt-4 block text-sm font-medium">
              Game idea
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={2000}
                rows={4}
                placeholder="A cozy browser game where you grow plants on drifting asteroids. Arrow keys to hop between rocks, water drops fall from comets..."
                className={`mt-1 w-full resize-y ${inputClass}`}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="flex items-center gap-1 text-[11px] text-zinc-500">
                <Sparkles size={11} aria-hidden /> Need a spark?
              </span>
              {SPARKS.map((spark) => (
                <button
                  key={spark.title}
                  type="button"
                  onClick={() => {
                    setTitle(spark.title);
                    setPrompt(spark.prompt);
                  }}
                  className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-400 transition hover:border-violet-500/60 hover:text-violet-300"
                >
                  {spark.title}
                </button>
              ))}
            </div>
          </Section>

          <Section step="02" title="Reflex connection">
            <ConnectionCard />
          </Section>

          <Section step="03" title="Agent & model">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Agent
                <select
                  value={agentType}
                  onChange={(e) => {
                    setAgentType(e.target.value);
                    setModel('');
                  }}
                  disabled={!catalog}
                  className={`mt-1 w-full ${inputClass} disabled:opacity-60`}
                >
                  {!catalog ? (
                    <option value="">
                      {connectionReady
                        ? (catalogError ?? 'Loading agents...')
                        : 'Connect a key first'}
                    </option>
                  ) : (
                    catalog.agents.map((agent) => (
                      <option key={agent.agentType} value={agent.agentType}>
                        {agent.displayName}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Model
                <ModelPicker agent={selectedAgent} model={model} onChange={setModel} />
              </label>
            </div>
            {/*
             * Only for multi-model agents: a single-model agent offers no
             * model to pick, so a key panel could only ever say "pick a
             * model" at a picker that isn't there.
             */}
            {catalog && selectedAgent && selectedAgent.providers.length > 0 ? (
              <ProviderKeyList
                provider={selectedProvider}
                keys={catalog.keys}
                selectedKeyId={activeProviderKeyId}
                onSelect={setProviderKeyId}
              />
            ) : null}
          </Section>

          <Section step="04" title="Stream options">
            <div className="flex flex-col gap-2.5 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={(e) => setIsPublic(e.target.checked)}
                  className="accent-violet-500"
                />
                Public — anyone can watch and suggest
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={autoApprove}
                  onChange={(e) => setAutoApprove(e.target.checked)}
                  className="accent-violet-500"
                />
                Auto-approve suggestions — skip the review queue
              </label>
            </div>
          </Section>

          {error ? <p className="text-sm text-rose-400">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" variant="glow" size="lg" sparkle disabled={busy || !canCreate}>
              {busy ? 'Starting the agent…' : 'Start the stream'}
            </Button>
            <p className="text-xs text-zinc-500">
              Boots a real devbox under your active key — usually live in a couple of minutes.
            </p>
          </div>
        </form>

        <aside className="h-fit space-y-4 lg:sticky lg:top-20">
          <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
            Shelf preview
          </p>
          <PreviewTile title={title} prompt={prompt} name={me.name} />
          <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
            <p className="text-xs font-semibold tracking-widest text-zinc-500 uppercase">
              What happens next
            </p>
            <ol className="mt-3 space-y-3">
              {NEXT_STEPS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <li key={i} className="flex gap-2.5 text-sm text-zinc-400">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/25 to-fuchsia-500/25 text-violet-300">
                      <Icon size={14} aria-hidden />
                    </span>
                    <span className="pt-1">{step.text}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
      </div>
    </main>
  );
}
