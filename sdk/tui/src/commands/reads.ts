import {
  getAgent,
  listOrganizations,
  getProfileStats,
  getRecentActivity,
  listAgents,
  listBlueprints,
  listPersonalApiKeys,
  listSnapshots,
  reflexRequest,
  ListAgentsArchived,
  ListAgentsPinned,
  type Agent,
  type Blueprint,
  type ListAgentsParams,
  type Snapshot,
} from '@runloop/reflex-client';
import type { Workstation } from '@runloop/reflex-workstation';
import { colorStatus, formatRelativeTime, renderKv, renderTable } from '../output/table.js';
import type { CommandGroup } from './define.js';

/**
 * The read surface, as declarations (see define.ts). Every command returns
 * the response data for `--json` and renders a table or key-value block for
 * humans. Mutating commands land in later slices.
 */

function agentRow(agent: Agent): Record<string, string> {
  return {
    id: agent.id,
    name: agent.name,
    status: colorStatus(agent.status),
    type: agent.agentType,
    age: formatRelativeTime(agent.createdAt),
  };
}

const AGENT_COLUMNS = [
  { key: 'id', header: 'id' },
  { key: 'name', header: 'name' },
  { key: 'status', header: 'status' },
  { key: 'type', header: 'type' },
  { key: 'age', header: 'age' },
];

