/**
 * Manual smoke render: drives the ChatScreen against a fake socket that
 * replays a representative event stream (setup, tools, streaming, a question,
 * a permission request), so the layout can be eyeballed without a server.
 * `--launch` instead renders the launch wizard against a stub catalog API, and
 * `--markdown` renders a representative agent Markdown answer to eyeball the
 * renderer (headings, lists, tables, code, quotes).
 *
 * Run: pnpm exec tsx scripts/render-smoke.tsx [--question|--permission|--idle|--stream|--list|--launch|--markdown]
 */
import { createServer } from 'node:http';
import React from 'react';
import { Box, render, Text } from 'ink';
import { configureReflex, type Agent, type ReflexSocket, type ReflexStreamEvent } from '@runloop/reflex-client';
import { AgentListScreen } from '../src/ui/AgentListScreen.js';
import { ChatScreen } from '../src/ui/ChatScreen.js';
import { LaunchScreen } from '../src/ui/LaunchScreen.js';
import { Markdown } from '../src/ui/Markdown.js';

const scenario = process.argv[2] ?? '--question';

if (scenario === '--list') {
  // Agent list with the states worth eyeballing: pinned-first ordering, the
  // needs_input/error attention colors, the `/` filter, and the update notice.
  const now = Date.now();
  const listAgent = (over: Partial<Agent>): Agent =>
    ({
      streamId: 'str_x',
      agentType: 'claude-code',
      status: 'running',
      prompt: '',
      createdAt: now - 3_600_000,
      archived: false,
      organizationId: 'org_demo',
      pinned: false,
      ...over,
    }) as Agent;
  render(
    React.createElement(AgentListScreen, {
      agents: [
        listAgent({ id: 'agt_1', name: 'Fix flaky auth test', status: 'needs_input', lastActiveAt: now - 60_000 }),
        listAgent({ id: 'agt_2', name: 'Nightly dependency audit', pinned: true, lastActiveAt: now - 7_200_000 }),
        listAgent({ id: 'agt_3', name: 'Migrate billing webhooks', status: 'error', lastActiveAt: now - 300_000 }),
        listAgent({ id: 'agt_4', name: 'Refactor the settings page', status: 'completed', agentType: 'opencode', lastActiveAt: now - 86_400_000 }),
        listAgent({ id: 'agt_5', name: 'Write release notes', lastActiveAt: now - 30_000 }),
        listAgent({ id: 'agt_6', name: 'Spike: PGLite migration', status: 'completed', archived: true, lastActiveAt: now - 950_400_000 }),
      ],
      loading: false,
      error: null,
      update: { current: '0.1.0', latest: '0.2.0' },
      onOpen: () => process.exit(0),
      onLaunch: () => process.exit(0),
      onTogglePin: () => {},
      onToggleArchive: () => {},
      onRefresh: () => {},
      onUpdate: () => process.exit(0),
      onQuit: () => process.exit(0),
    }),
  );
}

if (scenario === '--launch') {
  // Stub just enough of the catalog surface for the wizard's fetches.
  const routes: Record<string, unknown> = {
    '/api/config/agent-model-support': {
      defaultAgentType: 'claude-code',
      agents: {
        opencode: {
          status: 'available',
          agentType: 'opencode',
          displayName: 'OpenCode',
          providers: [],
          endpoints: [],
          providerEndpoints: [],
          defaultEndpoint: 'ep',
          defaultModel: 'gpt-5',
          discovery: { method: 'static' },
          discoveredModels: [
            { id: 'gpt-5', displayName: 'GPT-5', providerId: 'openai' },
            { id: 'grok-code', displayName: 'Grok Code Fast', providerId: 'xai' },
          ],
        },
      },
      launchableAgents: [
        { agentType: 'claude-code', displayName: 'Claude Code', multiModel: false, enabled: true },
        { agentType: 'opencode', displayName: 'OpenCode', multiModel: true, enabled: true },
      ],
    },
    '/api/blueprints': [
      {
        id: 'bp_1',
        name: 'reflex',
        status: 'build_complete',
        createTimeMs: 2,
        metadata: { repo: 'runloopai/reflex' },
      },
      { id: 'bp_2', name: 'base', status: 'build_complete', createTimeMs: 1, metadata: {} },
    ],
    '/api/snapshots': [
      { id: 'snap_1', name: 'after-setup', createTimeMs: 3, sourceDevboxId: 'dbx_1' },
    ],
    '/api/workstations': { workstations: [] },
  };
  const server = createServer((req, res) => {
    const body = routes[(req.url ?? '').split('?')[0]];
    res.setHeader('content-type', 'application/json');
    if (body === undefined) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    res.end(JSON.stringify(body));
  });
  server.listen(0, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    configureReflex({
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: 'rfx_smoke',
      organizationId: 'org_smoke',
    });
    render(
      React.createElement(LaunchScreen, {
        defaultAgentType: 'claude-code',
        onLaunched: () => process.exit(0),
        onCancel: () => process.exit(0),
      }),
    );
  });
}

