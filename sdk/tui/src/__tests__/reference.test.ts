import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProgram, parseCli } from '../cli.js';
import { renderCompletionScript, parseShellArg } from '../reference/completion.js';
import { renderCliDocs } from '../reference/markdown.js';
import { commonOptions, walkCommand } from '../reference/walker.js';

const root = walkCommand(createProgram());

describe('walker', () => {
  it('captures the full tree with sorted subcommands', () => {
    const names = root.subcommands.map((c) => c.name);
    expect(names).toEqual([...names].sort());
    for (const expected of [
      'agents',
      'api',
      'chat',
      'completion',
      'connect',
      'doctor',
      'login',
      'open',
      'orgs',
      'run',
      'service',
      'teams',
      'watch',
      'whoami',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('reaches nested groups and their options', () => {
    const agents = root.subcommands.find((c) => c.name === 'agents');
    const queue = agents?.subcommands.find((c) => c.name === 'queue');
    expect(queue?.subcommands.map((c) => c.name)).toEqual(['add', 'edit', 'reorder', 'rm']);
    const list = agents?.subcommands.find((c) => c.name === 'list');
    expect(list?.options.some((o) => o.long === '--json')).toBe(true);
  });

  it('computes the shared option set instead of hardcoding it', () => {
    const flags = commonOptions(root).map((o) => o.long);
    expect(flags).toEqual(expect.arrayContaining(['--url', '--key', '--org']));
  });
});

describe('docs rendering', () => {
  const docs = renderCliDocs(root);

  it('documents every top-level command as a section', () => {
    for (const sub of root.subcommands) {
      if (sub.name === 'help') continue;
      expect(docs).toContain(`## ${sub.name}`);
    }
  });

  it('is deterministic', () => {
    expect(renderCliDocs(walkCommand(createProgram()))).toBe(docs);
  });

  it('matches the committed docs/cli.md (run docs:generate on drift)', () => {
    const committed = readFileSync(resolve(__dirname, '../../docs/cli.md'), 'utf8');
    expect(committed).toBe(docs);
  });
});

describe('completion', () => {
  it('validates the shell argument', () => {
    expect(parseShellArg('zsh')).toBe('zsh');
    expect(() => parseShellArg('powershell')).toThrow(/bash, zsh, or fish/);
  });

  it('covers commands and long options in every shell', () => {
    for (const shell of ['bash', 'zsh', 'fish'] as const) {
      const script = renderCompletionScript(shell, root);
      expect(script).toContain('agents');
      expect(script).toContain('doctor');
      expect(script).toContain('completion');
      // Fish declares long options as `-l json`; bash/zsh list them literally.
      expect(script).toContain(shell === 'fish' ? '-l json' : '--json');
    }
    expect(renderCompletionScript('bash', root)).toContain('complete -F');
    expect(renderCompletionScript('fish', root)).toContain('complete -c reflex-cli');
  });
});

describe('parse records', () => {
  it('records the new commands', () => {
    expect(parseCli(['completion', 'bash']).command).toBe('completion');
    expect(parseCli(['doctor']).command).toBe('doctor');
  });
});
