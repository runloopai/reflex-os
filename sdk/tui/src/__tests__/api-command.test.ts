import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApiRequest, resolveApiOp } from '../commands/api.js';
import { API_OPS } from '../generated/api-ops.js';
// @ts-expect-error -- plain .mjs script, imported for the drift check only.
import { buildApiOps, renderModule } from '../../scripts/generate-api-ops.mjs';

describe('resolveApiOp', () => {
  it('finds operations case-insensitively', () => {
    expect(resolveApiOp('listAgents').id).toBe('listAgents');
    expect(resolveApiOp('listagents').id).toBe('listAgents');
  });

  it('suggests near matches on a miss', () => {
    expect(() => resolveApiOp('agentList')).toThrow(/api --list/);
    expect(() => resolveApiOp('Agent')).toThrow(/Did you mean: .*getAgent/);
  });
});

describe('buildApiRequest', () => {
  const sendMessage = resolveApiOp('sendAgentMessage');
  const list = resolveApiOp('listAgents');

  it('fills path params from positionals in URL order', () => {
    const { path, init } = buildApiRequest(sendMessage, ['agt_1'], {
      field: ['message=hello'],
    });
    expect(path).toBe('/agents/agt_1/message');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'hello' });
  });

  it('rejects a wrong positional count with the expected params', () => {
    expect(() => buildApiRequest(sendMessage, [], {})).toThrow(/expects <id>/);
    expect(() => buildApiRequest(list, ['extra'], {})).toThrow(/takes no positional/);
  });

  it('encodes query params and rejects unknown ones', () => {
    const { path } = buildApiRequest(list, [], { param: ['archived=true', 'limit=5'] });
    expect(path).toBe('/agents?archived=true&limit=5');
    expect(() => buildApiRequest(list, [], { param: ['bogus=1'] })).toThrow(
      /Unknown query param: bogus/,
    );
  });

  it('merges --input with --field overrides, dotted paths included', () => {
    const { init } = buildApiRequest(
      sendMessage,
      ['agt_1'],
      { input: 'body.json', field: ['meta.retries=2', 'flag=true'] },
      () => '{"message":"from file"}',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      message: 'from file',
      meta: { retries: 2 },
      flag: true,
    });
  });

  it('rejects a body on body-less operations', () => {
    expect(() => buildApiRequest(list, [], { field: ['x=1'] })).toThrow(/does not take a request/);
  });

  it('URL-encodes path params', () => {
    const { path } = buildApiRequest(resolveApiOp('getAgent'), ['a b/c'], {});
    expect(path).toBe('/agents/a%20b%2Fc');
  });
});

describe('generated api-ops module', () => {
  // The spec lives at the repository root and is not part of the published
  // `sdk/` tree, so this drift check can only run where the generator's input
  // exists. That is also the only place it matters: the generated file can
  // only go stale when someone regenerates the API.
  const specPath = resolve(__dirname, '../../../..', 'openapi', 'openapi.public.json');

  it.skipIf(!existsSync(specPath))(
    'is in sync with the committed public spec (regenerate with generate:api-ops)',
    () => {
      const spec = JSON.parse(readFileSync(specPath, 'utf8')) as Parameters<typeof buildApiOps>[0];
      const committed = readFileSync(resolve(__dirname, '../generated/api-ops.ts'), 'utf8');
      expect(committed).toBe(renderModule(buildApiOps(spec)));
    },
  );

  it('covers every operation in the spec exactly once', () => {
    const ids = API_OPS.map((op) => op.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(140);
  });
});
