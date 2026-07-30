import { describe, expect, it } from 'vitest';
import type { CatalogAgent, CatalogProvider, ProviderKey } from '../web/src/lib/api.ts';
import {
  defaultKeyScope,
  groupProviderKeys,
  keepSelectableKey,
  resolveProvider,
} from '../web/src/lib/provider-keys.ts';
import {
  makeAnthropicProvider,
  makeCatalogAgent,
  makeOpenAiProvider,
  makeProviderKey,
} from './fixtures.ts';

const agent = makeCatalogAgent();
const anthropic = makeAnthropicProvider();
const openai = makeOpenAiProvider();

describe('resolveProvider', () => {
  it('resolves an explicitly picked model to its provider', () => {
    expect(resolveProvider(agent, 'gpt-5.2-codex')?.id).toBe('openai');
  });

  it('falls back to the declared default provider for "agent default"', () => {
    expect(resolveProvider(agent, '')?.id).toBe('anthropic');
  });

  it('falls back to whoever owns the default model when no default provider', () => {
    const noDefault: CatalogAgent = { ...agent, defaultProvider: null };
    expect(resolveProvider(noDefault, '')?.id).toBe('anthropic');
  });

  it('falls back to a sole provider when nothing else names one', () => {
    const sole: CatalogAgent = {
      ...agent,
      defaultProvider: null,
      defaultModel: null,
      providers: [openai],
    };
    expect(resolveProvider(sole, '')?.id).toBe('openai');
  });

  it('stays null when the choice is ambiguous or absent', () => {
    const ambiguous: CatalogAgent = { ...agent, defaultProvider: null, defaultModel: null };
    expect(resolveProvider(ambiguous, '')).toBeNull();
    expect(resolveProvider(agent, 'model-from-nowhere')).toBeNull();
    expect(resolveProvider(null, '')).toBeNull();
    expect(resolveProvider({ ...agent, providers: [] }, '')).toBeNull();
  });
});

describe('groupProviderKeys', () => {
  const keys: ProviderKey[] = [
    makeProviderKey({ id: 'mps_org', scope: 'org', name: 'Org key' }),
    makeProviderKey({ id: 'mps_user_b', scope: 'user', name: 'Backup' }),
    makeProviderKey({ id: 'mps_user_a', scope: 'user', name: 'Alpha' }),
    makeProviderKey({ id: 'mps_sub', scope: 'user', name: 'Claude Max', type: 'subscription' }),
    makeProviderKey({ id: 'mps_other', scope: 'user', provider: 'openai', name: 'OpenAI' }),
  ];

  it('keeps only this provider’s keys, grouped user -> team -> org', () => {
    const groups = groupProviderKeys(keys, anthropic).map((g) => [
      g.scope,
      g.rows.map((r) => r.key.name),
    ]);
    expect(groups).toEqual([
      ['user', ['Alpha', 'Backup', 'Claude Max']],
      ['org', ['Org key']],
    ]);
  });

  it('matches on keyProvider, not the provider id', () => {
    const freeTier: CatalogProvider = {
      ...anthropic,
      id: 'opencode-free',
      keyProvider: 'openai',
    };
    expect(groupProviderKeys(keys, freeTier).flatMap((g) => g.rows.map((r) => r.key.id))).toEqual([
      'mps_other',
    ]);
  });

  it('lists keys of an unaccepted type but marks them unsupported', () => {
    const apiKeyOnly: CatalogProvider = { ...anthropic, keyTypes: ['apiKey'] };
    const rows = groupProviderKeys(keys, apiKeyOnly).flatMap((g) => g.rows);
    expect(rows.find((r) => r.key.id === 'mps_sub')?.supported).toBe(false);
    expect(rows.find((r) => r.key.id === 'mps_user_a')?.supported).toBe(true);
  });

  it('returns no groups when the provider has no keys at all', () => {
    expect(groupProviderKeys([], anthropic)).toEqual([]);
  });
});

describe('picking a key', () => {
  const keys: ProviderKey[] = [
    makeProviderKey({ id: 'mps_user_a', scope: 'user', name: 'Alpha' }),
    makeProviderKey({ id: 'mps_sub', scope: 'user', name: 'Claude Max', type: 'subscription' }),
    makeProviderKey({ id: 'mps_org', scope: 'org', name: 'Org key' }),
    makeProviderKey({ id: 'mps_openai', scope: 'user', provider: 'openai', name: 'OpenAI' }),
  ];
  const anthropicGroups = groupProviderKeys(keys, anthropic);

  it('names the tier an unpinned launch resolves in', () => {
    expect(defaultKeyScope(anthropicGroups)).toBe('user');
  });

  it('skips a tier whose only keys the provider cannot use', () => {
    // Subscription-only at the user tier on an API-key-only provider: the
    // org tier is the first that would actually authenticate.
    const apiKeyOnly: CatalogProvider = { ...anthropic, keyTypes: ['apiKey'] };
    const onlySubUser = groupProviderKeys(
      keys.filter((k) => k.id !== 'mps_user_a'),
      apiKeyOnly,
    );
    expect(defaultKeyScope(onlySubUser)).toBe('org');
  });

  it('names no tier when none of the keys work with the provider', () => {
    const subsOnly = groupProviderKeys([keys[1]!], { ...anthropic, keyTypes: ['apiKey'] });
    expect(defaultKeyScope(subsOnly)).toBeNull();
  });

  it('drops a pinned key the new provider cannot serve', () => {
    // The exact bug this guards: pick an Anthropic key, then switch the
    // model to an OpenAI one. Launching still pinned to the Anthropic key
    // would run under an account that cannot serve the model.
    const openaiGroups = groupProviderKeys(keys, openai);
    expect(keepSelectableKey('mps_user_a', openaiGroups)).toBeNull();
    expect(keepSelectableKey('mps_openai', openaiGroups)).toBe('mps_openai');
  });

  it('drops a pinned key that became unsupported, and keeps automatic as-is', () => {
    const apiKeyOnly = groupProviderKeys(keys, { ...anthropic, keyTypes: ['apiKey'] });
    expect(keepSelectableKey('mps_sub', apiKeyOnly)).toBeNull();
    expect(keepSelectableKey(null, anthropicGroups)).toBeNull();
    expect(keepSelectableKey('mps_gone', anthropicGroups)).toBeNull();
  });
});
