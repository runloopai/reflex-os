import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../cli.js';

let tmp: string;
let lines: string[];
const log = (line: string) => lines.push(line);

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'reflex-chat-kit-'));
  lines = [];
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('init', () => {
  it('writes reflex-kit.json with defaults', () => {
    expect(runCli(['init'], tmp, log)).toBe(0);
    const config = JSON.parse(readFileSync(path.join(tmp, 'reflex-kit.json'), 'utf8'));
    expect(config).toEqual({
      componentsDir: 'src/components/reflex',
      hooksDir: 'src/hooks/reflex',
      libDir: 'src/lib/reflex',
    });
  });

  it('honors --components-dir style overrides', () => {
    expect(
      runCli(['init', '--components-dir', 'app/ui/reflex', '--lib-dir', 'app/lib'], tmp, log),
    ).toBe(0);
    const config = JSON.parse(readFileSync(path.join(tmp, 'reflex-kit.json'), 'utf8'));
    expect(config.componentsDir).toBe('app/ui/reflex');
    expect(config.libDir).toBe('app/lib');
    expect(config.hooksDir).toBe('src/hooks/reflex');
  });

  it('preserves an existing config unless --overwrite is passed', () => {
    expect(runCli(['init'], tmp, log)).toBe(0);
    const configPath = path.join(tmp, 'reflex-kit.json');
    const original = readFileSync(configPath, 'utf8');

    expect(runCli(['init', '--components-dir', 'app/reflex'], tmp, log)).toBe(1);
    expect(readFileSync(configPath, 'utf8')).toBe(original);
    expect(lines.join('\n')).toContain('Pass --overwrite');

    expect(runCli(['init', '--overwrite', '--components-dir', 'app/reflex'], tmp, log)).toBe(0);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).componentsDir).toBe('app/reflex');
  });
});

describe('list', () => {
  it('prints every registry item with its description', () => {
    expect(runCli(['list'], tmp, log)).toBe(0);
    const output = lines.join('\n');
    for (const name of ['chat', 'chat-pane', 'use-agent-stream', 'reflex-provider']) {
      expect(output).toContain(name);
    }
    expect(output).toContain('[component]');
    expect(output).toContain('[hook]');
    expect(output).toContain('[lib]');
  });
});

