import { Command, CommanderError } from 'commander';
import { configureClient } from './client.js';
import { ensureConfig, type CliFlags, type ServiceAction } from './context.js';
import { runApi } from './commands/api.js';
import { runConnect } from './commands/connect.js';
import { registerCommandGroups } from './commands/define.js';
import { runLogin } from './commands/login.js';
import { actionCommandGroups } from './commands/actions.js';
import { adminCommandGroups } from './commands/admin.js';
import { registerChatCommand } from './commands/chat.js';
import { registerOpenCommand } from './commands/open.js';
import { readCommandGroups } from './commands/reads.js';
import { registerRunCommand } from './commands/run.js';
import { registerWatchCommands } from './commands/watch.js';
import { registerCompletionCommand } from './commands/completion.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { runService } from './commands/service.js';
import { runUi } from './commands/ui.js';
import { runWhoami } from './commands/whoami.js';
import { formatCliError, UsageError } from './output/errors.js';

export { policyFromFlags } from './commands/connect.js';
export type { CliFlags, ServiceAction } from './context.js';

export interface ParsedCli {
  /** Legacy commands keep their literal names; declared commands use `noun:verb`. */
  command: 'ui' | 'connect' | 'login' | 'service' | 'help' | (string & {});
  /** Subcommand for `service`; undefined for every other command. */
  serviceAction?: ServiceAction;
  flags: CliFlags;
}

const SERVICE_USAGE = 'Usage: reflex-cli service <install|uninstall|status>';

/** Options every command accepts: where the server is and who you are. */
function addCommonOptions(cmd: Command): Command {
  return cmd
    .option(
      '--url <origin>',
      'server origin (or REFLEX_BASE_URL; default https://reflex.runloop.ai)',
    )
    .option('--key <key>', 'personal API key rfx_... (or REFLEX_API_KEY)')
    .option('--org <org>', 'organization id or slug (or REFLEX_ORG)');
}

/** Options that shape a workstation connection and its tool policy. */
function addConnectOptions(cmd: Command): Command {
  return cmd
    .option(
      '--dir <path>',
      'directory agents may access in connect mode (default: current directory)',
    )
    .option('--name <name>', 'workstation display name (default: hostname)')
    .option('--headless', 'connect without the TUI (log to stdout); used by the service')
    .option('--ask', 'require per-call approval for commands and file writes')
    .option('--allow-exec', 'with --ask: pre-approve commands (writes still ask)')
    .option('--allow-write', 'with --ask: pre-approve file writes (commands still ask)')
    .option('--read-only', 'deny commands and writes outright (read/list still work)');
}

/**
 * Commander camelCases option names; map them back to the kebab-case flag
 * vocabulary the rest of the CLI (service units, policy, tests) speaks.
 */
function legacyFlags(cmd: Command): CliFlags {
  const opts = cmd.optsWithGlobals<{
    url?: string;
    key?: string;
    org?: string;
    dir?: string;
    name?: string;
    connect?: boolean;
    headless?: boolean;
    ask?: boolean;
    allowExec?: boolean;
    allowWrite?: boolean;
    readOnly?: boolean;
  }>();
  const flags: CliFlags = {
    url: opts.url,
    key: opts.key,
    org: opts.org,
    dir: opts.dir,
    name: opts.name,
    connect: opts.connect,
    headless: opts.headless,
    ask: opts.ask,
    'allow-exec': opts.allowExec,
    'allow-write': opts.allowWrite,
    'read-only': opts.readOnly,
  };
  for (const [key, value] of Object.entries(flags)) {
    if (value === undefined) delete flags[key as keyof CliFlags];
  }
  return flags;
}

interface ProgramOptions {
  /** Suppress commander's own output (parse-only mode for tests). */
  silent?: boolean;
  /** Run the command bodies; false records the parse and returns. */
  execute?: boolean;
}

