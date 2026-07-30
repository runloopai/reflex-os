import path from 'node:path';
import React from 'react';
import { render } from 'ink';
import type { TuiConfig } from '../config.js';
import type { CliFlags } from '../context.js';
import { LocalToolExecutor } from '../connect/executor.js';
import { ToolApprover, type ToolPolicy } from '../connect/policy.js';
import { WorkstationConnection, type ConnectEvent } from '../connect/workstation-client.js';
import { runHeadlessConnect } from '../connect/headless.js';
import { dispatchConnectionEvent } from '../ui/App.js';
import { ConnectApp } from '../ui/ConnectApp.js';

/**
 * Derive the connect-mode policy from CLI flags. Full access is the default —
 * connecting a machine is already an explicit opt-in, and per-call prompts
 * silently stalled agents whenever the TUI window wasn't watched. Owners who
 * want the prompts back pass `--ask` (optionally re-allowing one category via
 * `--allow-exec`/`--allow-write`); `--read-only` shuts exec/write off outright
 * and wins over everything.
 */
export function policyFromFlags(flags: CliFlags): ToolPolicy {
  if (flags['read-only']) return { exec: 'deny', write: 'deny' };
  const base = flags.ask ? 'ask' : 'allow';
  return {
    exec: flags['allow-exec'] ? 'allow' : base,
    write: flags['allow-write'] ? 'allow' : base,
  };
}

export interface StartedConnection {
  connection: WorkstationConnection;
  approver: ToolApprover;
  toolRoot: string;
  registerListener: (listener: (event: ConnectEvent) => void) => () => void;
}

export function startConnection(config: TuiConfig, flags: CliFlags): StartedConnection {
  const toolRoot = path.resolve(flags.dir ?? process.cwd());
  const approver = new ToolApprover(policyFromFlags(flags), {
    interactive: Boolean(process.stdin.isTTY),
  });
  const listeners = new Set<(event: ConnectEvent) => void>();
  const connection: WorkstationConnection = new WorkstationConnection({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    organizationId: config.organizationId,
    name: flags.name,
    toolRoot,
    executor: new LocalToolExecutor(toolRoot),
    approver,
    onEvent: (event) => {
      for (const listener of listeners) listener(event);
      dispatchConnectionEvent(connection, event);
    },
  });
  const registerListener = (listener: (event: ConnectEvent) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  connection.start();
  return { connection, approver, toolRoot, registerListener };
}

/**
 * `reflex-cli connect`: register this machine as a workstation. No UI when
 * asked (`--headless`) or when there's no terminal to draw into (a service
 * manager, a pipe): stream logs and wait for a stop signal.
 */
export async function runConnect(config: TuiConfig, flags: CliFlags): Promise<void> {
  const { connection, approver, toolRoot, registerListener } = startConnection(config, flags);
  if (flags.headless || !process.stdout.isTTY) {
    await runHeadlessConnect({ connection, registerListener });
    return;
  }
  const instance = render(
    React.createElement(ConnectApp, { connection, toolRoot, approver, registerListener }),
  );
  await instance.waitUntilExit();
  connection.stop();
}
