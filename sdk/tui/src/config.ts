import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

/**
 * TUI configuration. Environment variables win over the config file so CI
 * and one-off invocations never need to touch `~/.reflex/tui.json`:
 *
 *   REFLEX_BASE_URL — server origin, e.g. https://reflex.runloop.ai
 *   REFLEX_API_KEY  — personal API key (rfx_...) from Settings → API keys
 *   REFLEX_ORG      — org id or slug (optional; defaults server-side)
 */
/** The hosted Reflex instance the login wizard assumes unless overridden. */
export const DEFAULT_BASE_URL = 'https://reflex.runloop.ai';

/**
 * Server the login wizard offers as its default: an explicit `--url` flag
 * wins, then `REFLEX_BASE_URL`, then the hosted instance. Self-hosted users
 * set the env var once and never see reflex.runloop.ai suggested.
 */
export function resolveDefaultBaseUrl(
  flagUrl?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return flagUrl ?? env.REFLEX_BASE_URL ?? DEFAULT_BASE_URL;
}

export const TuiConfigSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  organizationId: z.string().min(1).optional(),
  /** Agent type the launch wizard starts on — the last one launched with. */
  defaultAgentType: z.string().min(1).optional(),
  /** Repo (`owner/repo[#branch]`) the launch wizard prefills — the last one used. */
  lastRepo: z.string().min(1).optional(),
  /** Model the launch wizard preselects, saved alongside `defaultAgentType`. */
  lastModel: z.string().min(1).optional(),
});
export type TuiConfig = z.infer<typeof TuiConfigSchema>;

export function defaultConfigPath(): string {
  return path.join(homedir(), '.reflex', 'tui.json');
}

function pruneUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  filePath: string = defaultConfigPath(),
): TuiConfig | null {
  let fromFile: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object') fromFile = parsed as Record<string, unknown>;
  } catch {
    // Missing or unreadable file — env vars may still be enough.
  }
  const merged = {
    ...fromFile,
    ...pruneUndefined({
      baseUrl: env.REFLEX_BASE_URL,
      apiKey: env.REFLEX_API_KEY,
      organizationId: env.REFLEX_ORG,
    }),
  };
  const parsed = TuiConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : null;
}

export function saveConfig(config: TuiConfig, filePath: string = defaultConfigPath()): string {
  writeConfigFile(filePath, config);
  return filePath;
}

/**
 * Merge a patch into the saved config file without persisting anything that
 * came from env vars: the file is re-read raw, patched, and written back, so
 * a `REFLEX_API_KEY`-style override never leaks into `~/.reflex/tui.json`.
 * A missing or unreadable file starts from the patch alone — `loadConfig`
 * still merges env vars on top.
 */
export function updateSavedConfig(
  patch: Partial<TuiConfig>,
  filePath: string = defaultConfigPath(),
): void {
  let fromFile: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    if (parsed && typeof parsed === 'object') fromFile = parsed as Record<string, unknown>;
  } catch {
    // No config file yet.
  }
  writeConfigFile(filePath, { ...fromFile, ...pruneUndefined(patch) });
}

function writeConfigFile(filePath: string, data: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The file holds a bearer-equivalent API key — owner-only permissions.
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies when creating a file; tighten an existing config too.
  chmodSync(filePath, 0o600);
}
