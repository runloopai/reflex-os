import { Box, Static, Text, useInput } from 'ink';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  enqueueAgentMessage,
  getAgentQueue,
  getAgentStream,
  getReflexConfig,
  sendAgentControlResponse,
  interruptAgent,
  removeQueuedAgentMessage,
  sendAgentMessage,
  updateAgent,
  type Agent,
  type EnqueueAgentMessageBodyAttachmentsItem,
  type ReflexSocket,
  type ReflexStreamEvent,
} from '@runloop/reflex-client';
import { buildContentBlocks, type Attachment, type QueuedMessage } from '@runloop/reflex-contract';
import {
  assertAttachmentLimits,
  attachmentFromBytes,
  extractPastedPath,
  loadAttachment,
} from '../attachments.js';
import { readClipboardImage } from '../clipboard.js';
import { openBrowser } from '../connect/open-browser.js';
import {
  buildAskUserControlResponse,
  buildAskUserDenyResponse,
  buildPermissionAllowResponse,
  buildPermissionDenyResponse,
} from '../chat/control.js';
import { agentOpenLinks } from '../chat/links.js';
import { agentStatusRows, chatHelpRows, type InfoRow } from '../chat/status.js';
import type { PickOption } from '../launch/options.js';
import {
  SEND_ECHO_TIMEOUT_MS,
  TranscriptEngine,
  type PendingSend,
  type ToolItem,
  type TranscriptItem,
} from '../chat/transcript.js';
import { ringBell } from './terminal.js';
import {
  EMPTY_HISTORY,
  historyEntries,
  stepHistory,
  type ComposerHistory,
} from './composer-model.js';
import { ComposerInput } from './ComposerInput.js';
import { OpenPalette } from './OpenPalette.js';
import { OutputViewer } from './OutputViewer.js';
import { PermissionPrompt, type PermissionChoice } from './PermissionPrompt.js';
import { QuestionPrompt } from './QuestionPrompt.js';
import { SendStateStrip } from './SendStateStrip.js';
import { TranscriptItemView } from './TranscriptItemView.js';
import { statusColor } from './theme.js';
import { useElapsedSeconds, useSpinnerFrame } from './useSpinner.js';

/** Workstation connection state passed down when the TUI ran `--connect`. */
export interface WorkstationState {
  label: string;
  /** True while registered; anything else is worth showing in the chat. */
  healthy: boolean;
}

interface ChatScreenProps {
  agent: Agent;
  socket: ReflexSocket;
  /** Workstation connection; null without `--connect`. */
  connect?: WorkstationState | null;
  /**
   * Drafts keyed by agent id, owned by the shell so a half-typed message
   * survives going back to the list and reopening the chat.
   */
  drafts?: Map<string, string>;
  onBack: () => void;
}

/** On-demand detail block (`/status`, `/help`) shown above the composer. */
interface InfoBlock {
  title: string;
  rows: InfoRow[];
}

/** Transcript header printed once at the top of the scrollback. */
interface HeaderEntry {
  kind: 'header';
  id: string;
  agent: Agent;
}
type StaticEntry = HeaderEntry | TranscriptItem;

let clientIdSeq = 0;
function nextClientId(): string {
  return `pm-${Date.now()}-${++clientIdSeq}`;
}

/** Names pasted clipboard images uniquely within the process. */
let pastedImageSeq = 0;

/**
 * Don't ring the bell for state transitions replayed from history right
 * after opening the chat — only for ones that happen while watching.
 */
const BELL_WARMUP_MS = 5_000;

/**
 * Live agent chat built on the same event backbone as the web chat
 * (`chat/transcript.ts`): full turn rendering (text, thinking, tool calls
 * with status and output, plans), interactive AskUserQuestion and permission
 * prompts, folded devbox setup progress, and lifecycle banners.
 *
 * Sending follows the web's optimistic model: a pending entry is registered
 * before the POST, the echoed stream event is the only thing that becomes a
 * transcript line (resolving the pending entry no matter which arrives
 * first), and a watchdog flips silent sends to unconfirmed/failed. While the
 * agent is mid-turn, messages go to the server-owned queue instead and drain
 * one per turn.
 *
 * Finalized items print through `<Static>` so the whole conversation lives in
 * normal terminal scrollback; only the live tail (streaming text, running
 * tools, prompts, composer) re-renders.
 */
