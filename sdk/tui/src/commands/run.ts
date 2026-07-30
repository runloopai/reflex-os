import type { Command } from 'commander';
import { createAgent, getAgent } from '@runloop/reflex-client';
import { buildLaunchPayload } from '../launch/options.js';
import type { WatchOutcome } from '../chat/until.js';
import { configureClient } from '../client.js';
import { ensureConfig } from '../context.js';
import { LAUNCH_OPTIONS, loadAttachments, selectionsFromFlags } from './actions.js';
import type { RegisterContext } from './define.js';
import { liveStreamSource, parseUntilFlag, watchAgent } from './watch.js';

/**
 * `run`: the one-shot for scripts and CI. Launches an agent with the same
 * flags as `agents launch`, then watches it like `watch` until the turn
 * completes (or `--until pr` / `--until forever`). The exit code reflects
 * the agent outcome, so `reflex-cli run -p "fix the test" && ...` composes.
 */

/** `done` and `pr` reached their condition; `error` means the agent failed. */
export function exitCodeForOutcome(outcome: WatchOutcome): 0 | 1 {
  return outcome === 'error' ? 1 : 0;
}

export function registerRunCommand(program: Command, ctx: RegisterContext): void {
  const cmd = program
    .command('run')
    .description('launch an agent and stream it until the turn completes');
  ctx.addCommonOptions(cmd);
  for (const opt of LAUNCH_OPTIONS) cmd.option(opt.flags, opt.description);
  cmd
    .option('--json', 'stream events as NDJSON, then print a final result object')
    .option('--until <condition>', 'when to exit: done, pr, or forever', 'done')
    .addHelpText(
      'after',
      `
Examples:
  reflex-cli run -p "fix the flaky test" --repo acme/app
  reflex-cli run -p "open a PR for the fix" --repo acme/app --until pr

Exit code 0 when the condition is met, 1 when the agent errors. With --json,
stdout carries NDJSON events and ends with {agentId, name, status, outcome};
the launch notice goes to stderr.`,
    );
  cmd.action((_opts: unknown, c: Command) => {
    const opts = c.optsWithGlobals<Record<string, unknown>>();
    const until = parseUntilFlag(opts.until);
    const flags = ctx.legacyFlags(c);
    ctx.record('run', flags);
    if (!ctx.execute) return;
    return (async () => {
      const config = await ensureConfig(flags);
      if (!config) return;
      configureClient(config);
      const attachments = await loadAttachments(opts);
      const selections = await selectionsFromFlags(opts, attachments);
      const agent = (await createAgent(buildLaunchPayload(selections))).data;
      const json = Boolean(opts.json);
      // In JSON mode the notice goes to stderr so stdout stays NDJSON-clean.
      const announce = `Launched ${agent.id} (${agent.name}).`;
      if (json) console.error(announce);
      else console.log(announce);

      const outcome = await watchAgent(agent, { until, json, source: liveStreamSource() });

      if (json) {
        let status: string = agent.status;
        try {
          status = (await getAgent(agent.id)).data.status;
        } catch {
          // Keep the launch-time status if the final fetch fails.
        }
        console.log(JSON.stringify({ agentId: agent.id, name: agent.name, status, outcome }));
      } else {
        console.log(
          outcome === 'error'
            ? 'Agent errored.'
            : outcome === 'pr'
              ? 'Pull request opened.'
              : 'Turn complete.',
        );
      }
      process.exitCode = exitCodeForOutcome(outcome);
    })();
  });
}
