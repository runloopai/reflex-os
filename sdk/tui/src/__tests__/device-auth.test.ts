import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeviceAuthAbortError,
  acknowledgeDeviceToken,
  pollDeviceTokenOnce,
  startDeviceAuth,
  waitForDeviceToken,
} from '../connect/device-auth.js';

const BASE = 'https://reflex.example.com';

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const { status, body } of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('startDeviceAuth', () => {
  it('posts the hostname and parses the start response', async () => {
    const fetchMock = mockFetchSequence([
      {
        status: 201,
        body: {
          deviceCode: 'dev-code',
          userCode: 'WXYZ-1234',
          verificationUri: `${BASE}/connect`,
          verificationUriComplete: `${BASE}/connect?code=WXYZ-1234`,
          interval: 2,
          expiresIn: 600,
          acknowledgementRequired: true,
        },
      },
    ]);

    const res = await startDeviceAuth(BASE, 'my-laptop');
    expect(res.userCode).toBe('WXYZ-1234');
    expect(res.verificationUriComplete).toContain('code=WXYZ-1234');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/auth/device/start`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      hostname: 'my-laptop',
      supportsAcknowledgement: true,
    });
  });

  it('throws when the server rejects the start request', async () => {
    mockFetchSequence([{ status: 500, body: {} }]);
    await expect(startDeviceAuth(BASE)).rejects.toThrow(/connect flow/i);
  });
});

describe('pollDeviceTokenOnce', () => {
  it('maps 202 to pending', async () => {
    mockFetchSequence([{ status: 202, body: { status: 'authorization_pending' } }]);
    expect(await pollDeviceTokenOnce(BASE, 'dev')).toEqual({ status: 'pending' });
  });

  it('maps 200 to approved with the credential', async () => {
    mockFetchSequence([
      { status: 200, body: { status: 'approved', apiKey: 'rfx_secret', organizationId: 'org_1' } },
    ]);
    expect(await pollDeviceTokenOnce(BASE, 'dev')).toEqual({
      status: 'approved',
      apiKey: 'rfx_secret',
      organizationId: 'org_1',
    });
  });

  it('maps access_denied to denied', async () => {
    mockFetchSequence([{ status: 400, body: { error: 'access_denied' } }]);
    expect(await pollDeviceTokenOnce(BASE, 'dev')).toEqual({ status: 'denied' });
  });

  it('maps other 400s to expired', async () => {
    mockFetchSequence([
      { status: 400, body: { error: 'expired_token', error_description: 'gone' } },
    ]);
    expect(await pollDeviceTokenOnce(BASE, 'dev')).toEqual({ status: 'expired', message: 'gone' });
  });
});

describe('waitForDeviceToken', () => {
  it('polls until the flow is approved', async () => {
    mockFetchSequence([
      { status: 202, body: { status: 'authorization_pending' } },
      { status: 202, body: { status: 'authorization_pending' } },
      { status: 200, body: { status: 'approved', apiKey: 'rfx_k', organizationId: 'org_1' } },
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await waitForDeviceToken(BASE, 'dev', { intervalSeconds: 1, sleep });
    expect(result).toEqual({ status: 'approved', apiKey: 'rfx_k', organizationId: 'org_1' });
    // Two pending polls → two sleeps before the approved poll.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('retries transient server failures during a rolling key rotation', async () => {
    mockFetchSequence([
      { status: 500, body: {} },
      { status: 200, body: { status: 'approved', apiKey: 'rfx_k', organizationId: 'org_1' } },
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(waitForDeviceToken(BASE, 'dev', { sleep })).resolves.toMatchObject({
      status: 'approved',
    });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('rejects when the abort signal is already set', async () => {
    mockFetchSequence([]);
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForDeviceToken(BASE, 'dev', { signal: controller.signal }),
    ).rejects.toBeInstanceOf(DeviceAuthAbortError);
  });
});

describe('acknowledgeDeviceToken', () => {
  it('posts the device code after durable storage', async () => {
    const fetchMock = mockFetchSequence([{ status: 204, body: undefined }]);
    await acknowledgeDeviceToken(BASE, 'dev');

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/auth/device/acknowledge`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ deviceCode: 'dev' });
  });

  it('retries a transient acknowledgement response', async () => {
    mockFetchSequence([
      { status: 503, body: {} },
      { status: 204, body: undefined },
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await acknowledgeDeviceToken(BASE, 'dev', { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