describe('add', () => {
  it('fails helpfully without init', () => {
    expect(runCli(['add', 'chat'], tmp, log)).toBe(1);
    expect(lines.join('\n')).toContain('reflex-chat-kit init');
  });

  it('fails helpfully for unknown items', () => {
    runCli(['init'], tmp, log);
    expect(runCli(['add', 'nope'], tmp, log)).toBe(1);
    expect(lines.join('\n')).toContain('Unknown registry item "nope"');
  });

  it('add chat installs every file into the configured dirs', () => {
    runCli(['init'], tmp, log);
    expect(runCli(['add', 'chat'], tmp, log)).toBe(0);

    for (const file of [
      'src/lib/reflex/reflex-provider.tsx',
      'src/lib/reflex/event-utils.ts',
      'src/hooks/reflex/use-agent-stream.ts',
      'src/hooks/reflex/use-send-message.ts',
      'src/components/reflex/chat-pane.tsx',
      'src/components/reflex/message-list.tsx',
      'src/components/reflex/message-bubble.tsx',
      'src/components/reflex/chat-composer.tsx',
    ]) {
      expect(existsSync(path.join(tmp, file)), file).toBe(true);
    }

    expect(lines.join('\n')).toContain('@runloop/reflex-client');
  });

  it('rewrites cross-item imports to the target layout', () => {
    runCli(['init'], tmp, log);
    runCli(['add', 'chat'], tmp, log);

    const hook = readFileSync(path.join(tmp, 'src/hooks/reflex/use-agent-stream.ts'), 'utf8');
    expect(hook).toContain("from '../../lib/reflex/reflex-provider'");
    expect(hook).toContain("from '../../lib/reflex/event-utils'");
    expect(hook).not.toContain("from '../lib/");

    const pane = readFileSync(path.join(tmp, 'src/components/reflex/chat-pane.tsx'), 'utf8');
    expect(pane).toContain("from '../../hooks/reflex/use-agent-stream'");
    expect(pane).toContain("from './message-list'");
    // npm imports are untouched.
    expect(pane).toContain("from '@runloop/reflex-client'");
  });

  it('respects custom directories from reflex-kit.json', () => {
    runCli(
      [
        'init',
        '--components-dir',
        'app/ui',
        '--hooks-dir',
        'app/hooks',
        '--lib-dir',
        'app/lib/reflex',
      ],
      tmp,
      log,
    );
    runCli(['add', 'use-send-message'], tmp, log);

    // Registry dependencies come along.
    expect(existsSync(path.join(tmp, 'app/hooks/use-send-message.ts'))).toBe(true);
    expect(existsSync(path.join(tmp, 'app/hooks/use-agent-stream.ts'))).toBe(true);
    expect(existsSync(path.join(tmp, 'app/lib/reflex/reflex-provider.tsx'))).toBe(true);

    const hook = readFileSync(path.join(tmp, 'app/hooks/use-send-message.ts'), 'utf8');
    expect(hook).toContain("from './use-agent-stream'");
    expect(hook).toContain("from '../lib/reflex/event-utils'");
  });

  it('produces output whose relative imports all resolve on disk', () => {
    // Templates are type-checked by the package tsconfig (registry/ is
    // included); this guards the rewrite step: after installation every
    // relative specifier must point at an installed file.
    runCli(['init'], tmp, log);
    runCli(['add', 'chat'], tmp, log);

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
      );

    for (const file of walk(path.join(tmp, 'src'))) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
        const target = path.resolve(path.dirname(file), match[1]!);
        const resolves = existsSync(`${target}.ts`) || existsSync(`${target}.tsx`);
        expect(resolves, `${file}: unresolved import ${match[1]}`).toBe(true);
      }
    }
  });

  it('installs a single component with only its dependencies', () => {
    runCli(['init'], tmp, log);
    runCli(['add', 'chat-composer'], tmp, log);
    expect(existsSync(path.join(tmp, 'src/components/reflex/chat-composer.tsx'))).toBe(true);
    expect(existsSync(path.join(tmp, 'src/components/reflex/chat-pane.tsx'))).toBe(false);
    expect(existsSync(path.join(tmp, 'src/lib/reflex'))).toBe(false);
  });

  it('preserves customized files unless --overwrite is passed', () => {
    runCli(['init'], tmp, log);
    expect(runCli(['add', 'chat-composer'], tmp, log)).toBe(0);
    const composerPath = path.join(tmp, 'src/components/reflex/chat-composer.tsx');
    const customized = '// My customized chat composer\n';
    writeFileSync(composerPath, customized);

    // `chat-composer` is late in the full install plan. Files reserved before
    // the collision are rolled back, so the failed operation stays atomic.
    expect(runCli(['add', 'chat'], tmp, log)).toBe(1);
    expect(readFileSync(composerPath, 'utf8')).toBe(customized);
    expect(existsSync(path.join(tmp, 'src/lib/reflex/reflex-provider.tsx'))).toBe(false);
    expect(lines.join('\n')).toContain('Refusing to overwrite an existing file');

    // Boolean flags work before positional items too.
    expect(runCli(['add', '--overwrite', 'chat-composer'], tmp, log)).toBe(0);
    expect(readFileSync(composerPath, 'utf8')).not.toBe(customized);
  });
});

describe('help', () => {
  it('prints usage on --help', () => {
    expect(runCli(['--help'], tmp, log)).toBe(0);
    expect(lines.join('\n')).toContain('Usage:');
  });

  it('prints usage and fails on no command', () => {
    expect(runCli([], tmp, log)).toBe(1);
  });

  it('prints usage and fails on unknown command', () => {
    expect(runCli(['frobnicate'], tmp, log)).toBe(1);
    expect(lines.join('\n')).toContain('Unknown command');
  });
});
