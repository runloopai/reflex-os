import { commonOptions, isCommonOption, type CommandNode, type OptionInfo } from './walker.js';

/**
 * Render the walked command tree as the markdown CLI reference
 * (`docs/cli.md`). One section per top-level command, nested subcommands as
 * deeper headings, and the shared `--url`/`--key`/`--org` options documented
 * once instead of on every command. The output is deterministic: the walker
 * sorts subcommands, and nothing here depends on the environment.
 */
export function renderCliDocs(root: CommandNode): string {
  const common = commonOptions(root);
  const lines: string[] = [];

  lines.push(`# ${root.name} command reference`);
  lines.push('');
  lines.push(
    'Generated from the command tree by `pnpm --filter reflex-cli docs:generate`.',
    'Do not edit by hand; `docs:check` and the test suite fail on drift.',
  );
  lines.push('');
  lines.push('```');
  lines.push(root.usage);
  lines.push('```');
  lines.push('');
  lines.push(root.description);
  lines.push('');
  lines.push(
    `The binary also installs as \`reflex\`; both names run the same CLI. With no`,
    `command, \`${root.name}\` opens the interactive TUI.`,
  );
  const rootOwn = root.options.filter((opt) => !isCommonOption(opt, common));
  if (rootOwn.length > 0) {
    lines.push('');
    lines.push('Options:');
    lines.push('');
    for (const opt of rootOwn) lines.push(renderOption(opt));
  }
  lines.push('');
  lines.push('## Common options');
  lines.push('');
  lines.push(
    'Every command accepts these. They override the environment variables and',
    'the saved config in `~/.reflex/tui.json`.',
  );
  lines.push('');
  for (const opt of common) lines.push(renderOption(opt));

  for (const command of root.subcommands) {
    renderCommand(command, 2, common, lines);
  }

  lines.push('');
  return lines.join('\n');
}

function renderCommand(
  node: CommandNode,
  depth: number,
  common: OptionInfo[],
  lines: string[],
): void {
  lines.push('');
  lines.push(`${'#'.repeat(depth)} ${node.path.split(' ').slice(1).join(' ')}`);
  lines.push('');
  lines.push('```');
  lines.push(node.usage);
  lines.push('```');
  if (node.description !== '') {
    lines.push('');
    lines.push(node.description);
  }
  if (node.args.length > 0) {
    lines.push('');
    lines.push('Arguments:');
    lines.push('');
    for (const arg of node.args) {
      lines.push(
        arg.description === '' ? `- \`${arg.label}\`` : `- \`${arg.label}\`: ${arg.description}`,
      );
    }
  }
  const own = node.options.filter((opt) => !isCommonOption(opt, common));
  if (own.length > 0) {
    lines.push('');
    lines.push('Options:');
    lines.push('');
    for (const opt of own) lines.push(renderOption(opt));
  }
  for (const sub of node.subcommands) {
    renderCommand(sub, Math.min(depth + 1, 6), common, lines);
  }
}

function renderOption(opt: OptionInfo): string {
  return opt.description === '' ? `- \`${opt.flags}\`` : `- \`${opt.flags}\`: ${opt.description}`;
}
