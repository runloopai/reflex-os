import { CLI_VERSION, PACKAGE_NAME } from './version.js';

/** The npm registry's `latest` dist-tag document for this package. */
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

/** A stalled registry must never hold the TUI's notice open. */
const DEFAULT_TIMEOUT_MS = 3000;

interface ReleaseParts {
  numbers: number[];
  prerelease: string;
}

function releaseParts(version: string): ReleaseParts {
  const [release = '', ...rest] = version.trim().replace(/^v/, '').split('-');
  return {
    numbers: release.split('.').map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }),
    prerelease: rest.join('-'),
  };
}

/**
 * Order two npm versions: positive when `a` is newer than `b`, negative when
 * older, 0 when equal. Missing numeric parts count as 0 (`1.2` === `1.2.0`)
 * and, per semver, a prerelease sorts below the release it leads to
 * (`1.2.0-beta.1` < `1.2.0`). Two prereleases of the same release compare as
 * plain strings, which is enough to decide whether to offer an update.
 */
export function compareVersions(a: string, b: string): number {
  const left = releaseParts(a);
  const right = releaseParts(b);
  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** Opt out of the network call entirely (air-gapped machines, tests). */
export function isUpdateCheckDisabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const value = env.REFLEX_NO_UPDATE_CHECK;
  return value !== undefined && value !== '' && value !== '0' && value !== 'false';
}

export interface UpdateCheckOptions {
  /** Null when the running version is unknown; nothing to compare against. */
  currentVersion?: string | null;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

/**
 * Ask npm what it publishes as `latest` and return it when it is newer than
 * what is running, else null. Never throws: an offline machine, a proxy, or a
 * slow registry just means no update notice this session.
 */
export async function checkForUpdate({
  currentVersion = CLI_VERSION,
  fetchImpl = fetch,
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: UpdateCheckOptions = {}): Promise<string | null> {
  if (!currentVersion || isUpdateCheckDisabled(env)) return null;
  try {
    const response = await fetchImpl(REGISTRY_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown } | null;
    const latest = body?.version;
    if (typeof latest !== 'string' || latest.length === 0) return null;
    return compareVersions(latest, currentVersion) > 0 ? latest : null;
  } catch {
    return null;
  }
}
