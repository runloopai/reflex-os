/**
 * Guards the two invariants of this package's build model:
 *
 * 1. `src/` stays byte-identical (banner aside) to the chat-kit registry —
 *    the single source of truth for the chat components.
 * 2. `src/index.ts` re-exports every registry module and the public symbols
 *    actually resolve, so a registry addition cannot silently ship without
 *    a library entry point.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as reflexUi from '../index';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registryDir = path.resolve(packageRoot, '../chat-kit/registry');

interface RegistryManifest {
  items: { files: string[] }[];
}

const manifest = JSON.parse(
  readFileSync(path.join(registryDir, 'registry.json'), 'utf8'),
) as RegistryManifest;
const registryFiles = manifest.items.flatMap((item) => item.files);

describe('registry sync', () => {
  it('has at least the known template files', () => {
    expect(registryFiles.length).toBeGreaterThanOrEqual(8);
  });

  it.each(registryFiles)('src/%s matches the chat-kit registry template', (file) => {
    const source = readFileSync(path.join(registryDir, file), 'utf8');
    const banner = `// AUTO-SYNCED from sdk/chat-kit/registry/${file} — edit there, then run \`pnpm --filter @runloop/reflex-ui sync\`.\n`;
    const synced = readFileSync(path.join(packageRoot, 'src', file), 'utf8');
    expect(synced).toBe(banner + source);
  });

  it('re-exports every registry module from src/index.ts', () => {
    const index = readFileSync(path.join(packageRoot, 'src/index.ts'), 'utf8');
    for (const file of registryFiles) {
      const specifier = `./${file.replace(/\.(tsx|ts)$/, '')}`;
      expect(index, `index.ts is missing an export from '${specifier}'`).toContain(
        `'${specifier}'`,
      );
    }
  });
});

describe('public API', () => {
  it('exposes the provider, hooks, components, and event utilities', () => {
    expect(reflexUi.ReflexProvider).toBeTypeOf('function');
    expect(reflexUi.useReflex).toBeTypeOf('function');
    expect(reflexUi.useAgentStream).toBeTypeOf('function');
    expect(reflexUi.useSendMessage).toBeTypeOf('function');
    expect(reflexUi.agentStreamKey('agent_1')).toEqual(['reflex-chat', 'stream', 'agent_1']);
    expect(reflexUi.ChatPane).toBeTypeOf('function');
    expect(reflexUi.MessageList).toBeTypeOf('function');
    expect(reflexUi.MessageBubble).toBeTypeOf('function');
    expect(reflexUi.ChatComposer).toBeTypeOf('function');
    expect(reflexUi.buildChatMessages([])).toEqual([]);
    expect(reflexUi.deduplicateEvents([])).toEqual([]);
    expect(reflexUi.parseEventPayload('{"a":1}')).toEqual({ a: 1 });
  });
});