export function readCommandGroups(): CommandGroup[] {
  return [
    {
      noun: 'agents',
      summary: 'browse, inspect, and drive agent runs',
      commands: [
        {
          name: 'list',
          summary: 'list the agents in the active organization',
          options: [
            { flags: '--archived', description: 'archived agents instead of active ones' },
            { flags: '--pinned', description: 'only pinned agents' },
            { flags: '--search <text>', description: 'filter by name' },
            { flags: '--limit <n>', description: 'page size' },
            { flags: '--cursor <cursor>', description: 'page cursor from a previous call' },
          ],
          fetch: async (_args, opts) => {
            const params: ListAgentsParams = {
              ...(opts.archived ? { archived: ListAgentsArchived.true } : {}),
              ...(opts.pinned ? { pinned: ListAgentsPinned.true } : {}),
              ...(typeof opts.search === 'string' ? { search: opts.search } : {}),
              ...(typeof opts.limit === 'string' ? { limit: Number(opts.limit) } : {}),
              ...(typeof opts.cursor === 'string' ? { cursor: opts.cursor } : {}),
            };
            return (await listAgents(params)).data;
          },
          render: (data) => {
            const { agents, nextCursor } = data as { agents: Agent[]; nextCursor: string | null };
            const table = renderTable(AGENT_COLUMNS, agents.map(agentRow));
            return nextCursor
              ? `${table}\n(more: --cursor ${nextCursor})`
              : agents.length
                ? table
                : 'No agents.';
          },
        },
        {
          name: 'show <agent>',
          summary: 'show one agent run in full',
          fetch: async ([id]) => (await getAgent(id)).data,
          render: (data) => {
            const agent = data as Agent;
            return renderKv([
              ['id', agent.id],
              ['name', agent.name],
              ['status', colorStatus(agent.status)],
              ['type', agent.agentType],
              ['model', agent.model ?? undefined],
              ['devbox', agent.devboxId ?? undefined],
              ['blueprint', agent.blueprintName ?? agent.blueprintId ?? undefined],
              ['created', formatRelativeTime(agent.createdAt)],
              [
                'last active',
                agent.lastActiveAt ? formatRelativeTime(agent.lastActiveAt) : undefined,
              ],
              ['archived', agent.archived ? 'yes' : undefined],
              ['prompt', agent.prompt],
            ]);
          },
        },
      ],
    },
    {
      noun: 'blueprints',
      summary: 'inspect the org’s repo images',
      commands: [
        {
          name: 'list',
          summary: 'list the org’s blueprints',
          fetch: async () => (await listBlueprints()).data,
          render: (data) => {
            const blueprints = data as Blueprint[];
            if (!blueprints.length) return 'No blueprints.';
            return renderTable(
              [
                { key: 'id', header: 'id' },
                { key: 'name', header: 'name' },
                { key: 'status', header: 'status' },
                { key: 'age', header: 'age' },
              ],
              blueprints.map((bp) => ({
                id: bp.id,
                name: bp.name,
                status: colorStatus(bp.status),
                age: formatRelativeTime(bp.createTimeMs),
              })),
            );
          },
        },
      ],
    },
    {
      noun: 'snapshots',
      summary: 'inspect saved devbox snapshots',
      commands: [
        {
          name: 'list',
          summary: 'list the org’s devbox snapshots',
          fetch: async () => (await listSnapshots()).data,
          render: (data) => {
            const snapshots = data as Snapshot[];
            if (!snapshots.length) return 'No snapshots.';
            return renderTable(
              [
                { key: 'id', header: 'id' },
                { key: 'name', header: 'name' },
                { key: 'source', header: 'source agent' },
                { key: 'age', header: 'age' },
              ],
              snapshots.map((snap) => ({
                id: snap.id,
                name: snap.name,
                source: snap.sourceAgentName ?? snap.sourceAgentId ?? '',
                age: formatRelativeTime(snap.createTimeMs),
              })),
            );
          },
        },
      ],
    },
    {
      noun: 'orgs',
      summary: 'inspect the organizations you belong to',
      commands: [
        {
          name: 'list',
          summary: 'list your organizations',
          fetch: async () => (await listOrganizations()).data,
          render: (data) => {
            const { organizations } = data as {
              organizations: {
                organization: { id: string; slug: string; name: string; isPersonal: boolean };
                roles: { name: string }[];
              }[];
            };
            return renderTable(
              [
                { key: 'id', header: 'id' },
                { key: 'slug', header: 'slug' },
                { key: 'name', header: 'name' },
                { key: 'roles', header: 'roles' },
              ],
              organizations.map(({ organization: org, roles }) => ({
                id: org.id,
                slug: org.slug,
                name: org.isPersonal ? `${org.name} (personal)` : org.name,
                roles: roles.map((role) => role.name).join(', '),
              })),
            );
          },
        },
      ],
    },
    {
      noun: 'keys',
      summary: 'inspect your personal API keys',
      commands: [
        {
          name: 'list',
          summary: 'list your personal API keys',
          fetch: async () => (await listPersonalApiKeys()).data,
          render: (data) => {
            const { keys } = data as {
              keys: {
                id: string;
                name: string;
                tokenPrefix: string;
                createdAt: number;
                lastUsedAt: number | null;
              }[];
            };
            if (!keys.length) return 'No API keys.';
            return renderTable(
              [
                { key: 'id', header: 'id' },
                { key: 'name', header: 'name' },
                { key: 'prefix', header: 'token' },
                { key: 'created', header: 'created' },
                { key: 'used', header: 'last used' },
              ],
              keys.map((key) => ({
                id: key.id,
                name: key.name,
                prefix: `${key.tokenPrefix}…`,
                created: formatRelativeTime(key.createdAt),
                used: key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : 'never',
              })),
            );
          },
        },
      ],
    },
    {
      noun: 'workstations',
      summary: 'inspect connected workstations',
      commands: [
        {
          name: 'list',
          summary: 'list the workstations connected to the org',
          fetch: async () => {
            // Plugin-contributed route: not in the generated client, same
            // transport (see src/client.ts).
            return reflexRequest<{ workstations: Workstation[] }>('/workstations');
          },
          render: (data) => {
            const { workstations } = data as { workstations: Workstation[] };
            if (!workstations.length) return 'No workstations connected.';
            return renderTable(
              [
                { key: 'id', header: 'id' },
                { key: 'name', header: 'name' },
                { key: 'status', header: 'status' },
              ],
              workstations.map((ws) => ({
                id: ws.id,
                name: ws.name,
                status: colorStatus(ws.status),
              })),
            );
          },
        },
      ],
    },
    {
      noun: '',
      summary: '',
      commands: [
        {
          name: 'activity',
          summary: 'show recent activity across the org',
          fetch: async () => (await getRecentActivity()).data,
        },
        {
          name: 'stats',
          summary: 'show your profile stats',
          fetch: async () => (await getProfileStats()).data,
        },
      ],
    },
  ];
}
