import { z } from 'zod';
import type { PollDeviceAuthToken200, StartDeviceAuth201 } from '@runloop/reflex-client';

export type DeviceStartResponse = StartDeviceAuth201;

/** The `approved` arm of the token endpoint's response union. */
type DeviceTokenApproved = Extract<PollDeviceAuthToken200, { status: 'approved' }>;

// These endpoints are hit with plain `fetch` rather than the generated client
// (the CLI holds no credential yet), so the responses are parsed here instead
// of trusted. Annotating each schema with the generated response type makes a
// drift between this validation and the API a compile error rather than a
// runtime surprise.
const DeviceStartResponseSchema: z.ZodType<DeviceStartResponse> = z.object({
  deviceCode: z.string(),
  userCode: z.string(),
  verificationUri: z.string(),
  verificationUriComplete: z.string(),
  interval: z.number(),
  expiresIn: z.number(),
  acknowledgementRequired: z.boolean().optional(),
});

const DeviceTokenApprovedSchema: z.ZodType<DeviceTokenApproved> = z.object({
  status: z.literal('approved'),
  apiKey: z.string(),
  organizationId: z.string(),
});

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

/** A network, rate-limit, or server failure that is safe to retry. */
class TransientDeviceAuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransientDeviceAuthError';
  }
}

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
    body: JSON.stringify({ ...(hostname ? { hostname } : {}), supportsAcknowledgement: true }),
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
  let res: Response;
  try {
    res = await fetch(apiUrl(baseUrl, '/api/auth/device/token'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    });
  } catch (cause) {
    throw new TransientDeviceAuthError('Could not reach the device token endpoint', { cause });
  }

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
  if (res.status === 429 || res.status >= 500) {
    throw new TransientDeviceAuthError(`Temporary response while connecting (${res.status})`);
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
  /** Bound retries for transient failures. Defaults to the server's 10-minute TTL. */
  expiresInSeconds?: number;
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
  const deadline = Date.now() + (options.expiresInSeconds ?? 10 * 60) * 1000;
  for (;;) {
    if (options.signal?.aborted) throw new DeviceAuthAbortError();
    let result: DevicePollResult;
    try {
      result = await pollDeviceTokenOnce(baseUrl, deviceCode);
    } catch (err) {
      if (!(err instanceof TransientDeviceAuthError) || Date.now() >= deadline) throw err;
      await sleep(intervalMs, options.signal);
      continue;
    }
    if (result.status !== 'pending') return result;
    await sleep(intervalMs, options.signal);
  }
}

export interface AcknowledgeDeviceTokenOptions {
  /** Seconds between retries of transient failures. */
  intervalSeconds?: number;
  /** Maximum time spent retrying acknowledgement. */
  timeoutSeconds?: number;
  signal?: AbortSignal;
  /** Injectable delay for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Erase the server's encrypted handoff after the caller has durably stored the
 * API key. The endpoint is idempotent, so both the request and a lost response
 * can be retried safely.
 */
export async function acknowledgeDeviceToken(
  baseUrl: string,
  deviceCode: string,
  options: AcknowledgeDeviceTokenOptions = {},
): Promise<void> {
  const intervalMs = (options.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS) * 1000;
  const deadline = Date.now() + (options.timeoutSeconds ?? 30) * 1000;
  const sleep = options.sleep ?? delay;
  for (;;) {
    if (options.signal?.aborted) throw new DeviceAuthAbortError();
    let res: Response | undefined;
    try {
      res = await fetch(apiUrl(baseUrl, '/api/auth/device/acknowledge'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceCode }),
      });
    } catch {
      // Fetch failed before a response. The idempotent endpoint makes it safe
      // to retry even when the server committed but the response was lost.
    }
    if (res?.status === 204) return;
    if (res && res.status !== 429 && res.status < 500) {
      throw new Error(`Could not acknowledge the saved credential (${res.status})`);
    }
    if (Date.now() >= deadline) {
      throw new Error('Could not acknowledge the saved credential before the retry deadline');
    }
    await sleep(intervalMs, options.signal);
  }
}