export function ChatScreen({ agent, socket, connect = null, drafts, onBack }: ChatScreenProps) {
  const engine = useMemo(() => new TranscriptEngine(), []);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [draft, setDraftState] = useState(() => drafts?.get(agent.id) ?? '');
  function setDraft(value: string) {
    setDraftState(value);
    if (!drafts) return;
    if (value) drafts.set(agent.id, value);
    else drafts.delete(agent.id);
  }
  const [staged, setStaged] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [info, setInfo] = useState<'status' | 'help' | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [recall, setRecall] = useState<ComposerHistory>(EMPTY_HISTORY);
  const [respondBusy, setRespondBusy] = useState(false);
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => engine.subscribe(bump), [engine]);

  // Full history over REST first, then the live socket. The socket replays
  // only a cached window on subscribe, so without the backfill an older
  // conversation would start mid-stream; subscribing after the backfill
  // keeps events ordered (the engine dedupes the overlap by event id).
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const res = await getAgentStream(agent.id);
        if (!cancelled) {
          for (const event of res.data as unknown as ReflexStreamEvent[]) {
            engine.handleEvent(event);
          }
        }
      } catch {
        // Older server or transient failure — the socket replay still covers
        // the recent window.
      }
      if (!cancelled) {
        setHistoryLoading(false);
        unsubscribe = socket.subscribe(agent.streamId, (event) => engine.handleEvent(event));
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [socket, agent.streamId, agent.id, engine]);

  // Server-owned message queue: seed over REST, then mirror the full-list
  // `agent:queue_updated` broadcasts (enqueue/update/remove/reorder/drain).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await getAgentQueue(agent.id);
        if (!cancelled) setQueue(res.data as unknown as QueuedMessage[]);
      } catch {
        // Queue routes may be absent on older servers; sending still works.
      }
    })();
    const offMessage = socket.onMessage((msg) => {
      if (msg.type !== 'agent:queue_updated') return;
      if ((msg as { agentId?: string }).agentId !== agent.id) return;
      setQueue(((msg as { queue?: QueuedMessage[] }).queue ?? []) as QueuedMessage[]);
    });
    return () => {
      cancelled = true;
      offMessage();
    };
  }, [socket, agent.id]);

  const items = engine.getItems();
  const stableCount = engine.getStableCount();
  const pending = engine.getPendingInteraction();
  // Tool calls with output for the ctrl+t viewer, newest first. The
  // transcript clips results to a few lines; this is the way back to them.
  const toolOutputs: ToolItem[] = [];
  for (let i = items.length - 1; i >= 0 && toolOutputs.length < 50; i--) {
    const item = items[i];
    if (item.kind === 'tool' && item.output?.trim()) toolOutputs.push(item);
  }
  const working = engine.isWorking();
  const pendingSends = engine.getPendingSends();
  const spinnerFrame = useSpinnerFrame(
    working || pendingSends.length > 0 || items.length > stableCount || historyLoading,
  );
  const workingSecs = useElapsedSeconds(working ? engine.getWorkingSinceMs() : null);

  const serverUrl = useMemo<string | null>(() => {
    try {
      return getReflexConfig().baseUrl ?? null;
    } catch {
      // Unconfigured client (tests/smoke) — omit the server row.
      return null;
    }
  }, []);

  // Built at render, not at command time, so an open /status block tracks
  // live agent updates (status flips, devbox assignment) instead of freezing
  // a snapshot.
  const infoBlock: InfoBlock | null =
    info === 'help'
      ? { title: 'Commands', rows: chatHelpRows() }
      : info === 'status'
        ? {
            title: 'Status',
            rows: agentStatusRows(agent, { serverUrl, workstation: connect?.label ?? null }),
          }
        : null;

  // Echo-timeout watchdog (web parity): while any send awaits its echo,
  // tick once a second so stale entries flip to unconfirmed/failed.
  const hasSendingEntries = pendingSends.some((p) => p.status === 'sending');
  useEffect(() => {
    if (!hasSendingEntries) return;
    const timer = setInterval(() => engine.timeoutStalePendingSends(SEND_ECHO_TIMEOUT_MS), 1000);
    return () => clearInterval(timer);
  }, [engine, hasSendingEntries]);

  // Synthetic bubble for a fresh agent's initial prompt, until the stream
  // echoes it back as the first user message (web parity).
  const initialPromptPending = useMemo<PendingSend | null>(() => {
    const prompt = agent.prompt?.trim();
    if (!prompt || engine.hasUserMessage()) return null;
    if (agent.status === 'stopped' || agent.status === 'completed') return null;
    const failed = agent.status === 'error';
    return {
      clientId: `initial-${agent.id}`,
      text: agent.prompt,
      attachments: [],
      createdAt: agent.createdAt,
      status: failed ? 'failed' : 'sending',
      httpAcked: true,
      error: failed ? 'Agent failed to start.' : null,
    };
    // items.length keeps this in sync with engine.hasUserMessage().
  }, [agent, engine, items.length]);

  const visiblePendingSends = initialPromptPending
    ? [initialPromptPending, ...pendingSends]
    : [...pendingSends];

  // Bell on attention transitions: a question/permission starts waiting on
  // the user, or the working turn ends — but not for replayed history.
  const mountedAtRef = useRef(Date.now());
  const prevPendingIdRef = useRef<string | null>(null);
  const prevWorkingRef = useRef(false);
  useEffect(() => {
    const live = Date.now() - mountedAtRef.current > BELL_WARMUP_MS;
    if (pending && pending.id !== prevPendingIdRef.current && live) ringBell();
    prevPendingIdRef.current = pending?.id ?? null;
    if (!working && prevWorkingRef.current && live) ringBell();
    prevWorkingRef.current = working;
  }, [pending, working]);

  // Everything about this agent that opens in a browser (shared with `open`).
  const openLinks = useMemo<PickOption[]>(
    () => agentOpenLinks(serverUrl, agent.id, engine.getPrLinks(), agent.daemons),
    // items.length keeps this in sync with engine.getPrLinks().
    [serverUrl, agent.id, agent.daemons, engine, items.length],
  );

  const header = useMemo<HeaderEntry>(() => ({ kind: 'header', id: 'header', agent }), [agent]);
  const staticEntries: StaticEntry[] = [header, ...items.slice(0, stableCount)];
  const liveItems = items.slice(stableCount);

  /**
   * Shell-style recall of previously sent messages (transcript-sourced, so
   * it works for backfilled history too). The composer calls this only from
   * the draft's boundary line — inside a multi-line draft, arrows move the
   * cursor.
   */
  function handleHistoryStep(direction: 'older' | 'newer') {
    const step = stepHistory(historyEntries(items), recall, direction, draft);
    if (step) {
      setRecall(step.history);
      setDraft(step.draft);
    }
  }

  useInput(
    (input, key) => {
      // ctrl+v pastes an image from the system clipboard, like Claude Code.
      // (Plain terminal paste of text/paths flows through the composer's
      // stdin chunk and is handled by handlePastedChunk.)
      if (key.ctrl && input === 'v') {
        void stageClipboardImage();
        return;
      }
      // ctrl+o: everything associated with this agent that opens in a browser.
      if (key.ctrl && input === 'o') {
        setPaletteOpen(true);
        return;
      }
      // ctrl+t: full output of any tool call, in a scrollable overlay.
      if (key.ctrl && input === 't') {
        if (toolOutputs.length === 0) setNotice('no tool output yet');
        else setViewerOpen(true);
        return;
      }
      if (!key.escape) return;
      if (info) {
        setInfo(null);
        return;
      }
      if (working) {
        void interrupt();
      } else {
        onBack();
      }
    },
    { isActive: pending === null && !paletteOpen && !viewerOpen },
  );

  function openLink(url: string) {
    setPaletteOpen(false);
    const spawned = openBrowser(url);
    // Headless/SSH sessions have no browser — always print the URL too.
    setNotice(spawned ? `opening ${url}` : `open manually: ${url}`);
  }

  /** Stage a file path by reading it, with the shared classification/limits. */
  async function stageFile(filePath: string) {
    try {
      const attachment = await loadAttachment(filePath);
      assertAttachmentLimits(staged, attachment);
      setStaged((prev) => [...prev, attachment]);
      setNotice(`staged ${attachment.name} (${attachment.size} bytes)`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  async function stageClipboardImage() {
    setNotice(null);
    const bytes = await readClipboardImage();
    if (!bytes) {
      setNotice('no image on the clipboard');
      return;
    }
    try {
      const attachment = attachmentFromBytes(`pasted-image-${++pastedImageSeq}.png`, bytes);
      assertAttachmentLimits(staged, attachment);
      setStaged((prev) => [...prev, attachment]);
      setNotice(`staged ${attachment.name} (${attachment.size} bytes)`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  /** Pasted chunk that is an existing file's path → attachment, not text. */
  function handlePastedChunk(text: string): boolean {
    const filePath = extractPastedPath(text);
    if (!filePath) return false;
    void stageFile(filePath);
    return true;
  }

  async function interrupt() {
    try {
      await interruptAgent(agent.id);
      setNotice('interrupt requested');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  }

  /** POST a control response, then record the outcome on the transcript. */
  async function respond(payload: Record<string, unknown>, record: () => void) {
    setRespondBusy(true);
    setNotice(null);
    try {
      await sendAgentControlResponse(agent.id, { payload });
      record();
    } catch (err) {
      // 409 means the parked request is gone (agent reconnected mid-prompt).
      setNotice(
        err instanceof Error
          ? `failed to send response: ${err.message}`
          : 'failed to send response',
      );
    } finally {
      setRespondBusy(false);
    }
  }

  /**
   * Optimistic send: the pending entry exists before the POST, the returned
   * event feeds the engine (instant authoritative echo — the socket replay of
   * the same event id dedupes), and failures mark the entry for /retry.
   */
  async function sendOptimistic(clientId: string, text: string, attachments: Attachment[]) {
    try {
      const res = await sendAgentMessage(
        agent.id,
        attachments.length > 0
          ? { content: buildContentBlocks(text, attachments) }
          : { message: text },
      );
      engine.markPendingHttpAcked(clientId);
      engine.handleEvent(res.data as unknown as ReflexStreamEvent);
    } catch (err) {
      engine.markPendingFailed(clientId, err instanceof Error ? err.message : String(err));
    }
  }

  async function handleSubmit(value: string) {
    const text = value.trim();
    setDraft('');
    setRecall(EMPTY_HISTORY);
    if (!text) return;
    setNotice(null);
    setInfo(null);

    if (text === '/help') {
      setInfo('help');
      return;
    }
    if (text === '/status') {
      setInfo('status');
      return;
    }
    if (text.startsWith('/attach ')) {
      await stageFile(text.slice('/attach '.length).trim());
      return;
    }
    if (text === '/detach') {
      setStaged([]);
      setNotice('cleared staged attachments');
      return;
    }
    if (text === '/interrupt') {
      await interrupt();
      return;
    }
    if (text.startsWith('/rename')) {
      const name = text.slice('/rename'.length).trim();
      if (!name) {
        setNotice('usage: /rename <new name>');
        return;
      }
      try {
        await updateAgent(agent.id, { name });
        // The broadcast updates the list and the terminal title; the frozen
        // scrollback header keeps the old name, which the notice covers.
        setNotice(`renamed to ${name}`);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (text === '/retry') {
      const target = [...pendingSends].reverse().find((p) => p.status !== 'sending');
      if (!target) {
        setNotice('nothing to retry');
        return;
      }
      const entry = engine.resetPendingForRetry(target.clientId);
      if (entry) await sendOptimistic(entry.clientId, entry.text, []);
      return;
    }
    if (text === '/dismiss') {
      for (const p of pendingSends.filter((p) => p.status !== 'sending')) {
        engine.dismissPendingSend(p.clientId);
      }
      return;
    }
    if (text.startsWith('/unqueue')) {
      const index = Number(text.slice('/unqueue'.length).trim() || '0') - 1;
      const target = queue[index];
      if (!target) {
        setNotice(`usage: /unqueue <1-${queue.length || 1}>`);
        return;
      }
      try {
        await removeQueuedAgentMessage(agent.id, target.id);
        setQueue((prev) => prev.filter((m) => m.id !== target.id));
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const attachments = staged;
    setStaged([]);

    // Mid-turn sends go to the server-owned queue (drained one per turn),
    // exactly like the web composer.
    if (working) {
      try {
        const res = await enqueueAgentMessage(agent.id, {
          text,
          // The generated attachment item mirrors the shared Attachment schema.
          ...(attachments.length > 0
            ? { attachments: attachments as EnqueueAgentMessageBodyAttachmentsItem[] }
            : {}),
        });
        setQueue((prev) => [...prev, res.data as unknown as QueuedMessage]);
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err));
        setStaged(attachments);
      }
      return;
    }

    const clientId = nextClientId();
    engine.addPendingSend(
      clientId,
      text,
      attachments.map((a) => a.name),
    );
    await sendOptimistic(clientId, text, attachments);
  }

  return (
    <Box flexDirection="column">
      <Static items={staticEntries}>
        {(entry) =>
          entry.kind === 'header' ? (
            <Box key={entry.id} gap={1} marginTop={1}>
              <Text color={statusColor(entry.agent.status)}>●</Text>
              <Text bold color="cyan">
                {entry.agent.name}
              </Text>
              <Text dimColor>{entry.agent.agentType}</Text>
            </Box>
          ) : (
            <TranscriptItemView key={entry.id} item={entry} />
          )
        }
      </Static>

      {liveItems.map((item) => (
        <TranscriptItemView key={item.id} item={item} live spinnerFrame={spinnerFrame} />
      ))}

      {historyLoading && items.length === 0 && visiblePendingSends.length === 0 ? (
        <Box gap={1} marginTop={1}>
          <Text color="cyan">{spinnerFrame}</Text>
          <Text dimColor>Loading history…</Text>
        </Box>
      ) : null}

      <SendStateStrip pending={visiblePendingSends} queue={queue} spinnerFrame={spinnerFrame} />

      {working && pending === null ? (
        <Box gap={1} marginTop={1}>
          <Text color="cyan">{spinnerFrame}</Text>
          <Text dimColor>Working… ({workingSecs}s · esc to interrupt)</Text>
        </Box>
      ) : null}

      {pending?.kind === 'question' ? (
        <QuestionPrompt
          item={pending}
          busy={respondBusy}
          onSubmit={(answers) =>
            void respond(buildAskUserControlResponse(pending, pending.questions, answers), () =>
              engine.resolveQuestionLocally(pending.requestId, 'answered', answers),
            )
          }
          onSkip={() =>
            void respond(
              buildAskUserDenyResponse(
                pending,
                'The user skipped the question(s) without answering. Continue using your best judgment.',
              ),
              () => engine.resolveQuestionLocally(pending.requestId, 'skipped', {}),
            )
          }
          onDismiss={() =>
            void respond(
              buildAskUserDenyResponse(
                pending,
                'The user dismissed the question(s) and interrupted the turn.',
                true,
              ),
              () => engine.resolveQuestionLocally(pending.requestId, 'dismissed', {}),
            )
          }
        />
      ) : null}

      {pending?.kind === 'permission' ? (
        <PermissionPrompt
          item={pending}
          busy={respondBusy}
          onDecide={(choice: PermissionChoice) => {
            const payload =
              choice === 'allow' || choice === 'allow-always'
                ? buildPermissionAllowResponse(pending, pending.input, {
                    alwaysAllowTool: choice === 'allow-always' ? pending.toolName : null,
                  })
                : buildPermissionDenyResponse(pending, choice === 'deny-interrupt');
            const decision =
              choice === 'allow'
                ? ('allowed' as const)
                : choice === 'allow-always'
                  ? ('allowed-always' as const)
                  : choice === 'deny'
                    ? ('denied' as const)
                    : ('interrupted' as const);
            void respond(payload, () =>
              engine.resolvePermissionLocally(pending.requestId, decision),
            );
          }}
        />
      ) : null}

      {paletteOpen ? (
        <OpenPalette links={openLinks} onPick={openLink} onClose={() => setPaletteOpen(false)} />
      ) : null}

      {viewerOpen ? (
        <OutputViewer tools={toolOutputs} onClose={() => setViewerOpen(false)} />
      ) : null}

      {staged.length > 0 ? (
        <Text dimColor>staged: {staged.map((a) => a.name).join(', ')}</Text>
      ) : null}
      {connect && !connect.healthy ? (
        // A broken connection makes the agent's workstation tools fail, so it
        // stays ambient; the healthy state lives in /status instead.
        <Text color="yellow">workstation: {connect.label}</Text>
      ) : null}
      {notice ? <Text color="yellow">{notice}</Text> : null}

      {pending === null && !paletteOpen && !viewerOpen ? (
        <Box flexDirection="column" marginTop={working ? 0 : 1}>
          {infoBlock ? (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="cyan">
                {infoBlock.title}
              </Text>
              {infoBlock.rows.map((row) => (
                <Box key={row.label} gap={1}>
                  <Box width={15} flexShrink={0}>
                    <Text dimColor>{row.label}</Text>
                  </Box>
                  <Text wrap="truncate-end">{row.value}</Text>
                </Box>
              ))}
            </Box>
          ) : null}
          <Box gap={1}>
            <Text color="cyan">❯</Text>
            <ComposerInput
              value={draft}
              onChange={setDraft}
              onSubmit={(value) => {
                void handleSubmit(value);
              }}
              onPaste={handlePastedChunk}
              onHistoryStep={handleHistoryStep}
              placeholder={working ? 'message (queues while working)' : 'message'}
            />
          </Box>
          <Text dimColor>
            ^o open{openLinks.length > 1 ? ` (${openLinks.length})` : ''} · ^t output · ^v image ·
            /help commands · esc {info ? 'close' : working ? 'interrupt' : 'back'}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