if (scenario === '--markdown') {
  const sample = [
    '## Overall',
    '',
    'The production database is **small and healthy** — `182 MB` total with no',
    'connection pressure. A couple of tables carry _significant_ bloat.',
    '',
    '### Biggest tables by size',
    '',
    '| Table | Total Size | Live Rows | Dead Rows |',
    '|---|---|---|---|',
    '| flow_run_nodes | 71 MB | 68 | 76 |',
    '| flow_runs | 65 MB | 23 | 20 |',
    '| agents | 8.7 MB | 9 | 13 |',
    '',
    '### Notable observations',
    '',
    '- `flow_run_nodes` and `flow_runs` dominate storage but have few live rows —',
    '  a `VACUUM ANALYZE` on those two would help.',
    '- `slack_pending_starts` is ~7 MB with **0 live rows** — pure bloat.',
    '- One duplicate-key error was logged, likely a seed script missing',
    '  `ON CONFLICT DO NOTHING`.',
    '',
    'Next steps:',
    '',
    '1. Vacuum the bloated tables.',
    '2. Fix the seed script.',
    '',
    '```sql',
    'VACUUM (ANALYZE) flow_run_nodes;',
    '```',
    '',
    '```ts',
    '// prune rows older than the cutoff',
    'const cutoff = Date.now() - 30 * 86_400_000;',
    'if (rows.length > 0) return `pruned ${rows.length}`;',
    '```',
    '',
    '> Run during low traffic — a full vacuum takes a table lock.',
  ].join('\n');
  render(
    React.createElement(
      Box,
      { flexDirection: 'column', paddingX: 1 },
      React.createElement(
        Box,
        { gap: 1, marginTop: 1 },
        React.createElement(Text, { color: 'white' }, '●'),
        React.createElement(Box, { flexGrow: 1 }, React.createElement(Markdown, null, sample)),
      ),
    ),
  );
  process.exit(0);
}

let seq = 0;
function event(type: string, payload: unknown, origin?: string): ReflexStreamEvent {
  seq += 1;
  return {
    id: `evt_${seq}`,
    streamId: 'str_demo',
    type,
    payload,
    timestamp: Date.now() - (100 - seq) * 1000,
    ...(origin ? { origin } : {}),
  };
}

const events: ReflexStreamEvent[] = [
  event('agent.setup', {
    step: 'init',
    detail: JSON.stringify([
      { id: 'creating_devbox', label: 'Provision devbox' },
      { id: 'code_server', label: 'code-server' },
      { id: 'agent_launch', label: 'Launch agent' },
    ]),
  }),
  event('agent.setup', { step: 'creating_devbox', durationMs: 9200 }),
  event('agent.setup', { step: 'code_server', terminal: false }),
  event('agent.setup', { step: 'code_server' }),
  event('agent.setup', { step: 'agent_launch' }),
  event('turn.claude.system', {
    subtype: 'init',
    model: 'claude-sonnet-4-5',
    claude_code_version: '2.0.14',
    cwd: '/home/user/repo',
    permissionMode: 'default',
    tools: new Array(18).fill('t'),
  }),
  event('query', { message: { role: 'user', content: 'analyze process memory usage' } }),
  event('turn.started', {}),
  event('turn.claude.assistant', {
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Let me check what is running first.' },
        { type: 'text', text: 'On it — checking running processes and their memory.' },
        { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ps aux --sort=-rss | head -12' } },
      ],
    },
  }),
  event('turn.claude.user', {
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu1',
          content: 'USER PID %CPU %MEM RSS COMMAND\nroot 1 0.0 0.4 12040 systemd\nuser 231 3.1 12.9 412300 node dist/main.js\nuser 410 1.2 8.1 260112 postgres\nuser 511 0.4 2.2 71000 sshd\nuser 512 0.1 1.0 30000 bash',
        },
      ],
    },
  }),
  event('turn.claude.assistant', {
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'todo',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Snapshot per-process RSS', status: 'completed' },
              { content: 'Summarize top consumers', status: 'in_progress' },
              { content: 'Write report to memory-report.md', status: 'pending' },
            ],
          },
        },
      ],
    },
  }),
];

