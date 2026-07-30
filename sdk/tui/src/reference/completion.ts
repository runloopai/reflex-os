import { UsageError } from '../output/errors.js';
import type { CommandNode } from './walker.js';

/**
 * Shell completion scripts, generated from the same tree walk as the docs.
 * The scripts are static: each node of the command tree becomes one entry in
 * a lookup from the typed command path to its subcommands and long options.
 * No dynamic server lookups; ids and other argument values do not complete.
 */

export type CompletionShell = 'bash' | 'zsh' | 'fish';

export const COMPLETION_SHELLS: CompletionShell[] = ['bash', 'zsh', 'fish'];

/** Validate the `<shell>` argument; commander passes the raw string. */
export function parseShellArg(value: string): CompletionShell {
  if (value === 'bash' || value === 'zsh' || value === 'fish') return value;
  throw new UsageError(`completion expects bash, zsh, or fish, got: ${value}`);
}

export function renderCompletionScript(shell: CompletionShell, root: CommandNode): string {
  if (shell === 'bash') return renderBash(root);
  if (shell === 'zsh') return renderZsh(root);
  return renderFish(root);
}

interface FlatNode {
  /** Slash-joined command path below the binary; `''` for the root. */
  path: string;
  node: CommandNode;
}

function flatten(root: CommandNode): FlatNode[] {
  const nodes: FlatNode[] = [];
  const visit = (node: CommandNode, path: string): void => {
    nodes.push({ path, node });
    for (const sub of node.subcommands) visit(sub, `${path}/${sub.name}`);
  };
  visit(root, '');
  return nodes;
}

/** Subcommand names plus long options: the words worth completing at a node. */
function candidates(node: CommandNode): string[] {
  return [
    ...node.subcommands.map((sub) => sub.name),
    ...node.options.map((opt) => opt.long).filter((long): long is string => long !== undefined),
  ];
}

/** Single-quote a string for bash/zsh (and fish, which shares the rule). */
function quote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

function renderBash(root: CommandNode): string {
  const cases = flatten(root)
    .map(
      ({ path, node }) => `    ${quote(path)}) candidates=${quote(candidates(node).join(' '))} ;;`,
    )
    .join('\n');
  return `# bash completion for ${root.name}
# Load with: source <(${root.name} completion bash)
_reflex_cli_complete() {
  local cur path word i
  cur="\${COMP_WORDS[COMP_CWORD]}"
  path=""
  for ((i = 1; i < COMP_CWORD; i++)); do
    word="\${COMP_WORDS[i]}"
    case "$word" in -*) continue ;; esac
    path="$path/$word"
  done
  local candidates=""
  case "$path" in
${cases}
    *) candidates="" ;;
  esac
  COMPREPLY=( $(compgen -W "$candidates" -- "$cur") )
}
complete -F _reflex_cli_complete reflex-cli
complete -F _reflex_cli_complete reflex
`;
}

function renderZsh(root: CommandNode): string {
  const cases = flatten(root)
    .map(({ path, node }) => `    ${quote(path)}) candidates=(${candidates(node).join(' ')}) ;;`)
    .join('\n');
  return `#compdef reflex-cli reflex
# zsh completion for ${root.name}
# Load with: source <(${root.name} completion zsh)  (after compinit)
_reflex_cli_complete() {
  local -a candidates
  local context="" word
  local -i i
  for (( i = 2; i < CURRENT; i++ )); do
    word="\${words[i]}"
    [[ "$word" == -* ]] && continue
    context="$context/$word"
  done
  candidates=()
  case "$context" in
${cases}
  esac
  (( \${#candidates} )) && compadd -a candidates
}
if (( \${+functions[compdef]} )); then
  compdef _reflex_cli_complete reflex-cli reflex
fi
`;
}

function renderFish(root: CommandNode): string {
  const lines: string[] = [];
  for (const { path, node } of flatten(root)) {
    const condition = quote(`__reflex_cli_at "${path}"`);
    for (const sub of node.subcommands) {
      const description = sub.description.split('\n')[0];
      lines.push(
        `complete -c reflex-cli -c reflex -n ${condition} -a ${sub.name}` +
          (description === '' ? '' : ` -d ${quote(description)}`),
      );
    }
    for (const opt of node.options) {
      if (opt.long === undefined) continue;
      lines.push(
        `complete -c reflex-cli -c reflex -n ${condition} -l ${opt.long.slice(2)}` +
          (opt.takesValue ? ' -r' : '') +
          (opt.description === '' ? '' : ` -d ${quote(opt.description.split('\n')[0])}`),
      );
    }
  }
  return `# fish completion for ${root.name}
# Load with: ${root.name} completion fish | source
function __reflex_cli_at
    set -l tokens (commandline -opc)
    set -e tokens[1]
    set -l current ""
    for token in $tokens
        string match -q -- '-*' $token; and continue
        set current "$current/$token"
    end
    test "$current" = "$argv[1]"
end
complete -c reflex-cli -f
complete -c reflex -f
${lines.join('\n')}
`;
}
