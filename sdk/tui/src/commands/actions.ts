import { readFileSync } from 'node:fs';
import {
  archiveAgent,
  archiveAllAgents,
  completeAgent,
  createAgent,
  createAgentSnapshot,
  enqueueAgentMessage,
  getAgentModelSupport,
  interruptAgent,
  killAgent,
  pinAgent,
  removeQueuedAgentMessage,
  reorderAgentQueue,
  resumeAgent,
  sendAgentMessage,
  stopAgent,
  unarchiveAgent,
  unpinAgent,
  updateAgent,
  updateQueuedAgentMessage,
  type Agent,
} from '@runloop/reflex-client';
import type { CreateAgentBodyEnvVarsItem as AgentEnvVarInput } from '@runloop/reflex-client';
import { buildContentBlocks, type Attachment } from '@runloop/reflex-contract';
import { loadAttachment } from '../attachments.js';
import { buildLaunchPayload, type LaunchSelections } from '../launch/options.js';
import { UsageError } from '../output/errors.js';
import type { CommandGroup } from './define.js';

/**
 * Mutating agent commands, declared through the same helper as the reads
 * (see define.ts). Destructive ones (`kill`, `archive-all`, `snapshot`)
 * declare a `confirm` gate: y/N on a TTY, `--yes` required in scripts.
 */

/** Message from the positional arg, else stdin (pipes compose naturally). */
function resolveMessage(arg: string | undefined): string {
  if (arg !== undefined && arg.trim() !== '') return arg;
  if (process.stdin.isTTY) {
    throw new UsageError('Provide a message: `agents send <agent> "text"` (or pipe it on stdin).');
  }
  const piped = readFileSync(0, 'utf8').trim();
  if (piped === '') throw new UsageError('The piped message is empty.');
  return piped;
}

/** Load every `--attach` path into an inline attachment (shared with `run`). */
export async function loadAttachments(opts: Record<string, unknown>): Promise<Attachment[]> {
  const paths = Array.isArray(opts.attach) ? (opts.attach as string[]) : [];
  return Promise.all(paths.map((path) => loadAttachment(path)));
}

const ATTACH_OPTION = {
  flags: '--attach <path>',
  description: 'attach a file (repeatable); sent as content blocks like the web composer',
};

/** The launch flag set, shared verbatim by `agents launch` and `run`. */
export const LAUNCH_OPTIONS = [
  { flags: '-p, --prompt <text>', description: 'the initial prompt (required)' },
  { flags: '--repo <owner/repo[#branch]>', description: 'git repo to attach' },
  { flags: '--type <agentType>', description: 'agent type (default: org default)' },
  { flags: '--model <model>', description: 'model override' },
  { flags: '--name <name>', description: 'display name' },
  { flags: '--system-prompt <text>', description: 'system prompt' },
  { flags: '--blueprint <name>', description: 'Blueprint to boot from' },
  { flags: '--snapshot <id>', description: 'snapshot to boot from (replaces Blueprint)' },
  { flags: '--size <size>', description: 'devbox resource size (SMALL … XX_LARGE)' },
  { flags: '--env <KEY=VALUE>', description: 'environment variable (repeatable)' },
  ATTACH_OPTION,
];

function collectRepeatable(): { flags: string; description: string }[] {
  return [ATTACH_OPTION];
}

/** `owner/repo[#branch]` → slug + branch. */
export function parseRepoFlag(repo: string): { repoSlug: string; repoBranch?: string } {
  const [slug, branch] = repo.split('#', 2);
  if (!/^[^/\s]+\/[^/\s]+$/.test(slug)) {
    throw new UsageError(`--repo expects owner/repo[#branch], got: ${repo}`);
  }
  return { repoSlug: slug, ...(branch ? { repoBranch: branch } : {}) };
}