/** Resolve config and point the shared client at the server, or bail. */
async function requireClient(flags: CliFlags) {
  const config = await ensureConfig(flags);
  if (config) configureClient(config);
  return config;
}

/**
 * Build the command tree. Every action records what it parsed (feeding
 * `parseCli` and the back-compat tests) and, in execute mode, runs the
 * command. One tree serves parsing, help, docs generation, and dispatch.
 */
export function createProgram(
  record: (cli: ParsedCli) => void = () => {},
  { silent = false, execute = false }: ProgramOptions = {},
): Command {
  const program = new Command();
  program
    .name('reflex-cli')
    // The root takes a hidden `[command]` argument purely to reject unknown
    // commands with a helpful message; collapse the doubled placeholder.
    .usage('[options] [command]')
    .description(
      'Terminal client for Reflex: browse and chat with agents, launch new\n' +
        'ones, and connect this machine as a workstation agents can work on.',
    )
    .exitOverride()
    .allowExcessArguments(true)
    // The root has a default action (the TUI), which suppresses commander's
    // implicit `help` subcommand; add it back explicitly.
    .helpCommand('help [command]', 'display help for a command');
  if (silent) {
    program.configureOutput({ writeOut: () => {}, writeErr: () => {} });
  }

  addConnectOptions(addCommonOptions(program))
    .option('--connect', 'also connect this machine while browsing the TUI')
    .argument('[command]')
    .action((command: string | undefined, _opts: unknown, cmd: Command) => {
      if (command !== undefined) {
        throw new UsageError(`Unknown command: ${command} (try \`reflex-cli help\`)`);
      }
      const flags = legacyFlags(cmd);
      record({ command: 'ui', flags });
      if (!execute) return;
      return (async () => {
        const config = await requireClient(flags);
        if (config) await runUi(config, flags);
      })();
    })
    .addHelpText(
      'after',
      `
Examples:
  reflex-cli                        interactive TUI: agents list, chat, launch
  reflex-cli --connect --dir ~/dev  TUI + register this machine as a workstation
  reflex-cli agents list --json     scriptable read commands (see below)
  reflex-cli api --list             call any API operation by name
  reflex-cli login --key rfx_...    save credentials without the wizard

Connect mode gives agents you launch with the "Connect" attachment tools on
this machine, confined to --dir. Commands and writes run without prompting
by default; pass --ask for per-call approval or --read-only to deny them.
Every call is shown in the activity log.`,
    );

  const connect = program
    .command('connect')
    .description('connect this machine as a workstation, with an activity log');
  addConnectOptions(addCommonOptions(connect)).action((_opts: unknown, cmd: Command) => {
    const flags = legacyFlags(cmd);
    record({ command: 'connect', flags });
    if (!execute) return;
    return (async () => {
      const config = await requireClient(flags);
      if (config) await runConnect(config, flags);
    })();
  });

  const login = program
    .command('login')
    .description('sign in; without --key, opens a browser connect link to approve this machine');
  addCommonOptions(login).action((_opts: unknown, cmd: Command) => {
    const flags = legacyFlags(cmd);
    record({ command: 'login', flags });
    if (execute) return runLogin(flags);
  });

  const service = program
    .command('service')
    .description('manage connect as a boot daemon (launchd on macOS, systemd on Linux)')
    .argument('[action]', 'install | uninstall | status')
    .addHelpText(
      'after',
      `
The daemon runs \`reflex-cli connect --headless\` with the flags you install
it with, and reads credentials saved by \`reflex-cli login\`. Remove it with
\`reflex-cli service uninstall\`.`,
    );
  addConnectOptions(addCommonOptions(service)).action(
    (action: string | undefined, _opts: unknown, cmd: Command) => {
      if (action !== 'install' && action !== 'uninstall' && action !== 'status') {
        throw new UsageError(SERVICE_USAGE);
      }
      const flags = legacyFlags(cmd);
      record({ command: 'service', serviceAction: action, flags });
      if (execute) runService(action, flags);
    },
  );

  const api = program
    .command('api')
    .description('call any public API operation by name; output is always JSON')
    .argument('[operation]', 'operationId from the OpenAPI spec (see --list)')
    .argument('[args...]', 'path parameters, in URL order')
    .option('--list', 'list every operation with its route and summary')
    .option('--param <name=value>', 'query parameter (repeatable)', collect, [])
    .option(
      '--field <name=value>',
      'request body field, dotted paths allowed (repeatable)',
      collect,
      [],
    )
    .option('--input <file>', 'request body from a JSON file, or - for stdin')
    .addHelpText(
      'after',
      `
Examples:
  reflex-cli api --list
  reflex-cli api listAgents --param archived=true
  reflex-cli api sendAgentMessage agt_123 --field message='Run the tests'
  reflex-cli api createAgent --input launch.json`,
    );
  addCommonOptions(api).action(
    (operation: string | undefined, args: string[], _opts: unknown, cmd: Command) => {
      const flags = legacyFlags(cmd);
      record({ command: 'api', flags });
      if (!execute) return;
      return (async () => {
        const opts = cmd.optsWithGlobals<{
          list?: boolean;
          param: string[];
          field: string[];
          input?: string;
        }>();
        // Listing needs no server; calling does.
        if (opts.list || operation === undefined) {
          await runApi(undefined, [], { list: true });
          return;
        }
        const config = await requireClient(flags);
        if (!config) return;
        await runApi(operation, args, opts);
      })();
    },
  );

  const whoami = program
    .command('whoami')
    .description('show the server, key, and organization requests will use');
  addCommonOptions(whoami)
    .option('--json', 'print as JSON')
    .action((_opts: unknown, cmd: Command) => {
      const flags = legacyFlags(cmd);
      record({ command: 'whoami', flags });
      if (!execute) return;
      return (async () => {
        const config = await requireClient(flags);
        if (config)
          await runWhoami(config, Boolean(cmd.optsWithGlobals<{ json?: boolean }>().json));
      })();
    });

  const registerContext = {
    addCommonOptions,
    legacyFlags,
    record: (command: string, flags: CliFlags) => record({ command, flags }),
    execute,
  };
  registerCommandGroups(
    program,
    [...readCommandGroups(), ...actionCommandGroups(), ...adminCommandGroups()],
    registerContext,
  );
  registerWatchCommands(program, registerContext);
  registerRunCommand(program, registerContext);
  registerChatCommand(program, registerContext);
  registerOpenCommand(program, registerContext);
  registerCompletionCommand(program, registerContext);
  registerDoctorCommand(program, registerContext);

  return program;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/**
 * Parse argv into the command that would run, without running it. Throws on
 * usage errors (unknown command/option, bad service action) with a printable
 * message; help requests parse to `{ command: 'help' }`.
 */
export function parseCli(argv: string[]): ParsedCli {
  let result: ParsedCli | null = null;
  const program = createProgram(
    (cli) => {
      result = cli;
    },
    { silent: true },
  );
  try {
    program.parse(argv, { from: 'user' });
  } catch (err) {
    // exitCode 0 means commander already handled the request (help); any
    // other CommanderError is a usage problem worth rethrowing cleanly.
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) return { command: 'help', flags: {} };
      throw new UsageError(err.message.replace(/^error: /, ''));
    }
    throw err;
  }
  if (!result) return { command: 'help', flags: {} };
  return result;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const program = createProgram(() => {}, { execute: true });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      // Help/version already printed; anything else is a usage error that
      // commander has also already reported on stderr.
      process.exitCode = err.exitCode === 0 ? 0 : 2;
      return;
    }
    if (err instanceof UsageError) {
      console.error(err.message);
      process.exitCode = 2;
      return;
    }
    console.error(formatCliError(err));
    process.exitCode = 1;
  }
}
