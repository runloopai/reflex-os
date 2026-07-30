import type { Command } from 'commander';
import {
  getAgent,
  getAgentStream,
  ReflexSocket,
  type ReflexStreamEvent,
} from '@runloop/reflex-client';
import { renderTranscriptItem } from '../chat/render-text.js';
import { TranscriptEngine } from '../chat/transcript.js';
import { UntilTracker, type UntilCondition, type WatchOutcome } from '../chat/until.js';
import { configureClient } from '../client.js';
import { ensureConfig, type CliFlags } from '../context.js';
import { UsageError } from '../output/errors.js';
import { color, colorStatus } from '../output/table.js';
import type { RegisterContext } from './define.js';

/**
 * `watch`: stream an agent's transcript to stdout without the TUI. History
 * backfills over REST (the same call the chat screen makes), then the
 * WebSocket keeps printing live events. Rendering reuses the chat transcript
 * engine and its plain-text renderer, so `watch` shows exactly what the TUI
 * chat would. `--json` switches to NDJSON, one stream event per line.
 */

/** The stream I/O `watchAgent` needs, so tests can run without a socket. */
export interface StreamSource {
  /** Full event history over REST (`getAgentStream`). */
  backfill(agentId: string): Promise<ReflexStreamEvent[]>;
  /** Live subscription; returns an unsubscribe function. */
  subscribe(streamId: string, onEvent: (event: ReflexStreamEvent) => void): () => void;
  /** Release the underlying connection. */
  close(): void;
}

/** The real source: REST backfill plus a `ReflexSocket` subscription. */
export function liveStreamSource(): StreamSource {
  const socket = new ReflexSocket();
  return {
    async backfill(agentId) {
      const res = await getAgentStream(agentId);
      return res.data as unknown as ReflexStreamEvent[];
    },
    subscribe: (streamId, onEvent) => socket.subscribe(streamId, onEvent),
    close: () => socket.close(),
  };
}

/** Validate `--until`; commander passes the raw string through. */
export function parseUntilFlag(value: unknown): UntilCondition {
  if (value === undefined || value === 'done') return 'done';
  if (value === 'pr' || value === 'forever') return value;
  throw new UsageError(`--until expects done, pr, or forever, got: ${String(value)}`);
}

export interface WatchAgentOptions {
  until: UntilCondition;
  /** NDJSON instead of the human transcript. */
  json: boolean;
  source: StreamSource;
  /** Line sink; defaults to stdout. */
  out?: (line: string) => void;
}

/**
 * Backfill, render, then follow the stream until the condition is met.
 * Resolves with the outcome (`done` and `pr` exit 0, `error` exits 1); with
 * `--until forever` the promise never resolves and ctrl+c ends the process.
 * If the backfilled history already satisfies the condition (the turn is
 * over, or a PR exists), it resolves without subscribing.
 */
export async function watchAgent(
  agent: { id: string; streamId: string },
  { until, json, source, out = console.log }: WatchAgentOptions,
): Promise<WatchOutcome> {
  const tracker = new UntilTracker();
  const engine = new TranscriptEngine();
  const seen = new Set<string>();
  let printedCount = 0;
  let lastPendingId: string | null = null;
  let settle: ((outcome: WatchOutcome) => void) | null = null;

  const flush = (): void => {
    const items = engine.getItems();
    const stable = engine.getStableCount();
    while (printedCount < stable) {
      const text = renderTranscriptItem(items[printedCount]);
      if (text !== null) out(text);
      printedCount += 1;
    }
    const pending = engine.getPendingInteraction();
    if (pending && pending.id !== lastPendingId) {
      lastPendingId = pending.id;
      out(color('\n? The agent is waiting for input. Answer in the web app or the TUI.', 'yellow'));
    }
  };

  const handle = (event: ReflexStreamEvent): void => {
    // The socket replays a cached window that overlaps the REST backfill.
    if (seen.has(event.id)) return;
    seen.add(event.id);
    const outcome = tracker.observe(event);
    if (json) {
      out(JSON.stringify(event));
    } else {
      engine.handleEvent(event);
      flush();
    }
    if (outcome !== null && settle !== null && until !== 'forever') {
      if (outcome === 'error' || outcome === until) settle(outcome);
    }
  };

  for (const event of await source.backfill(agent.id)) handle(event);

  // The history may already satisfy the condition (idle agent, past error).
  if (until === 'done') {
    const outcome = tracker.turnOutcome();
    if (outcome !== null) {
      source.close();
      return outcome;
    }
  } else if (until === 'pr') {
    if (tracker.hasPr()) {
      source.close();
      return 'pr';
    }
    if (tracker.turnOutcome() === 'error') {
      source.close();
      return 'error';
    }
  }

  return new Promise<WatchOutcome>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    settle = (outcome) => {
      if (settled) return;
      settled = true;
      unsubscribe?.();
      source.close();
      resolve(outcome);
    };
    unsubscribe = source.subscribe(agent.streamId, handle);
  });
}

/** Fetch the agent, print a header, and watch it (the command body). */
async function runWatch(
  agentId: string,
  until: UntilCondition,
  json: boolean,
  flags: CliFlags,
): Promise<void> {
  const config = await ensureConfig(flags);
  if (!config) return;
  configureClient(config);
  const agent = (await getAgent(agentId)).data;
  if (!json) {
    console.log(`● ${agent.name} · ${agent.agentType} · ${colorStatus(agent.status)}`);
  }
  const outcome = await watchAgent(agent, { until, json, source: liveStreamSource() });
  process.exitCode = outcome === 'error' ? 1 : 0;
}

function addWatchCommand(parent: Command, recordName: string, ctx: RegisterContext): void {
  const cmd = parent
    .command('watch <agent>')
    .description('stream the agent transcript; exits when the turn completes');
  ctx.addCommonOptions(cmd);
  cmd
    .option('--json', 'print stream events as NDJSON, one JSON event per line')
    .option('--until <condition>', 'when to exit: done, pr, or forever', 'done')
    .addHelpText(
      'after',
      `
Prints the full history first, then follows live events. Exit code 0 when
the condition is met, 1 when the agent errors. Works in pipes; no TTY
needed.`,
    );
  cmd.action((agentId: string, _opts: unknown, c: Command) => {
    const opts = c.optsWithGlobals<{ json?: boolean; until?: string }>();
    const until = parseUntilFlag(opts.until);
    const flags = ctx.legacyFlags(c);
    ctx.record(recordName, flags);
    if (!ctx.execute) return;
    return runWatch(agentId, until, Boolean(opts.json), flags);
  });
}

/** `agents watch <agent>` plus the top-level `watch <agent>` alias. */
export function registerWatchCommands(program: Command, ctx: RegisterContext): void {
  const agents = program.commands.find((c) => c.name() === 'agents');
  if (agents) addWatchCommand(agents, 'agents:watch', ctx);
  addWatchCommand(program, 'watch', ctx);
}
