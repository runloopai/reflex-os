import { describe, expect, it } from 'vitest';
import type { AgentModelSupportResponse, Blueprint } from '@runloop/reflex-client';
import {
  agentTypeOptions,
  autoBlueprintName,
  availableBlueprints,
  buildLaunchPayload,
  modelOptions,
  parseEnvVars,
} from '../launch/options.js';

const support: AgentModelSupportResponse = {
  agents: {
    opencode: {
      status: 'available',
      agentType: 'opencode',
      displayName: 'OpenCode',
      providers: [],
      endpoints: [],
      providerEndpoints: [],
      defaultEndpoint: 'ep1',
      defaultModel: 'gpt-5',
      discovery: { method: 'static' },
      discoveredModels: [
        { id: 'grok-code', displayName: 'Grok Code', providerId: 'xai' },
        { id: 'gpt-5', displayName: 'GPT-5', providerId: 'openai' },
      ],
    },
    'claude-code': {
      status: 'unavailable',
      agentType: 'claude-code',
      reason: 'matrix_unavailable',
      message: 'single-model agent',
    },
  },
  defaultAgentType: 'claude-code',
  launchableAgents: [
    { agentType: 'claude-code', displayName: 'Claude Code', multiModel: false, enabled: true },
    { agentType: 'opencode', displayName: 'OpenCode', multiModel: true, enabled: true },
    { agentType: 'codex', displayName: 'Codex', multiModel: true, enabled: false },
  ],
};

function blueprint(partial: Partial<Blueprint> & { name: string }): Blueprint {
  return {
    id: `bp_${partial.name}`,
    status: 'build_complete',
    createTimeMs: 1,
    ...partial,
  } as Blueprint;
}

describe('agentTypeOptions', () => {
  it('lists enabled agents with the default first', () => {
    const options = agentTypeOptions(support);
    expect(options.map((o) => o.value)).toEqual(['claude-code', 'opencode']);
    expect(options[0]).toMatchObject({ label: 'Claude Code', hint: 'default' });
  });

  it('returns nothing without a catalog (caller falls back to the configured default)', () => {
    expect(agentTypeOptions(null)).toEqual([]);
  });
});

describe('modelOptions', () => {
  it('puts the server default option first, then the catalog default model', () => {
    const options = modelOptions(support, 'opencode');
    expect(options[0]).toMatchObject({ value: null, label: 'default' });
    expect(options[1]).toMatchObject({ value: 'gpt-5', hint: 'openai · default' });
    expect(options[2]).toMatchObject({ value: 'grok-code', hint: 'xai' });
  });

  it('offers only the server default for non-matrix agents', () => {
    expect(modelOptions(support, 'claude-code')).toHaveLength(1);
    expect(modelOptions(support, 'claude-code')[0].value).toBeNull();
  });
});

describe('blueprint selection', () => {
  const blueprints: Blueprint[] = [
    blueprint({ name: 'org_base', metadata: { type: 'base' } }),
    blueprint({ name: 'app', metadata: { repo: 'acme/app' }, createTimeMs: 5 }),
    blueprint({ name: 'app', metadata: { repo: 'acme/app' }, createTimeMs: 9 }),
    blueprint({ name: 'other', metadata: { repo: 'acme/other' } }),
    blueprint({ name: 'building', status: 'building' }),
  ];

  it('dedupes by name (latest wins) and ranks the scoped repo first without hiding the rest', () => {
    const available = availableBlueprints(blueprints, 'acme/app');
    // A blueprint built for another repo still launches, so it stays offered
    // below the repo's own. Matches the web picker (useAvailableBlueprints).
    expect(available.map((bp) => bp.name)).toEqual(['app', 'org_base', 'other']);
    expect(available.find((bp) => bp.name === 'app')?.createTimeMs).toBe(9);
  });

  it('offers every blueprint when the scoped repo has none of its own', () => {
    expect(availableBlueprints(blueprints, 'acme/unbuilt').map((bp) => bp.name)).toEqual([
      'app',
      'org_base',
      'other',
    ]);
  });

  it('auto-picks the repo blueprint, falling back to a base blueprint', () => {
    expect(autoBlueprintName(availableBlueprints(blueprints, 'acme/app'), 'acme/app')).toBe('app');
    expect(autoBlueprintName(availableBlueprints(blueprints), undefined)).toBe('org_base');
  });

  it('ranks and auto-picks a blueprint whose stored repo is a URL', () => {
    // `metadata.repo` keeps whatever the create form sent, so a pasted link
    // stays a URL while the caller passes a bare slug. Both sides normalize.
    const urlScoped = blueprint({
      name: 'url_app',
      metadata: { repo: 'https://github.com/acme/url-app' },
      createTimeMs: 12,
    });
    const withUrl = [...blueprints, urlScoped];

    expect(availableBlueprints(withUrl, 'acme/url-app')[0]?.name).toBe('url_app');
    expect(autoBlueprintName(availableBlueprints(withUrl, 'acme/url-app'), 'acme/url-app')).toBe(
      'url_app',
    );
  });
});

describe('parseEnvVars', () => {
  it('parses space-separated KEY=VALUE pairs with quoted values', () => {
    const { envVars, errors } = parseEnvVars('DEBUG=1 GREETING="hello world"');
    expect(errors).toEqual([]);
    expect(envVars).toEqual([
      { key: 'DEBUG', value: '1' },
      { key: 'GREETING', value: 'hello world' },
    ]);
  });

  it('reports malformed tokens', () => {
    const { envVars, errors } = parseEnvVars('novalue 9BAD=x OK=1');
    expect(envVars).toEqual([{ key: 'OK', value: '1' }]);
    expect(errors).toHaveLength(2);
  });
});

describe('buildLaunchPayload', () => {
  it('builds the minimal payload', () => {
    expect(buildLaunchPayload({ agentType: 'claude-code', prompt: 'go' })).toEqual({
      agentType: 'claude-code',
      prompt: 'go',
    });
  });

  it('carries model, repo attachment, blueprint, size, and env vars like the web form', () => {
    const payload = buildLaunchPayload({
      agentType: 'opencode',
      prompt: 'fix it',
      name: ' Fix bug ',
      model: 'gpt-5',
      systemPrompt: 'be terse',
      repoSlug: 'acme/app',
      repoBranch: 'main',
      blueprintName: 'app',
      resourceSize: 'LARGE',
      envVars: [{ key: 'DEBUG', value: '1' }],
      extraAttachments: [
        { attachmentId: 'workstation', pluginName: 'workstation', config: { workstationId: 'w1' } },
      ],
    });
    expect(payload).toEqual({
      agentType: 'opencode',
      prompt: 'fix it',
      name: 'Fix bug',
      model: 'gpt-5',
      systemPrompt: 'be terse',
      blueprintName: 'app',
      sandboxOptions: { blueprintName: 'app', resourceSize: 'LARGE' },
      attachments: [
        {
          attachmentId: 'git-repo',
          pluginName: 'github',
          config: { repoSlug: 'acme/app', repoBranch: 'main' },
        },
        { attachmentId: 'workstation', pluginName: 'workstation', config: { workstationId: 'w1' } },
      ],
      envVars: [{ key: 'DEBUG', value: '1' }],
    });
  });

  it('lets a snapshot replace the blueprint outright', () => {
    const payload = buildLaunchPayload({
      agentType: 'claude-code',
      prompt: 'go',
      blueprintName: 'app',
      snapshotId: 'snap_1',
    });
    expect(payload.blueprintName).toBeUndefined();
    expect(payload.sandboxOptions).toEqual({ snapshotId: 'snap_1' });
  });
});
