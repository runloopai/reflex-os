import type { PickOption } from '../launch/options.js';
import { UsageError } from '../output/errors.js';
import { clip } from './format.js';
import type { PrLink } from './transcript.js';

/**
 * Everything about an agent that opens in a browser: its web page, pull
 * requests it opened, and daemons serving on its devbox (tunnel URLs).
 * Pure URL building, shared by the TUI's ctrl+o palette and the `open`
 * command so the two can never disagree.
 */

/** Structural subset of the generated `Agent.daemons` entry. */
export interface DaemonLink {
  name: string;
  port?: number | null;
  url?: string | null;
  info?: string | null;
}

export function agentPageUrl(serverUrl: string, agentId: string): string {
  // Trim trailing slashes without a backtracking regex (js/polynomial-redos).
  let base = serverUrl;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}/agents/${agentId}`;
}

/** Options for the ctrl+o open palette, in display order. */
export function agentOpenLinks(
  serverUrl: string | null,
  agentId: string,
  prs: readonly PrLink[],
  daemons: readonly DaemonLink[] | null | undefined,
): PickOption[] {
  const links: PickOption[] = [];
  if (serverUrl) links.push({ value: agentPageUrl(serverUrl, agentId), label: 'Agent page' });
  for (const pr of prs) {
    links.push({
      value: pr.url,
      label: `PR #${pr.number} ${clip(pr.title, 48)}`,
      hint: [pr.status, pr.repo].filter(Boolean).join(' · '),
    });
  }
  for (const daemon of daemons ?? []) {
    if (!daemon.url) continue;
    links.push({
      value: daemon.url,
      label: `${daemon.name}${daemon.port ? ` :${daemon.port}` : ''}`,
      hint: daemon.info ?? 'daemon',
    });
  }
  return links;
}

/** The agent fields the `open` command's target resolution needs. */
export interface OpenableAgent {
  id: string;
  prUrl?: string | null;
  daemons?: readonly DaemonLink[] | null;
}

/**
 * Resolve `open <agent> [target]` to a URL: no target is the agent's web
 * page, `pr` is its most recent pull request, and any other target must
 * match a daemon name (its tunnel URL). Unknown targets are usage errors;
 * a known target without a URL yet is a plain error (exit 1).
 */
export function resolveOpenTarget(
  serverUrl: string,
  agent: OpenableAgent,
  target?: string,
): { url: string; label: string } {
  if (!target) return { url: agentPageUrl(serverUrl, agent.id), label: 'agent page' };
  if (target === 'pr') {
    if (!agent.prUrl) throw new Error(`No pull request on ${agent.id} yet.`);
    return { url: agent.prUrl, label: 'pull request' };
  }
  const daemons = agent.daemons ?? [];
  const daemon = daemons.find((d) => d.name.toLowerCase() === target.toLowerCase());
  if (daemon) {
    if (!daemon.url) throw new Error(`Daemon ${daemon.name} has no tunnel URL yet.`);
    return { url: daemon.url, label: daemon.name };
  }
  const names = daemons.map((d) => d.name);
  throw new UsageError(
    `Unknown target: ${target}. Use pr for the pull request` +
      (names.length > 0 ? `, or a daemon name (${names.join(', ')})` : '') +
      '; omit the target for the agent page.',
  );
}
