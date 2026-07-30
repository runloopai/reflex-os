/**
 * Which provider keys apply to a given agent + model choice.
 *
 * Reflex's launch dialog resolves an agent/model pair down to one model
 * provider and then lists the keys that can authenticate it, grouped by the
 * tier they live in (user -> team -> org, the precedence the server resolves
 * with). The arcade's launch form shows the same view; this module is the
 * pure part of it, so the rendering component stays presentational.
 */
import type {
  CatalogAgent,
  CatalogProvider,
  ProviderKey,
  ProviderKeyScope,
  ProviderKeyType,
} from './api.ts';

/** Most specific first, matching the precedence the server resolves with. */
export const KEY_SCOPE_ORDER: readonly ProviderKeyScope[] = ['user', 'team', 'org'];

export const KEY_SCOPE_LABEL: Record<ProviderKeyScope, string> = {
  user: 'Your keys',
  team: 'Team keys',
  org: 'Organization keys',
};

/** Compact per-row badge so an API key reads apart from a subscription. */
export const KEY_TYPE_BADGE: Record<ProviderKeyType, string> = {
  apiKey: 'Key',
  subscription: 'Sub',
};

export const KEY_TYPE_LABEL: Record<ProviderKeyType, string> = {
  apiKey: 'API key',
  subscription: 'Subscription',
};

/**
 * The provider that would actually serve `modelId` for `agent`.
 *
 * An explicit model names its provider outright. "Agent default" (an empty
 * `modelId`) falls back the way the catalog's own defaults do: the declared
 * default provider, then whoever owns the default model, then a sole
 * provider. Returns `null` when the choice is genuinely ambiguous — the
 * caller renders a "pick a model" hint rather than guessing at a key list.
 */
export function resolveProvider(
  agent: CatalogAgent | null,
  modelId: string,
): CatalogProvider | null {
  if (!agent || agent.providers.length === 0) return null;
  if (modelId) {
    return agent.providers.find((p) => p.models.some((m) => m.id === modelId)) ?? null;
  }
  const declared = agent.defaultProvider
    ? agent.providers.find((p) => p.id === agent.defaultProvider)
    : undefined;
  if (declared) return declared;
  const owningDefaultModel = agent.defaultModel
    ? agent.providers.find((p) => p.models.some((m) => m.id === agent.defaultModel))
    : undefined;
  if (owningDefaultModel) return owningDefaultModel;
  return agent.providers.length === 1 ? (agent.providers[0] ?? null) : null;
}

/** A key row plus whether this provider actually accepts that key's type. */
export interface ProviderKeyRow {
  key: ProviderKey;
  /** `false` for e.g. a subscription key on an API-key-only provider. */
  supported: boolean;
}

export interface ProviderKeyGroup {
  scope: ProviderKeyScope;
  rows: ProviderKeyRow[];
}

/**
 * The keys that authenticate `provider`, grouped by tier in resolution order
 * and sorted by name within a tier. Keys of a type the provider does not
 * accept are still listed — Reflex shows them greyed rather than hiding them,
 * so an operator can tell "no key" apart from "wrong kind of key".
 */
export function groupProviderKeys(
  keys: readonly ProviderKey[],
  provider: CatalogProvider,
): ProviderKeyGroup[] {
  const accepted = new Set(provider.keyTypes);
  const rows = keys
    .filter((key) => key.provider === provider.keyProvider)
    .map((key) => ({ key, supported: accepted.has(key.type) }))
    .sort((a, b) => a.key.name.localeCompare(b.key.name));
  return KEY_SCOPE_ORDER.map((scope) => ({
    scope,
    rows: rows.filter((row) => row.key.scope === scope),
  })).filter((group) => group.rows.length > 0);
}

/**
 * The tier an unpinned launch resolves in: the most specific one holding a
 * usable key. Deliberately a tier and not a key — the arcade knows Reflex's
 * tier precedence, but not how the server breaks a tie *within* a tier, and
 * naming one key of three would be a confident guess in the one place a
 * player is deciding whose budget to spend.
 */
export function defaultKeyScope(groups: ProviderKeyGroup[]): ProviderKeyScope | null {
  return groups.find((group) => group.rows.some((row) => row.supported))?.scope ?? null;
}

/**
 * Keep a chosen key honest across agent/model changes: a pinned key that
 * the newly-resolved provider cannot use (or that no longer exists) has to
 * fall back to automatic, or the launch would be pinned to a key for a
 * provider that is not serving it.
 */
export function keepSelectableKey(
  selected: string | null,
  groups: ProviderKeyGroup[],
): string | null {
  if (!selected) return null;
  const stillUsable = groups.some((group) =>
    group.rows.some((row) => row.key.id === selected && row.supported),
  );
  return stillUsable ? selected : null;
}
