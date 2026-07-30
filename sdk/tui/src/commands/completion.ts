import type { Command } from 'commander';
import { parseShellArg, renderCompletionScript } from '../reference/completion.js';
import { walkCommand } from '../reference/walker.js';
import type { RegisterContext } from './define.js';

/**
 * `completion <shell>`: print a completion script for bash, zsh, or fish.
 * The script is generated from the live command tree (the same walk that
 * emits `docs/cli.md`), needs no configuration or server, and covers every
 * command, subcommand, and long option.
 */
export function registerCompletionCommand(program: Command, ctx: RegisterContext): void {
  const cmd = program
    .command('completion')
    .description('print a completion script for your shell')
    .argument('<shell>', 'bash, zsh, or fish');
  ctx.addCommonOptions(cmd);
  cmd.addHelpText(
    'after',
    `
Load the script into the current shell:
  bash:  source <(reflex-cli completion bash)
  zsh:   source <(reflex-cli completion zsh)   # after compinit
  fish:  reflex-cli completion fish | source

Add that line to your shell profile (~/.bashrc, ~/.zshrc, or
~/.config/fish/config.fish) to load it in every session. The script
completes command names, subcommands, and long options; it does not
complete ids or other argument values.`,
  );
  cmd.action((shellArg: string, _opts: unknown, c: Command) => {
    const shell = parseShellArg(shellArg);
    const flags = ctx.legacyFlags(c);
    ctx.record('completion', flags);
    if (!ctx.execute) return;
    console.log(renderCompletionScript(shell, walkCommand(program)));
  });
}
