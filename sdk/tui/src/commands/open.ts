import type { Command } from 'commander';
import { getAgent } from '@runloop/reflex-client';
import { resolveOpenTarget } from '../chat/links.js';
import { configureClient } from '../client.js';
import { ensureConfig } from '../context.js';
import { openBrowser } from '../connect/open-browser.js';
import type { RegisterContext } from './define.js';

/**
 * `open <agent> [target]`: the agent's browser surfaces from the terminal.
 * No target opens its web page; `pr` opens its pull request; a daemon name
 * opens that daemon's tunnel URL. The URL is always printed (browsers are
 * best-effort, and pipes have none), sharing the link builder with the
 * TUI's ctrl+o palette.
 */
export function registerOpenCommand(program: Command, ctx: RegisterContext): void {
  const cmd = program
    .command('open')
    .description('open the agent in your browser: its page, its PR, or a daemon')
    .argument('<agent>', 'agent id')
    .argument('[target]', 'pr for the pull request, or a daemon name for its tunnel')
    .option('--print', 'print the URL without opening a browser');
  ctx.addCommonOptions(cmd);
  cmd.action((agentId: string, target: string | undefined, _opts: unknown, c: Command) => {
    const flags = ctx.legacyFlags(c);
    ctx.record('open', flags);
    if (!ctx.execute) return;
    return (async () => {
      const config = await ensureConfig(flags);
      if (!config) return;
      configureClient(config);
      const agent = (await getAgent(agentId)).data;
      const { url } = resolveOpenTarget(config.baseUrl, agent, target);
      const printOnly =
        Boolean(c.optsWithGlobals<{ print?: boolean }>().print) || !process.stdout.isTTY;
      if (!printOnly) openBrowser(url);
      console.log(url);
    })();
  });
}
