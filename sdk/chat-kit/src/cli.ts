/**
 * reflex-chat-kit CLI implementation.
 *
 * Scaffolds Reflex chat components into a consumer app, shadcn-style: the
 * templates under `registry/` are copied into the user's codebase (they own
 * the copies) with relative imports rewritten to the configured layout.
 *
 * Node builtins only. `runCli` is the testable entry; `bin.ts` wraps it.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_FILE = 'reflex-kit.json';

export interface KitConfig {
  componentsDir: string;
  hooksDir: string;
  libDir: string;
}

const DEFAULT_CONFIG: KitConfig = {
  componentsDir: 'src/components/reflex',
  hooksDir: 'src/hooks/reflex',
  libDir: 'src/lib/reflex',
};

export type RegistryItemType = 'component' | 'hook' | 'lib';

export interface RegistryItem {
  name: string;
  type: RegistryItemType;
  description: string;
  /** Registry-relative template files (e.g. `hooks/use-agent-stream.ts`). */
  files: string[];
  /** npm packages the item imports (peer deps of the consumer app). */
  dependencies: string[];
  /** Other registry items the item imports. */
  registryDependencies: string[];
}

interface Registry {
  items: RegistryItem[];
}

/** User-facing failure; the bin prints `error.message` without a stack. */
export class CliError extends Error {}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

/** Registry root: `<package>/registry`, next to both `src/` and `dist/`. */
const REGISTRY_DIR = fileURLToPath(new URL('../registry/', import.meta.url));
const BOOLEAN_FLAGS = new Set(['overwrite']);

export function loadRegistry(): Registry {
  const manifestPath = path.join(REGISTRY_DIR, 'registry.json');
  const registry = JSON.parse(readFileSync(manifestPath, 'utf8')) as Registry;
  return registry;
}

function targetDirFor(type: RegistryItemType, config: KitConfig): string {
  switch (type) {
    case 'component':
      return config.componentsDir;
    case 'hook':
      return config.hooksDir;
    case 'lib':
      return config.libDir;
  }
}

function readConfig(cwd: string): KitConfig {
  const configPath = path.join(cwd, CONFIG_FILE);
  if (!existsSync(configPath)) {
    throw new CliError(`No ${CONFIG_FILE} found in ${cwd}. Run \`reflex-chat-kit init\` first.`);
  }
  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Partial<KitConfig>;
  return { ...DEFAULT_CONFIG, ...parsed };
}

/** Parse `--flag value` pairs; returns positional args and flag map. */
function parseArgs(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const flag = arg.slice(2);
      if (BOOLEAN_FLAGS.has(flag)) {
        flags.set(flag, 'true');
        continue;
      }
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        flags.set(flag, 'true');
      } else {
        flags.set(flag, value);
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/**
 * Resolve `names` plus their transitive registryDependencies into install
 * order (dependencies first, each item once).
 */
export function resolveItems(registry: Registry, names: string[]): RegistryItem[] {
  const byName = new Map(registry.items.map((item) => [item.name, item]));
  const resolved: RegistryItem[] = [];
  const seen = new Set<string>();

  const visit = (name: string, chain: string[]): void => {
    if (seen.has(name)) return;
    const item = byName.get(name);
    if (!item) {
      const via = chain.length > 0 ? ` (required by ${chain.join(' -> ')})` : '';
      throw new CliError(
        `Unknown registry item "${name}"${via}. Run \`reflex-chat-kit list\` to see what is available.`,
      );
    }
    seen.add(name);
    for (const dep of item.registryDependencies) visit(dep, [...chain, name]);
    resolved.push(item);
  };

  for (const name of names) visit(name, []);
  return resolved;
}

/**
 * Rewrite the template's registry-relative imports (`../lib/event-utils`,
 * `./message-bubble`, ...) to the path of the installed copy, relative to
 * the destination file. Extensionless specifiers stay extensionless
 * (consumer apps compile these with their own bundler).
 */
export function rewriteImports(
  content: string,
  registryFile: string,
  installPaths: Map<string, string>,
  destFile: string,
): string {
  const sourceDir = path.posix.dirname(registryFile);
  return content.replace(
    /(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
    (match, prefix: string, specifier: string, suffix: string) => {
      const registryId = path.posix.normalize(path.posix.join(sourceDir, specifier));
      const installed = installPaths.get(registryId);
      if (!installed) return match;
      let relative = path
        .relative(path.dirname(destFile), installed)
        .split(path.sep)
        .join('/')
        .replace(/\.(tsx|ts)$/, '');
      if (!relative.startsWith('.')) relative = `./${relative}`;
      return `${prefix}${relative}${suffix}`;
    },
  );
}

function usage(): string {
  return [
    'reflex-chat-kit — scaffold Reflex chat components into your app',
    '',
    'Usage:',
    '  reflex-chat-kit init [--components-dir <dir>] [--hooks-dir <dir>] [--lib-dir <dir>] [--overwrite]',
    '  reflex-chat-kit add <item...> [--overwrite]   # `add chat` installs everything',
    '  reflex-chat-kit list',
    '',
    'init writes reflex-kit.json; add copies templates (and their registry',
    'dependencies) into the configured directories, rewriting imports to',
    'match. The copies are yours to edit.',
  ].join('\n');
}

function runInit(argv: string[], cwd: string, log: (line: string) => void): void {
  const { flags } = parseArgs(argv);
  const config: KitConfig = {
    componentsDir: flags.get('components-dir') ?? DEFAULT_CONFIG.componentsDir,
    hooksDir: flags.get('hooks-dir') ?? DEFAULT_CONFIG.hooksDir,
    libDir: flags.get('lib-dir') ?? DEFAULT_CONFIG.libDir,
  };
  const configPath = path.join(cwd, CONFIG_FILE);
  try {
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      flag: flags.has('overwrite') ? 'w' : 'wx',
    });
  } catch (error) {
    if (isFileExistsError(error)) {
      throw new CliError(
        `${CONFIG_FILE} already exists. Pass --overwrite to replace your current configuration.`,
      );
    }
    throw error;
  }
  log(`Wrote ${CONFIG_FILE}`);
  log(`  components -> ${config.componentsDir}`);
  log(`  hooks      -> ${config.hooksDir}`);
  log(`  lib        -> ${config.libDir}`);
  log('Next: reflex-chat-kit add chat');
}

