import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadRegistry } from '../cli.js';

const REGISTRY_DIR = fileURLToPath(new URL('../../registry/', import.meta.url));
const PACKAGE_JSON = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { peerDependencies: Record<string, string> };

describe('registry manifest', () => {
  const registry = loadRegistry();
  const names = new Set(registry.items.map((item) => item.name));

  it('has unique item names', () => {
    expect(names.size).toBe(registry.items.length);
  });

  it('lists only files that exist on disk', () => {
    for (const item of registry.items) {
      for (const file of item.files) {
        expect(existsSync(path.join(REGISTRY_DIR, file)), `${item.name}: ${file}`).toBe(true);
      }
    }
  });

  it('only references registryDependencies that exist', () => {
    for (const item of registry.items) {
      for (const dep of item.registryDependencies) {
        expect(names.has(dep), `${item.name} -> ${dep}`).toBe(true);
      }
    }
  });

  it('declares every npm dependency as a package peerDependency', () => {
    const peers = new Set(Object.keys(PACKAGE_JSON.peerDependencies));
    for (const item of registry.items) {
      for (const dep of item.dependencies) {
        expect(peers.has(dep), `${item.name} -> ${dep}`).toBe(true);
      }
    }
  });

  it('places files under the directory matching the item type', () => {
    const dirFor = { component: 'components', hook: 'hooks', lib: 'lib' } as const;
    for (const item of registry.items) {
      for (const file of item.files) {
        expect(file.startsWith(`${dirFor[item.type]}/`), `${item.name}: ${file}`).toBe(true);
      }
    }
  });

  it('declares the npm packages each template actually imports', () => {
    for (const item of registry.items) {
      for (const file of item.files) {
        const content = readFileSync(path.join(REGISTRY_DIR, file), 'utf8');
        for (const match of content.matchAll(/from\s+'([^'.][^']*)'/g)) {
          const specifier = match[1]!;
          const pkg = specifier.startsWith('@')
            ? specifier.split('/').slice(0, 2).join('/')
            : specifier.split('/')[0]!;
          expect(item.dependencies, `${item.name}: imports ${pkg}`).toContain(pkg);
        }
      }
    }
  });

  it('has a "chat" meta item that transitively covers every other item', () => {
    const byName = new Map(registry.items.map((item) => [item.name, item]));
    const reached = new Set<string>();
    const visit = (name: string): void => {
      if (reached.has(name)) return;
      reached.add(name);
      for (const dep of byName.get(name)!.registryDependencies) visit(dep);
    };
    visit('chat');
    expect([...reached].sort()).toEqual([...byName.keys()].sort());
  });
});
