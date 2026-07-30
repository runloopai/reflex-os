import { Box, Text, useApp } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReflexSocket,
  archiveAgent,
  getAgent,
  listAgents,
  unarchiveAgent,
  updateAgent,
  type Agent,
  type ReflexSocketState,
} from '@runloop/reflex-client';
import { updateSavedConfig, type TuiConfig } from '../config.js';
import type { ToolApprover } from '../connect/policy.js';
import type { ConnectEvent, WorkstationConnection } from '../connect/workstation-client.js';
import { AgentListScreen } from './AgentListScreen.js';
import { ApprovalPrompt, useApproverPending } from './ApprovalPrompt.js';
import { ChatScreen, type WorkstationState } from './ChatScreen.js';
import { LaunchScreen } from './LaunchScreen.js';
import { ringBell, setTerminalTitle } from './terminal.js';

type Screen = { name: 'list' } | { name: 'chat'; agent: Agent } | { name: 'launch' };

interface AppProps {
  config: TuiConfig;
  /** Present when the TUI was started with `--connect`. */
  connection: WorkstationConnection | null;
  /** Permission gate for the connection; null without `--connect`. */
  approver: ToolApprover | null;
  /** Agent to open straight into once the list loads (`chat <agent>`). */
  initialAgentId?: string | null;
}

/**
 * Interactive TUI shell: agent list → chat/launch screens over one shared
 * `ReflexSocket` (agent broadcasts keep the list fresh; per-agent stream
 * subscriptions power the chat). The optional workstation connection runs
 * alongside and reports its state in the footer.
 */
