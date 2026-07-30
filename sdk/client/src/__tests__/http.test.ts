import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiFetch,
  configureReflex,
  getReflexConfig,
  reflexRequest,
  ReflexApiError,
  resetReflexConfig,
} from '../http.js';
import type { ApiResponseEnvelope } from '../http.js';
import { apiFetch as reactApiFetch } from '../react-mutator.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubbedConfig(fetchStub: ReturnType<typeof vi.fn>, organizationId?: string): void {
  configureReflex({
    baseUrl: 'https://r.example.com',
    apiKey: 'rfx_secret',
    ...(organizationId ? { organizationId } : {}),
    fetch: fetchStub as unknown as typeof fetch,
  });
}

afterEach(() => {
  resetReflexConfig();
});

describe('configureReflex / getReflexConfig', () => {
  it('throws a helpful error when unconfigured', () => {
    expect(() => getReflexConfig()).toThrow(/configureReflex/);
  });

  it('rejects a missing baseUrl or apiKey', () => {
    expect(() => configureReflex({ baseUrl: '', apiKey: 'rfx_x' })).toThrow(/baseUrl/);
    expect(() => configureReflex({ baseUrl: 'https://r.example.com', apiKey: '' })).toThrow(
      /apiKey/,
    );
  });

  it('accepts getToken instead of apiKey, and an empty baseUrl with getToken (same-origin host)', () => {
    expect(() =>
      configureReflex({ baseUrl: 'https://r.example.com', getToken: () => 'tok' }),
    ).not.toThrow();
    expect(() => configureReflex({ baseUrl: '', getToken: () => 'tok' })).not.toThrow();
  });

  it('strips trailing slashes from baseUrl', () => {
    configureReflex({ baseUrl: 'https://r.example.com/', apiKey: 'rfx_x' });
    expect(getReflexConfig().baseUrl).toBe('https://r.example.com');
  });
});

describe('apiFetch', () => {
  it('throws before configureReflex is called', async () => {
    await expect(apiFetch('/agents', { method: 'GET' })).rejects.toThrow(/configureReflex/);
  });

  it('prefixes /api and injects auth + org headers', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse([]));
    stubbedConfig(fetchStub, 'org_123');

    const result = await apiFetch<ApiResponseEnvelope<unknown[]>>('/agents?limit=5', {
      method: 'GET',
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://r.example.com/api/agents?limit=5');
    expect(init.method).toBe('GET');
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer rfx_secret');
    expect(headers.get('x-organization-id')).toBe('org_123');
    expect(result.data).toEqual([]);
    expect(result.status).toBe(200);
  });

  it('omits the org header when no organizationId is configured', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({}));
    stubbedConfig(fetchStub);

    await apiFetch('/me', { method: 'GET' });

    const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).has('x-organization-id')).toBe(false);
  });

  it('preserves generated request bodies and Content-Type', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ ok: true }, 201));
    stubbedConfig(fetchStub);

    // Mirrors what a generated POST operation passes to the mutator.
    await apiFetch('/agents/a1/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });

    const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"message":"hi"}');
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer rfx_secret');
  });

  it('lets explicit headers override the configured org', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({}));
    stubbedConfig(fetchStub, 'org_default');

    await apiFetch('/agents', {
      method: 'GET',
      headers: { 'x-organization-id': 'org_other' },
    });

    const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('x-organization-id')).toBe('org_other');
  });

  it('allows a request to explicitly override or omit the configured org', async () => {
    const fetchStub = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    stubbedConfig(fetchStub, 'org_default');

    await reflexRequest('/agents', { method: 'GET' }, { organizationId: 'org_pinned' });
    await reflexRequest('/config', { method: 'GET' }, { organizationId: null });

    const firstHeaders = (fetchStub.mock.calls[0]![1] as RequestInit).headers as Headers;
    const secondHeaders = (fetchStub.mock.calls[1]![1] as RequestInit).headers as Headers;
    expect(firstHeaders.get('x-organization-id')).toBe('org_pinned');
    expect(secondHeaders.has('x-organization-id')).toBe(false);
  });

  it('parses the server error envelope into ReflexApiError', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: 'validation_error',
          message: 'name: Required',
          hint: 'Pass a name',
          issues: [{ path: ['name'], message: 'Required' }],
        },
        400,
      ),
    );
    stubbedConfig(fetchStub);

    const error = await apiFetch('/agents', { method: 'POST' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ReflexApiError);
    const apiError = error as ReflexApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe('validation_error');
    expect(apiError.message).toBe('name: Required');
    expect(apiError.hint).toBe('Pass a name');
    expect(apiError.issues).toEqual([{ path: ['name'], message: 'Required' }]);
    expect(apiError.body.error).toBe('validation_error');
  });

  it('handles non-JSON error bodies', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('boom', { status: 502 }));
    stubbedConfig(fetchStub);

    const error = await apiFetch('/agents', { method: 'GET' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReflexApiError);
    expect((error as ReflexApiError).status).toBe(502);
    expect((error as ReflexApiError).message).toBe('Request failed: 502');
  });

  it('turns a response-body deadline into a typed timeout error', async () => {
    const fetchStub = vi.fn(async (_input, init: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener('abort', () =>
            controller.error(init.signal?.reason ?? new DOMException('aborted', 'AbortError')),
          );
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    stubbedConfig(fetchStub);

    const error = await reflexRequest('/agents', {}, { timeoutMs: 10 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ReflexApiError);
    expect(error).toMatchObject({ status: 0, code: 'TIMEOUT', message: 'Request timed out' });
  });

  it('resolves with undefined data for 204 responses', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    stubbedConfig(fetchStub);

    const result = await apiFetch<ApiResponseEnvelope>('/me/api-keys/pak_1', {
      method: 'DELETE',
    });
    expect(result.data).toBe(undefined);
    expect(result.status).toBe(204);
  });

  it('resolves with undefined data for empty (content-length: 0) responses', async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200, headers: { 'content-length': '0' } }));
    stubbedConfig(fetchStub);

    const result = await apiFetch<ApiResponseEnvelope>('/agents/a1/stop', { method: 'POST' });
    expect(result.data).toBe(undefined);
  });

  it('can parse a successful plain-text response', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('service output', { status: 200 }));
    stubbedConfig(fetchStub);

    const result = await reflexRequest<string>('/agents/a1/services/launch/logs', undefined, {
      responseType: 'text',
    });

    expect(result).toBe('service output');
  });

  it('infers plain-text parsing from the response content type', async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response('generated service output', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
    );
    stubbedConfig(fetchStub);

    await expect(reflexRequest<string>('/agents/a1/services/launch/logs')).resolves.toBe(
      'generated service output',
    );
  });
});

