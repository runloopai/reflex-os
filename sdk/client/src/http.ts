/**
 * HTTP transport for the Reflex SDK.
 *
 * Framework-agnostic: no localStorage, no build-time env vars. All runtime
 * configuration comes from an explicit `configureReflex(...)` call, which
 * makes the SDK usable from browsers, Node, workers, and tests alike.
 *
 * Two auth modes share this transport:
 *
 * - **API key** (`apiKey`): the simple path for external apps. Every request
 *   carries `Authorization: Bearer rfx_...`.
 * - **Dynamic token** (`getToken`): for host apps that own a session (e.g.
 *   the Reflex web app itself). The provider is read on every request, so
 *   sign-in/sign-out is picked up without reconfiguring.
 *
 * This module is also the orval mutator for the fetch client: every generated
 * operation routes through {@link apiFetch}. The react-query client's
 * operations route through `react-mutator.ts`, which delegates to
 * {@link reflexRequest}. Both inject the `Authorization` and
 * `x-organization-id` headers, prefix the server origin with `/api`, and
 * normalize errors into {@link ReflexApiError}.
 */

/** Runtime configuration for the Reflex SDK. */
export interface ReflexClientConfig {
  /**
   * Server origin, e.g. `https://reflex.runloop.ai`. The transport appends
   * `/api` to every request path, so pass the bare origin. Host apps served
   * from the same origin as the API may pass `''` (only valid together with
   * `getToken`); requests then go to the relative `/api/...` path.
   */
  baseUrl: string;
  /** Personal API key minted via POST /api/me/api-keys (`rfx_...`). */
  apiKey?: string;
  /**
   * Dynamic bearer token provider, read on every request. Takes precedence
   * over `apiKey`; when it returns `null`/`undefined` the transport falls
   * back to `apiKey` (and sends no `Authorization` header if neither is
   * available). Either `apiKey` or `getToken` must be configured.
   */
  getToken?: () => string | null | undefined;
  /**
   * Organization to scope requests to: an org id (`org_...`) or the org
   * slug. Must be an org the key's user belongs to. When omitted, requests
   * to org-scoped endpoints fail with `no_active_organization`; user-scoped
   * endpoints (like `/me/*`) still work.
   */
  organizationId?: string;
  /**
   * Dynamic organization provider, read on every request. Takes precedence
   * over the static `organizationId`; when it returns `null`/`undefined`
   * the transport falls back to `organizationId`. Headers already present
   * on a request still win over both.
   */
  getOrganizationId?: () => string | null | undefined;
  /**
   * Invoked when a response comes back 401, before the error is thrown.
   * Host apps use this to drop a stale session (clear the stored token,
   * redirect to sign-in). Individual requests can opt out via
   * {@link ReflexRequestOptions.notifyOnUnauthorized} (e.g. integration
   * routes whose 401 means a third-party connection needs reauth, not that
   * the session died).
   */
  onUnauthorized?: (ctx: { path: string }) => void;
  /**
   * Value for `RequestInit.credentials`. When omitted, the transport sends
   * `credentials: 'include'` automatically for cross-origin session auth
   * (an absolute `baseUrl` combined with `getToken`), and nothing
   * otherwise. API-key requests never need cookies.
   */
  credentials?: RequestCredentials;
  /** Default request deadline; individual operations may override it. */
  timeoutMs?: number;
  /** Custom fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
}

let activeConfig: ReflexClientConfig | null = null;

/**
 * Set the SDK configuration. Call once at startup before using any API
 * function or opening a `ReflexSocket`. Calling again replaces the config;
 * subsequent requests (and socket reconnects) pick up the new values.
 */
export function configureReflex(config: ReflexClientConfig): void {
  // A relative (empty) baseUrl only makes sense for a same-origin host app
  // with session auth; API-key consumers are external and need an origin.
  if (!config.baseUrl && !config.getToken) {
    throw new Error('configureReflex: baseUrl is required (e.g. https://reflex.runloop.ai)');
  }
  if (!config.apiKey && !config.getToken) {
    throw new Error(
      'configureReflex: apiKey or getToken is required (mint a key via POST /api/me/api-keys)',
    );
  }
  // Trim trailing slashes without a regex: an anchored `/\/+$/` backtracks
  // quadratically on adversarial input (CodeQL js/polynomial-redos), and
  // baseUrl is caller-supplied.
  let baseUrl = config.baseUrl;
  while (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
  activeConfig = { ...config, baseUrl };
}

/**
 * Read the active configuration. Throws a descriptive error when
 * `configureReflex` has not been called yet. Used by the transport and by
 * `ReflexSocket` to build the WebSocket URL.
 */
export function getReflexConfig(): ReflexClientConfig {
  if (!activeConfig) {
    throw new Error(
      'Reflex SDK is not configured. Call configureReflex({ baseUrl, apiKey, organizationId }) ' +
        'before making requests.',
    );
  }
  return activeConfig;
}

/** Test seam: clear the module-level configuration. */
export function resetReflexConfig(): void {
  activeConfig = null;
}

/**
 * Resolve the bearer token for a request: the dynamic provider first, then
 * the static API key. Shared by the HTTP transport and `ReflexSocket`.
 */
export function resolveReflexToken(config: ReflexClientConfig): string | undefined {
  return (config.getToken ? config.getToken() : undefined) ?? config.apiKey ?? undefined;
}

/**
 * Resolve the organization for a request: the dynamic provider first, then
 * the static value. Shared by the HTTP transport and `ReflexSocket`.
 */
export function resolveReflexOrganizationId(config: ReflexClientConfig): string | undefined {
  return (
    (config.getOrganizationId ? config.getOrganizationId() : undefined) ??
    config.organizationId ??
    undefined
  );
}

/**
 * One field-level validation problem from the server's canonical
 * `validation_error` envelope. `path` follows Zod's shape: object keys and
 * array indices leading to the offending value.
 */
export interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Typed error for non-2xx API responses.
 *
 * Mirrors the server's error envelope: `error` carries the machine-readable
 * discriminator (surfaced here as `code`), `message` the human-readable copy,
 * and 400 validation failures include an `issues` array.
 */
export class ReflexApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly hint?: string;
  readonly body: Record<string, unknown>;
  readonly issues?: ValidationIssue[];

  constructor(
    message: string,
    status: number,
    code?: string,
    hint?: string,
    body: Record<string, unknown> = {},
    issues?: ValidationIssue[],
  ) {
    super(message);
    this.name = 'ReflexApiError';
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.body = body;
    this.issues = issues;
  }
}

/** Per-request options for {@link reflexRequest}. */
export interface ReflexRequestOptions {
  /**
   * Whether a 401 response should invoke the configured `onUnauthorized`
   * handler. Defaults to `true`. Pass `false` for requests whose 401 is a
   * connection-level reauth (e.g. an expired third-party OAuth token) rather
   * than a dead session.
   */
  notifyOnUnauthorized?: boolean;
  /**
   * Override organization scoping for this request. A string pins the
   * `x-organization-id` header to that organization; `null` deliberately
   * omits the header. When undefined, the configured organization provider
   * is used.
   */
  organizationId?: string | null;
  /**
   * Abort the request when it has not completed within this many
   * milliseconds. The deadline covers both receiving the response headers
   * and consuming the response body.
   */
  timeoutMs?: number;
  /** Override the Fetch API cache mode for this request. */
  cache?: RequestCache;
  /**
   * Parse a successful response as JSON or plain text. When omitted, the
   * transport follows the response Content-Type and falls back to JSON when
   * a lightweight test double does not expose headers.
   */
  responseType?: 'json' | 'text';
}

/**
 * Response envelope the generated fetch client expects from the mutator:
 * parsed body plus status and headers. Each generated operation narrows
 * `data`/`status` to the operation's declared responses.
 */
export interface ApiResponseEnvelope<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

/**
 * Shared request core:
 *
 * - Prefixes `<baseUrl>/api` so generated URLs stay bare (e.g. `/agents`).
 * - Injects `Authorization` (from `getToken` or `apiKey`) and
 *   `x-organization-id` (from `getOrganizationId` or `organizationId`);
 *   headers already present in `init` win, so callers can override org
 *   scoping per call via `options.headers`.
 * - Sends `credentials: 'include'` for cross-origin session auth (see
 *   {@link ReflexClientConfig.credentials}).
 * - Calls `onUnauthorized` on 401 (unless the request opts out), then
 *   throws {@link ReflexApiError} like any other non-2xx response.
 * - 204 / empty responses resolve with `data: undefined`.
 */
async function executeRequest(
  path: string,
  init: RequestInit,
  opts?: ReflexRequestOptions,
): Promise<ApiResponseEnvelope> {
  const config = getReflexConfig();

  const headers = new Headers(init.headers);
  const token = resolveReflexToken(config);
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  const organizationId =
    opts?.organizationId !== undefined
      ? (opts.organizationId ?? undefined)
      : resolveReflexOrganizationId(config);
  if (organizationId && !headers.has('x-organization-id')) {
    headers.set('x-organization-id', organizationId);
  }

  const credentials =
    config.credentials ??
    (config.getToken && config.baseUrl.startsWith('http') ? ('include' as const) : undefined);

  const fetchImpl = config.fetch ?? globalThis.fetch;
  const timeoutMs = opts?.timeoutMs ?? config.timeoutMs;
  const timeoutController = timeoutMs !== undefined ? new AbortController() : undefined;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortFromCaller = () => timeoutController?.abort(init.signal?.reason);

  if (timeoutController) {
    if (init.signal?.aborted) {
      abortFromCaller();
    } else {
      init.signal?.addEventListener('abort', abortFromCaller, { once: true });
    }
    timeoutId = setTimeout(() => {
      timedOut = true;
      timeoutController.abort();
    }, timeoutMs);
  }

  try {
    const res = await fetchImpl(`${config.baseUrl}/api${path}`, {
      ...init,
      headers,
      signal: timeoutController?.signal ?? init.signal,
      ...(opts?.cache ? { cache: opts.cache } : {}),
      ...(credentials ? { credentials } : {}),
    });

    if (res.status === 401 && (opts?.notifyOnUnauthorized ?? true)) {
      config.onUnauthorized?.({ path });
    }

    if (!res.ok) {
      let body: Record<string, unknown> & {
        error?: string;
        message?: string;
        code?: string;
        hint?: string;
        issues?: ValidationIssue[];
      } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        if (timedOut) throw new ReflexApiError('Request timed out', 0, 'TIMEOUT');
      }
      const code = body.code ?? body.error;
      const message =
        res.status === 413
          ? 'Attachments are too large. Remove some files or use smaller ones, then try again.'
          : (body.message ?? body.error ?? `Request failed: ${res.status}`);
      throw new ReflexApiError(
        message,
        res.status,
        code,
        body.hint,
        body,
        Array.isArray(body.issues) ? body.issues : undefined,
      );
    }

    // `headers` is always present on a platform Response. The optional access
    // also keeps the transport friendly to the lightweight Response doubles
    // used by host-app tests.
    const empty = res.status === 204 || res.headers?.get('content-length') === '0';
    const contentType = res.headers?.get('content-type')?.toLowerCase();
    const responseType =
      opts?.responseType ?? (contentType && !contentType.includes('json') ? 'text' : 'json');
    const data = empty ? undefined : responseType === 'text' ? await res.text() : await res.json();
    return { data, status: res.status, headers: res.headers };
  } catch (error) {
    if (timedOut && !(error instanceof ReflexApiError && error.code === 'TIMEOUT')) {
      throw new ReflexApiError('Request timed out', 0, 'TIMEOUT');
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
}

/**
 * Execute one API request and resolve with the parsed body. This is the
 * transport behind the react-query client (via `react-mutator.ts`) and the
 * primitive host apps build their own `request()` helpers on.
 */
export async function reflexRequest<T>(
  path: string,
  init: RequestInit = {},
  opts?: ReflexRequestOptions,
): Promise<T> {
  const { data } = await executeRequest(path, init, opts);
  return data as T;
}

/**
 * Execute one API request. This is the orval fetch-client mutator: called
 * with the operation's URL (query string already baked in) and a
 * `RequestInit`, it returns `{ data, status, headers }`.
 */
export const apiFetch = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  return (await executeRequest(url, init)) as T;
};

export default apiFetch;