/** Flag-driven launch selections; the TUI wizard covers the guided path. */
export async function selectionsFromFlags(
  opts: Record<string, unknown>,
  attachments: Attachment[],
): Promise<LaunchSelections> {
  const prompt = typeof opts.prompt === 'string' ? opts.prompt : undefined;
  if (!prompt?.trim()) {
    throw new UsageError(
      'Provide a prompt: `agents launch -p "..."`. For the guided flow, run the TUI and press n.',
    );
  }
  let agentType = typeof opts.type === 'string' ? opts.type : undefined;
  if (!agentType) {
    // Same default the launch wizard picks: the org's configured agent type.
    const support = (await getAgentModelSupport()).data;
    agentType = support.defaultAgentType ?? undefined;
    if (!agentType) throw new UsageError('No default agent type configured; pass --type.');
  }
  const envVars: AgentEnvVarInput[] = [];
  for (const pair of Array.isArray(opts.env) ? (opts.env as string[]) : []) {
    const eq = pair.indexOf('=');
    if (eq <= 0) throw new UsageError(`--env expects KEY=VALUE, got: ${pair}`);
    envVars.push({ key: pair.slice(0, eq), value: pair.slice(eq + 1) });
  }
  return {
    agentType,
    prompt,
    ...(typeof opts.name === 'string' ? { name: opts.name } : {}),
    ...(typeof opts.model === 'string' ? { model: opts.model } : {}),
    ...(typeof opts.systemPrompt === 'string' ? { systemPrompt: opts.systemPrompt } : {}),
    ...(typeof opts.repo === 'string' ? parseRepoFlag(opts.repo) : {}),
    ...(typeof opts.blueprint === 'string' ? { blueprintName: opts.blueprint } : {}),
    ...(typeof opts.snapshot === 'string' ? { snapshotId: opts.snapshot } : {}),
    ...(typeof opts.size === 'string'
      ? { resourceSize: opts.size as LaunchSelections['resourceSize'] }
      : {}),
    ...(envVars.length > 0 ? { envVars } : {}),
    ...(attachments.length > 0 ? { inlineAttachments: attachments } : {}),
  };
}

/** One-line acknowledgement for a simple agent action. */
function ack(verb: string): (data: unknown, args: string[]) => string {
  return (_data, [id]) => `${verb} ${id}.`;
}

