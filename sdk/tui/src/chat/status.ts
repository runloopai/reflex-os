import type { Agent } from '@runloop/reflex-client';
import { relativeTime } from '../ui/theme.js';

/** One `label value` row in an on-demand info block (`/status`, `/help`). */
export interface InfoRow {
  label: string;
  value: string;
}

/**
 * Rows for the `/status` block: the details the chat deliberately keeps out
 * of its always-on chrome (server endpoint, raw agent id) plus runtime facts
 * the terminal otherwise never shows (model, devbox, blueprint). Rows whose
 * value is missing are omitted rather than rendered as placeholders.
 */
export function agentStatusRows(
  agent: Agent,
  ctx: { serverUrl: string | null; workstation: string | null; now?: number },
): InfoRow[] {
  const rows: Array<[string, string | null | undefined]> = [
    ['server', ctx.serverUrl],
    ['org', agent.organizationId],
    ['agent', agent.id],
    ['type', agent.agentType],
    ['model', agent.model],
    ['status', agent.status],
    ['devbox', agent.devboxId],
    ['blueprint', agent.blueprintName ?? agent.blueprintId],
    ['created', relativeTime(agent.createdAt, ctx.now)],
    ['workstation', ctx.workstation],
  ];
  return rows
    .filter((row): row is [string, string] => Boolean(row[1]))
    .map(([label, value]) => ({ label, value }));
}

/** Rows for the `/help` block: every chat command and key, one line each. */
export function chatHelpRows(): InfoRow[] {
  return [
    { label: '/status', value: 'agent, server, and connection details' },
    { label: '/attach <path>', value: 'stage a file for the next message' },
    { label: '/detach', value: 'clear staged files' },
    { label: '/retry', value: 'resend an undelivered message' },
    { label: '/dismiss', value: 'drop undelivered messages' },
    { label: '/unqueue <n>', value: 'remove the nth queued message' },
    { label: '/interrupt', value: 'stop the current turn' },
    { label: '/rename <name>', value: 'rename this agent' },
    { label: '\\ + enter', value: 'insert a newline (also ctrl+j)' },
    { label: '↑/↓', value: 'move between lines, recall sent messages' },
    { label: 'ctrl+o', value: 'open agent links in the browser' },
    { label: 'ctrl+t', value: 'view full tool output (scrollable)' },
    { label: 'ctrl+v', value: 'attach the clipboard image' },
    { label: 'esc', value: 'close this, interrupt, or go back' },
  ];
}
