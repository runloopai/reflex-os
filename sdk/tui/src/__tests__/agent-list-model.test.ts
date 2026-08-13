import { describe, expect, it } from 'vitest';
import type { Agent } from '@runloop/reflex-client';
import { filterAgents, listLayout, orderAgents } from '../ui/agent-list-model.js';

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: 'agt_1',
    streamId: 'str_1',
    agentType: 'claude-code',
    status: 'running',
    devboxId: null,
    name: 'agent',
    prompt: '',
    createdAt: 1,
    archived: false,
    organizationId: 'org_1',
    ownerId: 'org_1',
    pinned: false,
    ...overrides,
  } as Agent;
}

const agents = [
  makeAgent({ id: 'a', name: 'Fix the build', status: 'running' }),
  makeAgent({ id: 'b', name: 'Write release notes', status: 'needs_input' }),
  makeAgent({ id: 'c', name: 'Build the dashboard', agentType: 'opencode', status: 'completed' }),
];

describe('filterAgents', () => {
  it('returns everything for an empty or blank query', () => {
    expect(filterAgents(agents, '')).toEqual(agents);
    expect(filterAgents(agents, '   ')).toEqual(agents);
  });

  it('matches name case-insensitively', () => {
    expect(filterAgents(agents, 'BUILD').map((a) => a.id)).toEqual(['a', 'c']);
  });

  it('matches status and agent type', () => {
    expect(filterAgents(agents, 'needs_input').map((a) => a.id)).toEqual(['b']);
    expect(filterAgents(agents, 'opencode').map((a) => a.id)).toEqual(['c']);
  });

  it('requires every term to match, in any order', () => {
    expect(filterAgents(agents, 'build running').map((a) => a.id)).toEqual(['a']);
    expect(filterAgents(agents, 'running build').map((a) => a.id)).toEqual(['a']);
    expect(filterAgents(agents, 'build missing')).toEqual([]);
  });
});

describe('orderAgents', () => {
  it('floats pinned agents to the top, keeping order within each group', () => {
    const mixed = [
      makeAgent({ id: 'a' }),
      makeAgent({ id: 'b', pinned: true }),
      makeAgent({ id: 'c' }),
      makeAgent({ id: 'd', pinned: true }),
    ];
    expect(orderAgents(mixed).map((a) => a.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('does not mutate the input', () => {
    const mixed = [makeAgent({ id: 'a' }), makeAgent({ id: 'b', pinned: true })];
    orderAgents(mixed);
    expect(mixed.map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('listLayout', () => {
  /** Columns a row consumes: fixed overhead + optional type + name. */
  const rowWidth = (layout: ReturnType<typeof listLayout>) =>
    27 + (layout.showType ? 15 : 0) + layout.nameWidth;

  it('fits a row within the terminal at common widths', () => {
    for (const columns of [70, 80, 100, 120]) {
      expect(rowWidth(listLayout(columns, 40))).toBeLessThanOrEqual(columns);
    }
  });

  it('drops the type column before shrinking the name below readable', () => {
    const narrow = listLayout(70, 40);
    expect(narrow.showType).toBe(false);
    expect(narrow.nameWidth).toBeGreaterThanOrEqual(16);
    const wide = listLayout(120, 40);
    expect(wide.showType).toBe(true);
    expect(wide.nameWidth).toBe(44);
  });

  it('scales visible rows with terminal height, clamped', () => {
    expect(listLayout(100, 20).visibleRows).toBe(12);
    expect(listLayout(100, 10).visibleRows).toBe(5);
    expect(listLayout(100, 60).visibleRows).toBe(30);
  });
});
