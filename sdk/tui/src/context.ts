import { loadConfig, resolveDefaultBaseUrl, TuiConfigSchema, type TuiConfig } from './config.js';
import { runLoginWizard } from './commands/login.js';

/**
 * Flags shared across the command tree, in their legacy kebab-case shape.
 * Commander camelCases parsed options; `cli.ts` maps them back so everything
 * downstream (service units, policy derivation, tests) keeps one flag
 * vocabulary that matches what the user actually typed.
 */
export interface CliFlags {
  url?: string;
  key?: string;
  org?: string;
  dir?: string;
  name?: string;
  connect?: boolean;
  headless?: boolean;
  ask?: boolean;
  'allow-exec'?: boolean;
  'allow-write'?: boolean;
  'read-only'?: boolean;
}

export type ServiceAction = 'install' | 'uninstall' | 'status';

/** Merge flags over env/file config; null when the result is incomplete. */
export function tryResolveConfig(flags: CliFlags): TuiConfig | null {
  const base = loadConfig() ?? ({} as Partial<TuiConfig>);
  const merged = {
    ...base,
    ...(flags.url ? { baseUrl: flags.url } : {}),
    ...(flags.key ? { apiKey: flags.key } : {}),
    ...(flags.org ? { organizationId: flags.org } : {}),
  };
  const parsed = TuiConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : null;
}

/**
 * Resolve config from flags/env/file, falling back to the interactive login
 * wizard on a TTY. Returns null (with a helpful message) when unconfigured
 * and non-interactive.
 */
export async function ensureConfig(flags: CliFlags): Promise<TuiConfig | null> {
  const existing = tryResolveConfig(flags);
  if (existing) return existing;
  if (!process.stdin.isTTY) {
    console.error(
      'Not configured. Run `reflex-cli login` (interactive) or set REFLEX_BASE_URL / REFLEX_API_KEY.',
    );
    process.exitCode = 2;
    return null;
  }
  return runLoginWizard(resolveDefaultBaseUrl(flags.url));
}