export function actionCommandGroups(): CommandGroup[] {
  return [
    {
      noun: 'agents',
      summary: 'browse, inspect, and drive agent runs',
      commands: [
        {
          name: 'launch',
          summary: 'launch a new agent run (flag-driven; the TUI has the guided wizard)',
          options: LAUNCH_OPTIONS,
          fetch: async (_args, opts) => {
            const attachments = await loadAttachments(opts);
            const selections = await selectionsFromFlags(opts, attachments);
            return (await createAgent(buildLaunchPayload(selections))).data;
          },
          render: (data) => {
            const agent = data as Agent;
            return [
              `Launched ${agent.id} (${agent.name}).`,
              'The devbox provisions in the background; follow it with:',
              `  reflex-cli agents show ${agent.id}`,
            ].join('\n');
          },
        },
        {
          name: 'send <agent> [message]',
          summary: 'send a message to the agent (queued automatically mid-turn)',
          options: collectRepeatable(),
          fetch: async ([id, message], opts) => {
            const text = resolveMessage(message);
            const attachments = await loadAttachments(opts);
            const body =
              attachments.length > 0
                ? { content: buildContentBlocks(text, attachments) }
                : { message: text };
            return (await sendAgentMessage(id, body)).data;
          },
          render: (_data, [id]) => `Sent to ${id}.`,
        },
        {
          name: 'interrupt <agent>',
          summary: "interrupt the agent's current turn",
          fetch: async ([id]) => (await interruptAgent(id)).data,
          render: ack('Interrupted'),
        },
        {
          name: 'stop <agent>',
          summary: 'stop the run and shut down its devbox (the agent is kept)',
          fetch: async ([id]) => (await stopAgent(id)).data,
          render: ack('Stopped'),
        },
        {
          name: 'resume <agent>',
          summary: 'resume a suspended agent',
          fetch: async ([id]) => (await resumeAgent(id)).data,
          render: ack('Resumed'),
        },
        {
          name: 'complete <agent>',
          summary: 'mark the run complete',
          fetch: async ([id]) => (await completeAgent(id)).data,
          render: ack('Completed'),
        },
        {
          name: 'kill <agent>',
          summary: 'kill the run and discard its devbox',
          confirm: ([id]) => `Kill ${id} and discard its devbox?`,
          fetch: async ([id]) => (await killAgent(id)).data,
          render: ack('Killed'),
        },
        {
          name: 'archive <agent>',
          summary: 'archive the agent',
          fetch: async ([id]) => (await archiveAgent(id)).data,
          render: ack('Archived'),
        },
        {
          name: 'unarchive <agent>',
          summary: 'restore an archived agent',
          fetch: async ([id]) => (await unarchiveAgent(id)).data,
          render: ack('Unarchived'),
        },
        {
          name: 'archive-all',
          summary: 'archive every non-pinned agent',
          confirm: () => 'Archive every non-pinned agent in the org?',
          fetch: async () => (await archiveAllAgents({})).data,
          render: (data) => {
            const { archived } = data as { archived?: number };
            return archived === undefined ? 'Archived.' : `Archived ${archived} agent(s).`;
          },
        },
        {
          name: 'pin <agent>',
          summary: 'pin the agent to the top of the list',
          fetch: async ([id]) => (await pinAgent(id)).data,
          render: ack('Pinned'),
        },
        {
          name: 'unpin <agent>',
          summary: 'unpin the agent',
          fetch: async ([id]) => (await unpinAgent(id)).data,
          render: ack('Unpinned'),
        },
        {
          name: 'rename <agent> <name>',
          summary: 'rename the agent',
          fetch: async ([id, name]) => (await updateAgent(id, { name })).data,
          render: (_data, [id, name]) => `Renamed ${id} to "${name}".`,
        },
        {
          name: 'snapshot <agent>',
          summary: 'save the devbox as a snapshot; this ends the run',
          options: [{ flags: '--name <name>', description: 'snapshot name (required)' }],
          confirm: ([id]) =>
            `Snapshot ${id}? This strips per-run state, ends the run, and shuts down the devbox.`,
          fetch: async ([id], opts) => {
            if (typeof opts.name !== 'string' || opts.name.trim() === '') {
              throw new UsageError('Snapshots need a name: --name <name>.');
            }
            return (await createAgentSnapshot(id, { name: opts.name })).data;
          },
          render: (_data, [id]) =>
            `Snapshot started for ${id}. Track it with \`reflex-cli snapshots list\`.`,
        },
      ],
    },
    {
      noun: 'agents queue',
      summary: "manage the agent's queued messages",
      commands: [
        {
          name: 'add <agent> [message]',
          summary: 'queue a message for the next turn',
          fetch: async ([id, message]) =>
            (await enqueueAgentMessage(id, { text: resolveMessage(message) })).data,
          render: (_data, [id]) => `Queued for ${id}.`,
        },
        {
          name: 'edit <agent> <msgId> <text>',
          summary: 'rewrite a queued message',
          fetch: async ([id, msgId, text]) =>
            (await updateQueuedAgentMessage(id, msgId, { text })).data,
          render: () => 'Updated.',
        },
        {
          name: 'rm <agent> <msgId>',
          summary: 'remove a queued message',
          fetch: async ([id, msgId]) => (await removeQueuedAgentMessage(id, msgId)).data,
          render: () => 'Removed.',
        },
        {
          name: 'reorder <agent> <msgIds...>',
          summary: 'reorder the queue (every message id, in the new order)',
          fetch: async (args) => {
            const [id, ...orderedIds] = args;
            return (await reorderAgentQueue(id, { orderedIds })).data;
          },
          render: () => 'Reordered.',
        },
      ],
    },
  ];
}
