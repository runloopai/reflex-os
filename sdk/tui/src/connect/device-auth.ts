import {
  DeviceStartResponseSchema,
  DeviceTokenApprovedSchema,
  type DeviceStartResponse,
} from '@reflex/shared';

/**
 * Client for the server's device-authorization ("connect link") flow. The CLI
 * starts a flow, prints/opens the returned URL, and polls the token endpoint
 * until the user approves in the browser. Both endpoints are public (the CLI
 * holds no credential yet), so these use plain `fetch` with no auth headers.
 */

/** Result of a single poll of the device token endpoint. */
export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'approved'; apiKey: string; organizationId: string }
  | { status: 'denied' }
  | { status: 'expired'; message?: string };

function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** Kick off a device-authorization flow. */
export async function startDeviceAuth(
  baseUrl: string,
  hostname?: string,
): Promise<DeviceStartResponse> {
  const res = await fetch(apiUrl(baseUrl, '/api/auth/device/start'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(hostname ? { hostname } : {}),
  });
  if (!res.ok) {
    throw new Error(`Could not start the connect flow (${res.status})`);
  }
  const json: unknown = await res.json();
  return DeviceStartResponseSchema.parse(json);
}

/**
 * Poll the token endpoint once. Maps the server's status codes into a small
 * result union so the caller doesn't have to reason about HTTP shapes.
 */
export async function pollDeviceTokenOnce(
  baseUrl: string,
  deviceCode: string,
): Promise<DevicePollResult> {
  const res = await fetch(apiUrl(baseUrl, '/api/auth/device/token'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  });

  if (res.status === 200) {
    const approved = DeviceTokenApprovedSchema.parse(await res.json());
    return {
      status: 'approved',
      apiKey: approved.apiKey,
      organizationId: approved.organizationId,
    };
  }
  if (res.status === 202) {
    return { status: 'pending' };
  }
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    if (body.error === 'access_denied') return { status: 'denied' };
    return { status: 'expired', message: body.error_description };
  }
  throw new Error(`Unexpected response while connecting (${res.status})`);
}

const DEFAULT_INTERVAL_SECONDS = 2;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DeviceAuthAbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DeviceAuthAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Thrown by {@link waitForDeviceToken} when its abort signal fires. */
export class DeviceAuthAbortError extends Error {
  constructor() {
    super('Device authorization was cancelled');
    this.name = 'DeviceAuthAbortError';
  }
}

export interface WaitForDeviceTokenOptions {
  /** Seconds between polls. Defaults to the server-advised interval. */
  intervalSeconds?: number;
  /** Abort the wait (e.g. on Ctrl-C or unmount). */
  signal?: AbortSignal;
  /** Injectable delay for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Poll until the flow resolves (approved / denied / expired). Pending polls
 * sleep for `intervalSeconds`. Rejects with {@link DeviceAuthAbortError} when
 * the signal fires between polls.
 */
export async function waitForDeviceToken(
  baseUrl: string,
  deviceCode: string,
  options: WaitForDeviceTokenOptions = {},
): Promise<Exclude<DevicePollResult, { status: 'pending' }>> {
  const intervalMs = (options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000;
  const sleep = options.sleep ?? delay;
  for (;;) {
    if (options.signal?.aborted) throw new DeviceAuthAbortError();
    const result = await pollDeviceTokenOnce(baseUrl, deviceCode);
    if (result.status !== 'pending') return result;
    await sleep(intervalMs, options.signal);
  }
}
