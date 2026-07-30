import React from 'react';
import { render } from 'ink';
import { resolveDefaultBaseUrl, saveConfig, type TuiConfig } from '../config.js';
import { LoginApp } from '../ui/LoginApp.js';
import type { CliFlags } from '../context.js';

/** Run the login wizard; resolves with the saved config, or null on cancel. */
export function runLoginWizard(initialBaseUrl?: string): Promise<TuiConfig | null> {
  return new Promise((resolve) => {
    let result: TuiConfig | null = null;
    const instance = render(
      React.createElement(LoginApp, {
        initialBaseUrl,
        onComplete: (config) => {
          result = config;
        },
        onCancel: () => {
          result = null;
        },
      }),
    );
    void instance.waitUntilExit().then(() => {
      if (result) {
        const savedTo = saveConfig(result);
        console.log(`Saved credentials to ${savedTo}`);
      }
      resolve(result);
    });
  });
}

/**
 * `reflex-cli login`: with `--key`, save credentials directly (the
 * non-interactive path); otherwise run the browser-connect wizard, which
 * needs a terminal.
 */
export async function runLogin(flags: CliFlags): Promise<void> {
  if (flags.key) {
    const config: TuiConfig = {
      baseUrl: resolveDefaultBaseUrl(flags.url).replace(/\/+$/, ''),
      apiKey: flags.key,
      ...(flags.org ? { organizationId: flags.org } : {}),
    };
    const savedTo = saveConfig(config);
    console.log(`Saved credentials to ${savedTo}`);
    return;
  }
  if (!process.stdin.isTTY) {
    console.error('login requires --key when not running in a terminal');
    process.exitCode = 2;
    return;
  }
  await runLoginWizard(resolveDefaultBaseUrl(flags.url));
}
