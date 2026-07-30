import type { Command } from 'commander';

/**
 * One walk over the Commander tree, shared by the markdown reference
 * (`docs/cli.md`) and the `completion` command. Both consume this plain data
 * shape instead of Commander objects, so help, docs, and completion cannot
 * disagree about what the CLI accepts. Subcommands are sorted by name at
 * every level, which makes the generated output deterministic regardless of
 * registration order.
 */

export interface OptionInfo {
  /** Full flags string as declared, e.g. `'--url <origin>'`. */
  flags: string;
  /** Long form alone, e.g. `'--url'`; undefined for short-only options. */
  long?: string;
  description: string;
  /** True when the option takes a value (`--url <origin>`). */
  takesValue: boolean;
}

export interface ArgumentInfo {
  name: string;
  /** Commander-style label: `<agent>` when required, `[target]` when not. */
  label: string;
  description: string;
  required: boolean;
}

export interface CommandNode {
  name: string;
  /** Space-joined path from the binary, e.g. `'reflex-cli agents list'`. */
  path: string;
  /** One-line usage, e.g. `'reflex-cli agents list [options]'`. */
  usage: string;
  description: string;
  args: ArgumentInfo[];
  options: OptionInfo[];
  subcommands: CommandNode[];
}

/** Walk a command (usually the root program) into a `CommandNode` tree. */
export function walkCommand(cmd: Command, parentPath = ''): CommandNode {
  const path = parentPath === '' ? cmd.name() : `${parentPath} ${cmd.name()}`;
  return {
    name: cmd.name(),
    path,
    usage: `${path} ${cmd.usage()}`,
    description: cmd.description(),
    args: cmd.registeredArguments.map((arg) => ({
      name: arg.name(),
      label: arg.required ? `<${arg.name()}>` : `[${arg.name()}]`,
      description: arg.description,
      required: arg.required,
    })),
    options: cmd.options
      .filter((opt) => !opt.hidden)
      .map((opt) => ({
        flags: opt.flags,
        long: opt.long,
        description: opt.description,
        takesValue: opt.flags.includes('<') || opt.flags.includes('['),
      })),
    subcommands: cmd.commands
      .map((sub) => walkCommand(sub, path))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * The options every runnable command accepts (`--url`, `--key`, `--org`),
 * computed as the intersection of the option sets of every leaf command
 * rather than hardcoded, so the docs stay honest if the shared set changes.
 * Docs list these once instead of repeating them per command.
 */
export function commonOptions(root: CommandNode): OptionInfo[] {
  const leaves: CommandNode[] = [];
  const collect = (node: CommandNode): void => {
    if (node.subcommands.length === 0 && node !== root) leaves.push(node);
    for (const sub of node.subcommands) collect(sub);
  };
  collect(root);
  if (leaves.length === 0) return [];
  const [first, ...rest] = leaves;
  return first.options.filter((opt) =>
    rest.every((leaf) => leaf.options.some((other) => other.flags === opt.flags)),
  );
}

/** True when `option` is in the common set (matched by its flags string). */
export function isCommonOption(option: OptionInfo, common: OptionInfo[]): boolean {
  return common.some((c) => c.flags === option.flags);
}
