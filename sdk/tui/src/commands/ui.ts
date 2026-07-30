import React from 'react';
import { render } from 'ink';
import type { TuiConfig } from '../config.js';
import type { CliFlags } from '../context.js';
import { App } from '../ui/App.js';
import { startConnection } from './connect.js';

/**
 * The zero-argument default: the interactive TUI (agents list, chat,
 * launch), optionally with this machine connected as a workstation while
 * browsing (`--connect`). `chat <agent>` passes `initialAgentId` to open
 * straight into that agent's chat.
 */
export async function runUi(
  config: TuiConfig,
  flags: CliFlags,
  initialAgentId?: string,
): Promise<void> {
  const connected = flags.connect ? startConnection(config, flags) : null;
  const instance = render(
    React.createElement(App, {
      config,
      connection: connected?.connection ?? null,
      approver: connected?.approver ?? null,
      initialAgentId: initialAgentId ?? null,
    }),
  );
  await instance.waitUntilExit();
  connected?.connection.stop();
}
