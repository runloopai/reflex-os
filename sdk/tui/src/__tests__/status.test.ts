import { describe, expect, it } from 'vitest';
import type { Agent } from '@runloop/reflex-client';
import { agentStatusRows, chatHelpRows } from '../chat/status.js';

const NOW = 1_750_000_000_000;

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_1',
    streamId: 'str_1',
    agentType: 'claude-code',
    status: 'running',
    devboxId: 'dbx_1',
    name: 'Fix the build',
    prompt: 'fix it',
    model: 'claude-sonnet-4-5',
    blueprintId: 'bp_1',
    blueprintName: 'reflex',
    createdAt: NOW - 90_000,
    archived: false,
    organizationId: 'org_1',
    ownerId: 'org_1',
    pinned: false,
    ...overrides,
  } as Agent;
}

describe('agentStatusRows', () => {
  it('lists server, identity, runtime, and workstation details in order', () => {
    const rows = agentStatusRows(makeAgent(), {
      serverUrl: 'https://reflex.example.com',
      workstation: 'connected as laptop',
      now: NOW,
    });
    expect(rows).toEqual([
      { label: 'server', value: 'https://reflex.example.com' },
      { label: 'org', value: 'org_1' },
      { label: 'agent', value: 'agt_1' },
      { label: 'type', value: 'claude-code' },
      { label: 'model', value: 'claude-sonnet-4-5' },
      { label: 'status', value: 'running' },
      { label: 'devbox', value: 'dbx_1' },
      { label: 'blueprint', value: 'reflex' },
      { label: 'created', value: '2m ago' },
      { label: 'workstation', value: 'connected as laptop' },
    ]);
  });

  it('omits rows whose value is missing instead of rendering placeholders', () => {
    const rows = agentStatusRows(
      makeAgent({ model: null, devboxId: null, blueprintId: null, blueprintName: null }),
      { serverUrl: null, workstation: null, now: NOW },
    );
    expect(rows.map((row) => row.label)).toEqual(['org', 'agent', 'type', 'status', 'created']);
  });

  it('falls back to the blueprint id when the name is missing', () => {
    const rows = agentStatusRows(makeAgent({ blueprintName: null }), {
      serverUrl: null,
      workstation: null,
      now: NOW,
    });
    expect(rows).toContainEqual({ label: 'blueprint', value: 'bp_1' });
  });
});

describe('chatHelpRows', () => {
  it('documents every slash command the chat composer accepts', () => {
    const labels = chatHelpRows().map((row) => row.label);
    for (const command of [
      '/status',
      '/attach',
      '/detach',
      '/retry',
      '/dismiss',
      '/unqueue',
      '/interrupt',
      '/rename',
    ]) {
      expect(labels.some((label) => label.startsWith(command))).toBe(true);
    }
  });
});