describe('session-auth configuration (getToken / getOrganizationId / onUnauthorized)', () => {
  it('reads getToken on every request and prefers it over apiKey', async () => {
    const fetchStub = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    let token: string | null = 'session_1';
    configureReflex({
      baseUrl: 'https://r.example.com',
      apiKey: 'rfx_fallback',
      getToken: () => token,
      fetch: fetchStub as unknown as typeof fetch,
    });

    await reflexRequest('/me', { method: 'GET' });
    expect(
      (fetchStub.mock.calls[0]![1] as RequestInit).headers instanceof Headers &&
        ((fetchStub.mock.calls[0]![1] as RequestInit).headers as Headers).get('Authorization'),
    ).toBe('Bearer session_1');

    token = 'session_2';
    await reflexRequest('/me', { method: 'GET' });
    expect(
      ((fetchStub.mock.calls[1]![1] as RequestInit).headers as Headers).get('Authorization'),
    ).toBe('Bearer session_2');

    // Falls back to apiKey when the provider has no token.
    token = null;
    await reflexRequest('/me', { method: 'GET' });
    expect(
      ((fetchStub.mock.calls[2]![1] as RequestInit).headers as Headers).get('Authorization'),
    ).toBe('Bearer rfx_fallback');
  });

  it('sends no Authorization header when getToken returns null and no apiKey is set', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({}));
    configureReflex({
      baseUrl: 'https://r.example.com',
      getToken: () => null,
      fetch: fetchStub as unknown as typeof fetch,
    });

    await reflexRequest('/config', { method: 'GET' });
    expect(
      ((fetchStub.mock.calls[0]![1] as RequestInit).headers as Headers).has('Authorization'),
    ).toBe(false);
  });

  it('prefers getOrganizationId over the static organizationId, with fallback', async () => {
    const fetchStub = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    let org: string | null = 'org_from_url';
    configureReflex({
      baseUrl: 'https://r.example.com',
      apiKey: 'rfx_x',
      organizationId: 'org_static',
      getOrganizationId: () => org,
      fetch: fetchStub as unknown as typeof fetch,
    });

    await reflexRequest('/agents', { method: 'GET' });
    expect(
      ((fetchStub.mock.calls[0]![1] as RequestInit).headers as Headers).get('x-organization-id'),
    ).toBe('org_from_url');

    org = null;
    await reflexRequest('/agents', { method: 'GET' });
    expect(
      ((fetchStub.mock.calls[1]![1] as RequestInit).headers as Headers).get('x-organization-id'),
    ).toBe('org_static');
  });

  it('explicit x-organization-id headers win over the dynamic provider', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({}));
    configureReflex({
      baseUrl: 'https://r.example.com',
      apiKey: 'rfx_x',
      getOrganizationId: () => 'org_dynamic',
      fetch: fetchStub as unknown as typeof fetch,
    });

    await reflexRequest('/agents', {
      method: 'GET',
      headers: { 'x-organization-id': 'org_explicit' },
    });
    expect(
      ((fetchStub.mock.calls[0]![1] as RequestInit).headers as Headers).get('x-organization-id'),
    ).toBe('org_explicit');
  });

  it('invokes onUnauthorized on 401 (then still throws), with per-request opt-out', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401));
    const onUnauthorized = vi.fn();
    configureReflex({
      baseUrl: 'https://r.example.com',
      getToken: () => 'tok',
      onUnauthorized,
      fetch: fetchStub as unknown as typeof fetch,
    });

    await expect(reflexRequest('/users', { method: 'GET' })).rejects.toBeInstanceOf(ReflexApiError);
    expect(onUnauthorized).toHaveBeenCalledWith({ path: '/users' });

    onUnauthorized.mockClear();
    await expect(
      reflexRequest('/integration/status', { method: 'GET' }, { notifyOnUnauthorized: false }),
    ).rejects.toBeInstanceOf(ReflexApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not invoke onUnauthorized for non-401 errors', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ error: 'forbidden' }, 403));
    const onUnauthorized = vi.fn();
    configureReflex({
      baseUrl: 'https://r.example.com',
      getToken: () => 'tok',
      onUnauthorized,
      fetch: fetchStub as unknown as typeof fetch,
    });

    await expect(reflexRequest('/users', { method: 'GET' })).rejects.toBeInstanceOf(ReflexApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('sends credentials: include for cross-origin session auth, and honors an explicit credentials config', async () => {
    const fetchStub = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({})));
    configureReflex({
      baseUrl: 'https://r.example.com',
      getToken: () => 'tok',
      fetch: fetchStub as unknown as typeof fetch,
    });
    await reflexRequest('/me', { method: 'GET' });
    expect((fetchStub.mock.calls[0]![1] as RequestInit).credentials).toBe('include');

    // Same-origin (relative) session auth: no credentials override.
    fetchStub.mockClear();
    configureReflex({
      baseUrl: '',
      getToken: () => 'tok',
      fetch: fetchStub as unknown as typeof fetch,
    });
    await reflexRequest('/me', { method: 'GET' });
    expect((fetchStub.mock.calls[0]![1] as RequestInit).credentials).toBe(undefined);
    expect(fetchStub.mock.calls[0]![0]).toBe('/api/me');

    // API-key auth never opts into cookies implicitly.
    fetchStub.mockClear();
    configureReflex({
      baseUrl: 'https://r.example.com',
      apiKey: 'rfx_x',
      fetch: fetchStub as unknown as typeof fetch,
    });
    await reflexRequest('/me', { method: 'GET' });
    expect((fetchStub.mock.calls[0]![1] as RequestInit).credentials).toBe(undefined);

    // Explicit config always wins.
    fetchStub.mockClear();
    configureReflex({
      baseUrl: 'https://r.example.com',
      apiKey: 'rfx_x',
      credentials: 'include',
      fetch: fetchStub as unknown as typeof fetch,
    });
    await reflexRequest('/me', { method: 'GET' });
    expect((fetchStub.mock.calls[0]![1] as RequestInit).credentials).toBe('include');
  });

  it('reflexRequest resolves with the parsed body (not the envelope)', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ keys: [] }));
    stubbedConfig(fetchStub);

    const result = await reflexRequest<{ keys: unknown[] }>('/me/api-keys', { method: 'GET' });
    expect(result).toEqual({ keys: [] });
  });
});

describe('react-mutator apiFetch', () => {
  it('serializes params into the query string and JSON-encodes bodies', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    stubbedConfig(fetchStub, 'org_1');

    const result = await reactApiFetch<{ ok: boolean }>({
      url: '/agents',
      method: 'post',
      params: { limit: 5, cursor: undefined },
      data: { name: 'a' },
      headers: { 'Content-Type': 'application/json' },
    });

    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://r.example.com/api/agents?limit=5');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"a"}');
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json');
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer rfx_secret');
    expect((init.headers as Headers).get('x-organization-id')).toBe('org_1');
    expect(result).toEqual({ ok: true });
  });

  it('forwards per-operation transport options', async () => {
    const fetchStub = vi.fn().mockResolvedValue(jsonResponse([]));
    stubbedConfig(fetchStub, 'org_default');

    await reactApiFetch(
      { url: '/config/plugins', method: 'get' },
      { organizationId: 'org_pinned', cache: 'no-store' },
    );

    const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('x-organization-id')).toBe('org_pinned');
    expect(init.cache).toBe('no-store');
  });
});