if (scenario === '--question') {
  events.push(
    event('turn.claude.control_request', {
      request_id: 'req_q',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        tool_use_id: 'tu_q',
        input: {
          questions: [
            {
              header: 'Report scope',
              question: 'Which processes should the report focus on?',
              multiSelect: true,
              options: [
                { label: 'Node services', description: 'the reflex server and workers' },
                { label: 'Databases', description: 'postgres and friends' },
                { label: 'Everything', description: 'full system table' },
              ],
            },
            {
              header: 'Format',
              question: 'What output format do you want?',
              multiSelect: false,
              options: [{ label: 'Markdown' }, { label: 'CSV' }],
            },
          ],
        },
      },
    }),
  );
} else if (scenario === '--permission') {
  events.push(
    event('turn.claude.control_request', {
      request_id: 'req_p',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        tool_use_id: 'tu_p',
        input: { command: 'sudo dmesg | tail -50' },
      },
    }),
  );
} else if (scenario === '--idle') {
  // Finished turn: the composer is active, so typed messages exercise the
  // optimistic pending-send path (the POST fails in this offline harness,
  // which renders the failed bubble with the /retry hint). PR + daemon
  // events populate the ^o open palette.
  events.push(
    event('turn.claude.assistant', {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Node is the top consumer at 412 MB RSS.' }],
      },
    }),
    event('agent.pr_created', {
      agentId: 'agt_demo',
      url: 'https://github.com/runloopai/reflex/pull/2196',
      number: 2196,
      title: 'feat(tui): rebuild agent chat',
      repo: 'runloopai/reflex',
      branch: 'feat/tui-chat-parity',
    }),
    event('agent.daemon_started', { agentId: 'agt_demo', name: 'memory-dash', port: 4173 }),
    event('turn.claude.result', { is_error: false, result: '' }),
    event('turn.completed', {}),
  );
} else {
  events.push(
    event('turn.claude.stream_event', {
      event: { type: 'content_block_start', content_block: { type: 'text' } },
    }),
    event('turn.claude.stream_event', {
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Node is the top consumer at 412 MB RSS…' },
      },
    }),
  );
}

const agent: Agent = {
  id: 'agt_demo',
  name: 'Analyze and Report Process Memory Usage',
  agentType: 'claude-code',
  status: 'running',
  streamId: 'str_demo',
  daemons: [
    {
      name: 'memory-dash',
      port: 4173,
      url: 'https://4173-dbx-demo.tunnel.example.com',
      info: 'vite preview',
      startedAt: Date.now(),
    },
  ],
} as unknown as Agent;

const socket = {
  subscribe(_streamId: string, handler: (event: ReflexStreamEvent) => void) {
    let i = 0;
    const timer = setInterval(() => {
      if (i >= events.length) {
        clearInterval(timer);
        return;
      }
      handler(events[i++]);
    }, 120);
    return () => clearInterval(timer);
  },
  onMessage() {
    return () => {};
  },
} as unknown as ReflexSocket;

if (scenario !== '--launch' && scenario !== '--list') {
  render(
    React.createElement(ChatScreen, {
      agent,
      socket,
      onBack: () => process.exit(0),
    }),
  );
}
