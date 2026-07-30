import { describe, expect, it } from 'vitest';
import { agentOpenLinks, agentPageUrl, resolveOpenTarget } from '../chat/links.js';
import { UsageError } from '../output/errors.js';

const SERVER = 'https://reflex.example';

describe('agentPageUrl', () => {
  it('builds the agent page URL and tolerates a trailing slash', () => {
    expect(agentPageUrl(SERVER, 'agt_1')).toBe('https://reflex.example/agents/agt_1');
    expect(agentPageUrl(`${SERVER}/`, 'agt_1')).toBe('https://reflex.example/agents/agt_1');
  });
});

describe('agentOpenLinks', () => {
  const pr = {
    url: 'https://github.com/acme/app/pull/7',
    number: 7,
    title: 'Fix the flaky test',
    repo: 'acme/app',
    status: 'open' as const,
  };
  const daemons = [
    { name: 'web', port: 5173, url: 'https://tunnel.example/web', info: 'vite dev server' },
    { name: 'no-url', port: 9999 },
  ];

  it('lists the page, PRs, and daemons with URLs, in order', () => {
    const links = agentOpenLinks(SERVER, 'agt_1', [pr], daemons);
    expect(links.map((l) => l.value)).toEqual([
      'https://reflex.example/agents/agt_1',
      'https://github.com/acme/app/pull/7',
      'https://tunnel.example/web',
    ]);
    expect(links[1].label).toContain('PR #7');
    expect(links[1].hint).toBe('open · acme/app');
    expect(links[2].label).toBe('web :5173');
  });

  it('omits the page without a server URL and daemons without tunnels', () => {
    const links = agentOpenLinks(null, 'agt_1', [], daemons);
    expect(links).toHaveLength(1);
    expect(links[0].value).toBe('https://tunnel.example/web');
  });
});

describe('resolveOpenTarget', () => {
  const agent = {
    id: 'agt_1',
    prUrl: 'https://github.com/acme/app/pull/7',
    daemons: [{ name: 'Web', port: 5173, url: 'https://tunnel.example/web' }],
  };

  it('defaults to the agent page', () => {
    expect(resolveOpenTarget(SERVER, agent)).toEqual({
      url: 'https://reflex.example/agents/agt_1',
      label: 'agent page',
    });
  });

  it('resolves pr to the pull request', () => {
    expect(resolveOpenTarget(SERVER, agent, 'pr').url).toBe('https://github.com/acme/app/pull/7');
  });

  it('errors plainly when there is no PR yet', () => {
    expect(() => resolveOpenTarget(SERVER, { id: 'agt_1' }, 'pr')).toThrow(/no pull request/i);
    expect(() => resolveOpenTarget(SERVER, { id: 'agt_1' }, 'pr')).not.toThrow(UsageError);
  });

  it('matches daemon names case-insensitively', () => {
    expect(resolveOpenTarget(SERVER, agent, 'web')).toEqual({
      url: 'https://tunnel.example/web',
      label: 'Web',
    });
  });

  it('errors when the daemon has no tunnel URL yet', () => {
    const noTunnel = { id: 'agt_1', daemons: [{ name: 'db' }] };
    expect(() => resolveOpenTarget(SERVER, noTunnel, 'db')).toThrow(/no tunnel/i);
  });

  it('rejects unknown targets as usage errors listing the daemons', () => {
    expect(() => resolveOpenTarget(SERVER, agent, 'nope')).toThrow(UsageError);
    expect(() => resolveOpenTarget(SERVER, agent, 'nope')).toThrow(/Web/);
  });
});
