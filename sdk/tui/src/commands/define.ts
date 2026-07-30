import type { Command } from 'commander';
import { configureClient } from '../client.js';
import { ensureConfig, type CliFlags } from '../context.js';
import { confirmOrAbort } from '../output/confirm.js';

/**
 * Declarative command registration: the mechanical read/CRUD porcelain is a
 * declaration (name, summary, fetch, render), not an implementation. The
 * shared wiring here owns config resolution, `--json`, confirmation gating,
 * and output, so every declared command behaves identically.
 */

export interface CommandDecl {
  /** Commander name with args, e.g. `'list'` or `'show <agent>'`. */
  name: string;
  summary: string;
  options?: { flags: string; description: string }[];
  /**
   * Destructive-command gate: return the question to ask ("Kill agt_1 and
   * discard its devbox?"). Adds `--yes`; non-TTY runs must pass it. Runs
   * after the client is configured, so it may fetch context for the
   * question (e.g. the plugin uninstall preview).
   */
  confirm?: (args: string[], opts: Record<string, unknown>) => string | Promise<string>;
  /** Fetch with the configured client; positional args in declaration order. */
  fetch: (args: string[], opts: Record<string, unknown>) => Promise<unknown>;
  /** Human rendering; omit to fall back to pretty-printed JSON. */
  render?: (data: unknown, args: string[]) => string;
}

export interface CommandGroup {
  /**
   * Noun path (`'agents'`, `'agents queue'` for a nested group) or `''` for
   * top-level commands (`whoami`). Repeated nouns reuse the existing node.
   */
  noun: string;
  summary: string;
  commands: CommandDecl[];
}

export interface RegisterContext {
  /** Adds the shared --url/--key/--org options to a command. */
  addCommonOptions: (cmd: Command) => Command;
  /** Reads the kebab-case flag view of a command's merged options. */
  legacyFlags: (cmd: Command) => CliFlags;
  /** Invoked for every parsed command (drives parseCli and tests). */
  record: (command: string, flags: CliFlags) => void;
  /** False while parsing for tests; true when the CLI actually runs. */
  execute: boolean;
}

/** Walk (or create) the command node for a possibly-nested noun path. */
function resolveParent(program: Command, noun: string, summary: string): Command {
  if (noun === '') return program;
  let node = program;
  const segments = noun.split(' ');
  for (const [i, segment] of segments.entries()) {
    const existing = node.commands.find((c) => c.name() === segment);
    if (existing) {
      node = existing;
      continue;
    }
    const created = node.command(segment);
    if (i === segments.length - 1) created.description(summary);
    node = created;
  }
  return node;
}

export function registerCommandGroups(
  program: Command,
  groups: CommandGroup[],
  ctx: RegisterContext,
): void {
  for (const group of groups) {
    const parent = resolveParent(program, group.noun, group.summary);
    for (const decl of group.commands) {
      const sub = parent.command(decl.name).description(decl.summary);
      ctx.addCommonOptions(sub);
      sub.option('--json', 'print the raw JSON response instead of a table');
      if (decl.confirm) sub.option('--yes', 'skip the confirmation prompt');
      for (const opt of decl.options ?? []) sub.option(opt.flags, opt.description);
      sub.action((...invocation: unknown[]) => {
        const cmd = invocation[invocation.length - 1] as Command;
        const args = invocation.slice(0, -2) as string[];
        const flags = ctx.legacyFlags(cmd);
        const path = group.noun === '' ? '' : `${group.noun.replaceAll(' ', ':')}:`;
        ctx.record(`${path}${decl.name.split(' ')[0]}`, flags);
        if (!ctx.execute) return;
        return (async () => {
          const opts = cmd.optsWithGlobals<Record<string, unknown>>();
          const config = await ensureConfig(flags);
          if (!config) return;
          configureClient(config);
          if (decl.confirm) {
            const proceed = await confirmOrAbort(await decl.confirm(args, opts), Boolean(opts.yes));
            if (!proceed) {
              console.error('Cancelled.');
              return;
            }
          }
          const data = await decl.fetch(args, opts);
          if (opts.json || !decl.render) {
            console.log(JSON.stringify(data, null, 2));
            return;
          }
          console.log(decl.render(data, args));
        })();
      });
    }
  }
}