export function App({ config, connection, approver, initialAgentId = null }: AppProps) {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const pendingApproval = useApproverPending(approver);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [connect, setConnect] = useState<WorkstationState | null>(
    connection ? { label: 'connecting', healthy: false } : null,
  );
  const refreshSeq = useRef(0);
  // Last known status per agent, for spotting attention transitions.
  const statusRef = useRef(new Map<string, string>());
  // The live handler below runs outside React's render, so it reads the
  // current screen through a ref.
  const screenRef = useRef(screen);
  screenRef.current = screen;

  const socket = useMemo(() => new ReflexSocket(), []);
  // Half-typed messages survive list↔chat navigation (ChatScreen unmounts).
  const chatDrafts = useRef(new Map<string, string>()).current;

  // The socket reconnects on its own, but a stale screen looks live — so a
  // drop is shown (on every screen) once the connection has been open.
  const [socketState, setSocketState] = useState<ReflexSocketState>(socket.state);
  const everOpenRef = useRef(false);
  useEffect(
    () =>
      socket.onStateChange((state) => {
        if (state === 'open') everOpenRef.current = true;
        setSocketState(state);
      }),
    [socket],
  );

  // Terminal title tracks where you are, so backgrounded panes stay
  // identifiable. The fresh agents entry keeps up with server auto-naming.
  useEffect(() => {
    const openAgent =
      screen.name === 'chat'
        ? (agents.find((a) => a.id === screen.agent.id) ?? screen.agent)
        : null;
    setTerminalTitle(openAgent ? `${openAgent.name} · Reflex` : 'Reflex');
  }, [screen, agents]);
  useEffect(() => () => setTerminalTitle(''), []);

  function refresh() {
    const seq = ++refreshSeq.current;
    listAgents({ limit: 100 })
      .then((res) => {
        if (seq !== refreshSeq.current) return;
        for (const agent of res.data.agents) statusRef.current.set(agent.id, agent.status);
        setAgents(res.data.agents);
        setLoading(false);
        setListError(null);
      })
      .catch((err: unknown) => {
        if (seq !== refreshSeq.current) return;
        setLoading(false);
        setListError(err instanceof Error ? err.message : String(err));
      });
  }

  /** Optimistic pin toggle; the `agent:updated` broadcast confirms it. */
  async function togglePin(agent: Agent) {
    const next = !agent.pinned;
    setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, pinned: next } : a)));
    try {
      await updateAgent(agent.id, { pinned: next });
    } catch (err) {
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, pinned: agent.pinned } : a)),
      );
      setListError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Optimistic archive/unarchive; reversible, so no confirmation step. */
  async function toggleArchive(agent: Agent) {
    const next = !agent.archived;
    setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, archived: next } : a)));
    try {
      await (next ? archiveAgent(agent.id) : unarchiveAgent(agent.id));
    } catch (err) {
      setAgents((prev) =>
        prev.map((a) => (a.id === agent.id ? { ...a, archived: agent.archived } : a)),
      );
      setListError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    refresh();
    socket.connect();
    const offMessage = socket.onMessage((msg) => {
      if ((msg.type === 'agent:updated' || msg.type === 'agent:created') && msg.agent) {
        const agent = msg.agent as Agent;
        // Bell when an agent starts waiting on the user anywhere except its
        // own open chat, which rings for itself (ChatScreen). Only observed
        // transitions ring — a fresh listing never does.
        const prevStatus = statusRef.current.get(agent.id);
        statusRef.current.set(agent.id, agent.status);
        const current = screenRef.current;
        const inItsChat = current.name === 'chat' && current.agent.id === agent.id;
        if (
          prevStatus !== undefined &&
          prevStatus !== 'needs_input' &&
          agent.status === 'needs_input' &&
          !inItsChat
        ) {
          ringBell();
        }
        setAgents((prev) => {
          const next = prev.filter((a) => a.id !== agent.id);
          return [agent, ...next];
        });
      }
    });
    return () => {
      offMessage();
      socket.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once wiring
  }, [socket]);

  // `chat <agent>`: auto-open once the list has loaded. The agent usually
  // arrives with the listing; when it does not (old, past the page limit),
  // fetch it directly. One-shot so esc back to the list sticks.
  const initialOpened = useRef(false);
  useEffect(() => {
    if (!initialAgentId || initialOpened.current || loading) return;
    initialOpened.current = true;
    const found = agents.find((a) => a.id === initialAgentId);
    if (found) {
      setScreen({ name: 'chat', agent: found });
      return;
    }
    getAgent(initialAgentId)
      .then((res) => setScreen({ name: 'chat', agent: res.data }))
      .catch((err: unknown) => setListError(err instanceof Error ? err.message : String(err)));
  }, [initialAgentId, loading, agents]);

  useEffect(() => {
    if (!connection) return;
    // The connection was constructed with an onEvent that forwards here.
    return connectionEventsBridge(connection, (event) => {
      if (event.kind === 'status') {
        setConnect(
          event.status === 'registered'
            ? {
                label: `connected as ${event.workstation?.name ?? 'workstation'}`,
                healthy: true,
              }
            : { label: event.status, healthy: false },
        );
      }
      if (event.kind === 'error') setConnect({ label: `error: ${event.message}`, healthy: false });
    });
  }, [connection]);

  // Modal takeover: while an approval is pending, this is the ONLY screen —
  // otherwise a chat/launch TextInput would swallow (or worse, act on) the
  // y/a/n keys. Chat state survives because re-subscribing replays history.
  if (approver && pendingApproval) {
    return (
      <Box flexDirection="column" padding={1}>
        <ApprovalPrompt approver={approver} pending={pendingApproval} />
        <Box marginTop={1}>
          <Text dimColor>the previous screen returns after you decide</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      {screen.name === 'list' ? (
        <AgentListScreen
          agents={agents}
          loading={loading}
          error={listError}
          onOpen={(agent) => setScreen({ name: 'chat', agent })}
          onLaunch={() => setScreen({ name: 'launch' })}
          onTogglePin={(agent) => void togglePin(agent)}
          onToggleArchive={(agent) => void toggleArchive(agent)}
          onRefresh={refresh}
          onQuit={() => {
            connection?.stop();
            exit();
          }}
        />
      ) : null}
      {screen.name === 'chat' ? (
        <ChatScreen
          key={screen.agent.id}
          // Broadcast updates keep the object fresh (status, registered
          // daemons for the ^o palette) while the chat is open.
          agent={agents.find((a) => a.id === screen.agent.id) ?? screen.agent}
          socket={socket}
          connect={connect}
          drafts={chatDrafts}
          onBack={() => setScreen({ name: 'list' })}
        />
      ) : null}
      {screen.name === 'launch' ? (
        <LaunchScreen
          defaultAgentType={config.defaultAgentType}
          initialRepo={config.lastRepo}
          // Model preferences only carry over within the same agent type.
          initialModel={config.defaultAgentType ? config.lastModel : undefined}
          onDefaultsUsed={(defaults) => {
            try {
              updateSavedConfig({
                defaultAgentType: defaults.agentType,
                lastModel: defaults.model ?? undefined,
                lastRepo: defaults.repo || undefined,
              });
            } catch {
              // Read-only home dir — remembering defaults is best-effort.
            }
          }}
          onLaunched={(agent) => {
            setAgents((prev) => [agent, ...prev.filter((a) => a.id !== agent.id)]);
            setScreen({ name: 'chat', agent });
          }}
          onCancel={() => setScreen({ name: 'list' })}
        />
      ) : null}
      {everOpenRef.current && socketState !== 'open' ? (
        <Box marginTop={1}>
          <Text color="yellow">connection lost — reconnecting…</Text>
        </Box>
      ) : null}
      {screen.name === 'list' ? (
        // Ambient context lives on the home screen only; in a chat, /status
        // shows the endpoint and connection state on demand (an unhealthy
        // connection stays visible everywhere).
        <Box marginTop={1} gap={2}>
          <Text dimColor>{config.baseUrl}</Text>
          {connect ? (
            <Text color={connect.healthy ? undefined : 'yellow'} dimColor={connect.healthy}>
              workstation: {connect.label}
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

type ConnectEventListener = (event: ConnectEvent) => void;

const listenerRegistry = new WeakMap<WorkstationConnection, Set<ConnectEventListener>>();

/**
 * Fan a connection's events out to UI listeners. The connection itself is
 * constructed (in `cli.ts`) with `onEvent: dispatchConnectionEvent`, so UI
 * components can attach/detach without owning the socket lifecycle.
 */
export function dispatchConnectionEvent(connection: WorkstationConnection, event: ConnectEvent) {
  for (const listener of listenerRegistry.get(connection) ?? []) listener(event);
}

function connectionEventsBridge(
  connection: WorkstationConnection,
  listener: ConnectEventListener,
): () => void {
  let set = listenerRegistry.get(connection);
  if (!set) {
    set = new Set();
    listenerRegistry.set(connection, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}
