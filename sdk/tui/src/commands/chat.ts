import type { Command } from 'commander';
import { configureClient } from '../client.js';
import { ensureConfig } from '../context.js';
import type { RegisterContext } from './define.js';
import { runUi } from './ui.js';

/**
 * `chat <agent>`: the interactive TUI, opened straight into one agent's
 * chat. Everything else about the TUI is unchanged; the agent list is one
 * esc away.
 */
export function registerChatCommand(program: Command, ctx: RegisterContext): void {
  const cmd = program
    .command('chat')
    .description('open the interactive chat for one agent')
    .argument('<agent>', 'agent id');
  ctx.addCommonOptions(cmd);
  cmd.action((agentId: string, _opts: unknown, c: Command) => {
    const flags = ctx.legacyFlags(c);
    ctx.record('chat', flags);
    if (!ctx.execute) return;
    return (async () => {
      const config = await ensureConfig(flags);
      if (!config) return;
      configureClient(config);
      await runUi(config, flags, agentId);
    })();
  });
}
