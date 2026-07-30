/** Shared builders for tests and stories. */
import type {
  CatalogAgent,
  CatalogProvider,
  Game,
  ProviderKey,
  Suggestion,
} from '../web/src/lib/api.ts';

export function makeGame(overrides: Partial<Game> = {}): Game {
  return {
    id: 'game_fixture01',
    ownerId: 'user_1',
    ownerName: 'Alex',
    viewers: 0,
    plays: 0,
    title: 'Neon Snake',
    prompt: 'A neon snake game with power-ups and a starfield background',
    agentId: 'agent_1',
    agentType: 'claude-code',
    model: null,
    status: 'live',
    agentStatus: 'running',
    isPublic: true,
    autoApprove: true,
    daemonUrl: 'https://example.test/play',
    hasPreview: false,
    hasIcon: false,
    hasPreviewAnim: false,
    shippedCount: 0,
    artVersion: 0,
    currentTask: null,
    currentTaskKind: null,
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

/** An Anthropic provider that takes either an API key or a subscription. */
export function makeAnthropicProvider(overrides: Partial<CatalogProvider> = {}): CatalogProvider {
  return {
    id: 'anthropic',
    displayName: 'Anthropic',
    available: true,
    keyProvider: 'anthropic',
    keyTypes: ['apiKey', 'subscription'],
    models: [
      { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5' },
      { id: 'claude-opus-5', displayName: 'Claude Opus 5' },
    ],
    ...overrides,
  };
}

/** An OpenAI provider that takes API keys only, and has no usable key. */
export function makeOpenAiProvider(overrides: Partial<CatalogProvider> = {}): CatalogProvider {
  return {
    id: 'openai',
    displayName: 'OpenAI',
    available: false,
    keyProvider: 'openai',
    keyTypes: ['apiKey'],
    models: [{ id: 'gpt-5.2-codex', displayName: 'GPT-5.2 Codex' }],
    ...overrides,
  };
}

/** A multi-model agent shaped like the mock deployment's `claude-code`. */
export function makeCatalogAgent(overrides: Partial<CatalogAgent> = {}): CatalogAgent {
  return {
    agentType: 'claude-code',
    displayName: 'Claude Code',
    multiModel: true,
    defaultModel: 'claude-sonnet-5',
    defaultProvider: 'anthropic',
    providers: [makeAnthropicProvider(), makeOpenAiProvider()],
    ...overrides,
  };
}

export function makeProviderKey(overrides: Partial<ProviderKey> = {}): ProviderKey {
  return {
    id: 'mps_fixture00000000001',
    name: 'Personal key',
    provider: 'anthropic',
    scope: 'user',
    type: 'apiKey',
    ...overrides,
  };
}

export function makeSuggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 'sug_fixture01',
    gameId: 'game_fixture01',
    authorId: 'user_fan',
    authorName: 'Fan',
    body: 'add powerups',
    status: 'approved',
    category: 'improvement',
    hearts: 0,
    ownerNote: null,
    createdAt: '2026-07-20T10:01:00.000Z',
    approvedAt: null,
    startedAt: null,
    completedAt: null,
    editedAt: null,
    ...overrides,
  };
}
