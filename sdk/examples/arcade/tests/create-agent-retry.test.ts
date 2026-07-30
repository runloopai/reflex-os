/**
 * The one retry in the launch path.
 *
 * `createGameAgent` asks for `sandboxOptions.resumeOnHttp` and retries
 * without it on deployments too old to know the option. That retry must not
 * widen: a 400 about the pinned provider key means the same thing twice,
 * and sending the launch again without the pin would start the game under a
 * different account than the player picked — the exact thing the picker
 * exists to control.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ReflexApiError } from '../../../client/src/index.ts';

const createAgent = vi.hoisted(() => vi.fn());
vi.mock('../../../client/src/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../client/src/index.ts')>();
  return { ...actual, createAgent };
});

const { createGameAgent } = await import('../server/reflex.ts');

const creds = { apiKey: 'rfx_test', org: 'org_test' };
const input = {
  name: 'arcade: game',
  prompt: 'build it',
  systemPrompt: 'you are an agent',
  agentType: 'claude-code',
  model: null,
  providerSecretId: 'mps_pinned0000000000000001',
};

beforeEach(() => createAgent.mockReset());

describe('createGameAgent', () => {
  it('pins the chosen key on the first attempt', async () => {
    createAgent.mockResolvedValueOnce({ data: { id: 'agent_1' } });
    await createGameAgent(creds, input);
    expect(createAgent.mock.calls[0]?.[0]).toMatchObject({
      providerSecretId: 'mps_pinned0000000000000001',
      sandboxOptions: { resumeOnHttp: true },
    });
  });

  it('retries without sandboxOptions on an old deployment, keeping the pin', async () => {
    createAgent
      .mockRejectedValueOnce(
        new ReflexApiError('sandboxOptions: unrecognized key "resumeOnHttp"', 400),
      )
      .mockResolvedValueOnce({ data: { id: 'agent_2' } });
    await createGameAgent(creds, input);
    expect(createAgent).toHaveBeenCalledTimes(2);
    const retry = createAgent.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(retry.sandboxOptions).toBeUndefined();
    expect(retry.providerSecretId).toBe('mps_pinned0000000000000001');
  });

  it('does not retry a rejection of the pinned key', async () => {
    createAgent.mockRejectedValueOnce(
      new ReflexApiError('provider secret not visible to this user', 400),
    );
    await expect(createGameAgent(creds, input)).rejects.toThrow(/provider secret/);
    expect(createAgent).toHaveBeenCalledTimes(1);
  });

  it('does not retry anything that is not a 400', async () => {
    createAgent.mockRejectedValueOnce(new ReflexApiError('boom', 500));
    await expect(createGameAgent(creds, input)).rejects.toThrow('boom');
    expect(createAgent).toHaveBeenCalledTimes(1);
  });
});