function runList(log: (line: string) => void): void {
  const registry = loadRegistry();
  const width = Math.max(...registry.items.map((item) => item.name.length));
  for (const item of registry.items) {
    log(`${item.name.padEnd(width)}  [${item.type}]  ${item.description}`);
  }
}

function runAdd(argv: string[], cwd: string, log: (line: string) => void): void {
  const { positional, flags } = parseArgs(argv);
  if (positional.length === 0) {
    throw new CliError('add: pass at least one item (try `reflex-chat-kit add chat`).');
  }

  const config = readConfig(cwd);
  const registry = loadRegistry();
  const items = resolveItems(registry, positional);

  // First pass: where every file of every resolved item will land, so the
  // second pass can rewrite cross-item imports regardless of order.
  const installPaths = new Map<string, string>();
  for (const item of items) {
    const targetDir = targetDirFor(item.type, config);
    for (const file of item.files) {
      const registryId = file.replace(/\.(tsx|ts)$/, '');
      installPaths.set(registryId, path.join(cwd, targetDir, path.posix.basename(file)));
    }
  }

  const npmDependencies = new Set<string>();
  const installPlan: { destination: string; content: string }[] = [];
  for (const item of items) {
    for (const dep of item.dependencies) npmDependencies.add(dep);
    for (const file of item.files) {
      const registryId = file.replace(/\.(tsx|ts)$/, '');
      const destination = installPaths.get(registryId)!;
      const source = readFileSync(path.join(REGISTRY_DIR, file), 'utf8');
      installPlan.push({
        destination,
        content: rewriteImports(source, file, installPaths, destination),
      });
    }
  }

  const overwrite = flags.has('overwrite');
  const reservations = new Map<string, number>();

  const releaseReservations = (removeFiles: boolean): void => {
    for (const [file, descriptor] of reservations) {
      try {
        closeSync(descriptor);
      } catch {
        // Best effort: preserve the original install result.
      }
      if (removeFiles) {
        try {
          unlinkSync(file);
        } catch {
          // Best effort: preserve the original install result.
        }
      }
    }
  };

  try {
    if (!overwrite) {
      // Reserve every destination before writing content. Exclusive creation
      // prevents a concurrent process from winning a check-then-write race;
      // if one file exists, the catch below removes all prior reservations.
      for (const { destination } of installPlan) {
        if (reservations.has(destination)) continue;
        mkdirSync(path.dirname(destination), { recursive: true });
        reservations.set(destination, openSync(destination, 'wx'));
      }
    }

    for (const { destination, content } of installPlan) {
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(overwrite ? destination : reservations.get(destination)!, content);
    }
  } catch (error) {
    releaseReservations(true);
    if (isFileExistsError(error)) {
      throw new CliError(
        'Refusing to overwrite an existing file. Pass --overwrite to replace installed files.',
      );
    }
    throw error;
  }

  releaseReservations(false);
  for (const { destination } of installPlan) log(`  + ${path.relative(cwd, destination)}`);

  log(`Installed ${items.length} item(s), ${installPlan.length} file(s).`);
  if (npmDependencies.size > 0) {
    log(`Make sure these packages are installed: ${[...npmDependencies].sort().join(' ')}`);
  }
}

/**
 * Run the CLI. Returns the process exit code. `cwd` and `log` are injectable
 * for tests.
 */
export function runCli(
  argv: string[],
  cwd: string = process.cwd(),
  log: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
): number {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'init':
        runInit(rest, cwd, log);
        return 0;
      case 'add':
        runAdd(rest, cwd, log);
        return 0;
      case 'list':
        runList(log);
        return 0;
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        log(usage());
        return command === undefined ? 1 : 0;
      default:
        log(`Unknown command "${command}".`);
        log('');
        log(usage());
        return 1;
    }
  } catch (error) {
    if (error instanceof CliError) {
      log(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
