import { afterEach, describe, expect, it } from 'vitest';
import { parseCli } from '../cli.js';
import { parseRepoFlag, selectionsFromFlags } from '../commands/actions.js';
import { confirmOrAbort } from '../output/confirm.js';

describe('action command parsing', () => {
  it('records noun:verb names, including the nested queue group', () => {
    expect(parseCli(['agents', 'interrupt', 'agt_1']).command).toBe('agents:interrupt');
    expect(parseCli(['agents', 'kill', 'agt_1', '--yes']).command).toBe('agents:kill');
    expect(parseCli(['agents', 'queue', 'add', 'agt_1', 'hi']).command).toBe('agents:queue:add');
    expect(parseCli(['agents', 'launch', '-p', 'do it']).command).toBe('agents:launch');
  });

  it('keeps global flags working on action commands', () => {
    expect(parseCli(['agents', 'stop', 'agt_1', '--org', 'acme']).flags.org).toBe('acme');
  });
});

describe('parseRepoFlag', () => {
  it('splits owner/repo and optional branch', () => {
    expect(parseRepoFlag('acme/app')).toEqual({ repoSlug: 'acme/app' });
    expect(parseRepoFlag('acme/app#main')).toEqual({ repoSlug: 'acme/app', repoBranch: 'main' });
  });

  it('rejects malformed slugs', () => {
    expect(() => parseRepoFlag('acme')).toThrow(/owner\/repo/);
    expect(() => parseRepoFlag('a/b/c')).toThrow(/owner\/repo/);
  });
});

describe('selectionsFromFlags', () => {
  it('maps flags to launch selections without touching the network when --type is set', async () => {
    const selections = await selectionsFromFlags(
      {
        prompt: 'fix the flaky test',
        type: 'claude',
        repo: 'acme/app#main',
        model: 'opus',
        env: ['A=1', 'B=two'],
        size: 'LARGE',
        blueprint: 'app-base',
      },
      [],
    );
    expect(selections).toEqual({
      agentType: 'claude',
      prompt: 'fix the flaky test',
      model: 'opus',
      repoSlug: 'acme/app',
      repoBranch: 'main',
      blueprintName: 'app-base',
      resourceSize: 'LARGE',
      envVars: [
        { key: 'A', value: '1' },
        { key: 'B', value: 'two' },
      ],
    });
  });

  it('requires a prompt and well-formed env pairs', async () => {
    await expect(selectionsFromFlags({}, [])).rejects.toThrow(/Provide a prompt/);
    await expect(
      selectionsFromFlags({ prompt: 'x', type: 't', env: ['NOEQUALS'] }, []),
    ).rejects.toThrow(/KEY=VALUE/);
  });
});

describe('confirmOrAbort', () => {
  const originalIsTTY = process.stdin.isTTY;
  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('passes straight through with --yes', async () => {
    await expect(confirmOrAbort('Sure?', true)).resolves.toBe(true);
  });

  it('refuses non-interactively without --yes', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    await expect(confirmOrAbort('Sure?', false)).rejects.toThrow(/--yes/);
  });
});
