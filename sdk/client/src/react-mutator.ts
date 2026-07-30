/**
 * orval mutator for the react-query client (`src/react/*`).
 *
 * orval (client: 'react-query', httpClient: 'axios', custom mutator) calls
 * `apiFetch<T>({ url, method, params, data, headers, signal })` and expects
 * the parsed body back (`Promise<T>`) — not the fetch client's
 * `{ data, status, headers }` envelope. This adapter serializes the config
 * into a path + `RequestInit` and delegates to the shared SDK transport
 * ({@link reflexRequest}), so the hooks inherit auth headers, org scoping,
 * 401 handling, credentials, and `ReflexApiError` parsing for free.
 *
 * Org scoping: the transport injects `x-organization-id` from the configured
 * (or dynamic) org, but an `x-organization-id` passed in `headers` by a
 * caller wins — that explicit pass-through is what lets org-scoped facades
 * make the org id a compile-time requirement.
 */
import { reflexRequest } from './http.js';
import type { ReflexRequestOptions } from './http.js';

export interface ApiFetchConfig {
  url: string;
  method: string;
  params?: Record<string, unknown>;
  data?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  responseType?: string;
}

function toQueryString(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export const apiFetch = async <T>(
  config: ApiFetchConfig,
  options?: ReflexRequestOptions,
): Promise<T> => {
  const { url, method, params, data, headers, signal } = config;
  const init: RequestInit = { method: method.toUpperCase() };
  if (data !== undefined) init.body = typeof data === 'string' ? data : JSON.stringify(data);
  if (headers) init.headers = headers;
  if (signal) init.signal = signal;
  return reflexRequest<T>(`${url}${toQueryString(params)}`, init, options);
};

export default apiFetch;
