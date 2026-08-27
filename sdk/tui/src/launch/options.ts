import type {
  AgentModelSupportResponse,
  Blueprint,
  CreateAgentBody as AgentConfigInput,
  CreateAgentBodyEnvVarsItem as AgentEnvVarInput,
} from '@runloop/reflex-client';
import {
  blueprintMatchesRepo,
  buildContentBlocks,
  buildGitRepoAttachment,
  isBaseBlueprint,
  rankBlueprintsForRepo,
  resolveSandboxOptions,
  type Attachment,
  type PluginAttachmentValue,
  type ResourceSize,
} from '@runloop/reflex-contract';

/**
 * Launch-wizard option derivation and payload assembly, ported from the web
 * launch dialog (`web/src/components/agent/launch-agent-form` +
 * `launch-agent-dialog/form-state.ts`) so the TUI submits the same
 * `AgentConfig` the web form would for the same choices. Pure functions —
 * the screen owns fetching and key handling.
 */

export interface PickOption {
  /** Stable value submitted with the form; null means "use the default". */
  value: string | null;
  label: string;
  hint?: string;
}

/**
 * Agent types the org can launch, defaults first. Mirrors the launch form:
 * `launchableAgents` filtered to enabled (absent on older servers → every
 * catalog entry counts), display names from the catalog.
 */
export function agentTypeOptions(support: AgentModelSupportResponse | null): PickOption[] {
  if (!support) return [];
  const entries =
    support.launchableAgents
      ?.filter((a) => a.enabled)
      .map((a) => ({
        type: a.agentType,
        label: a.displayName,
      })) ??
    Object.keys(support.agents).map((type) => ({
      type,
      label: support.agents[type]?.status === 'available' ? support.agents[type].displayName : type,
    }));
  const defaultType = support.defaultAgentType;
  entries.sort((a, b) => {
    if (a.type === defaultType) return -1;
    if (b.type === defaultType) return 1;
    return a.label.localeCompare(b.label);
  });
  return entries.map((e) => ({
    value: e.type,
    label: e.label,
    hint: e.type === defaultType ? 'default' : undefined,
  }));
}

/**
 * Models for one agent type from the discovery matrix, the catalog default
 * first, each labelled with its provider when the agent supports several.
 * A leading `null` option lets the launch omit `model` entirely so the
 * server resolves its default — also the only option for agent types the
 * matrix doesn't cover (single-model agents).
 */
export function modelOptions(
  support: AgentModelSupportResponse | null,
  agentType: string | null,
): PickOption[] {
  const auto: PickOption = { value: null, label: 'default', hint: 'server-resolved' };
  const entry = agentType ? support?.agents[agentType] : undefined;
  if (!entry || entry.status !== 'available') return [auto];

  const models = entry.discoveredModels ?? [];
  const multiProvider = new Set(models.map((m) => m.providerId)).size > 1;
  const options = models.map((m) => ({
    value: m.id,
    label: m.displayName ?? m.id,
    hint: [multiProvider ? m.providerId : null, m.id === entry.defaultModel ? 'default' : null]
      .filter(Boolean)
      .join(' · '),
  }));
  options.sort((a, b) => {
    if (a.value === entry.defaultModel) return -1;
    if (b.value === entry.defaultModel) return 1;
    return 0;
  });
  return [auto, ...options];
}

/**
 * Build-complete blueprints deduplicated by name (latest wins), newest first,
 * with the ones built for the selected repo ranked to the top. Port of
 * `useAvailableBlueprints`, sharing its ranking policy.
 */
export function availableBlueprints(blueprints: Blueprint[], repoSlug?: string): Blueprint[] {
  const byName = new Map<string, Blueprint>();
  for (const bp of blueprints) {
    if (bp.status !== 'build_complete') continue;
    const existing = byName.get(bp.name);
    if (!existing || bp.createTimeMs > existing.createTimeMs) byName.set(bp.name, bp);
  }
  const latest = [...byName.values()].sort((a, b) => b.createTimeMs - a.createTimeMs);
  return repoSlug ? rankBlueprintsForRepo(latest, repoSlug) : latest;
}

/**
 * The blueprint the web form would auto-select: the one built for the repo,
 * else the org's `base`, else any base blueprint. Port of the launch form's
 * `selectedBlueprintName` fallback chain.
 */
export function autoBlueprintName(blueprints: Blueprint[], repoSlug?: string): string | null {
  if (repoSlug) {
    // Same matcher `availableBlueprints` ranks with, so the blueprint the list
    // puts first is the one selected here.
    const repoMatch = blueprints.find((bp) => blueprintMatchesRepo(bp, repoSlug));
    if (repoMatch) return repoMatch.name;
  }
  const base = blueprints.find((bp) => bp.name === 'base') ?? blueprints.find(isBaseBlueprint);
  return base?.name ?? null;
}

/**
 * Parse `KEY=VALUE KEY2="quoted value"` (whitespace-separated) into env var
 * inputs. Malformed tokens (no `=`, invalid key) are reported, not dropped
 * silently.
 */
export function parseEnvVars(input: string): {
  envVars: AgentEnvVarInput[];
  errors: string[];
} {
  const envVars: AgentEnvVarInput[] = [];
  const errors: string[] = [];
  const tokens = input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq <= 0) {
      errors.push(`"${token}" is not KEY=VALUE`);
      continue;
    }
    const key = token.slice(0, eq);
    let value = token.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push(`"${key}" is not a valid env var name`);
      continue;
    }
    envVars.push({ key, value });
  }
  return { envVars, errors };
}

export interface LaunchSelections {
  agentType: string;
  prompt: string;
  name?: string;
  model?: string | null;
  systemPrompt?: string;
  repoSlug?: string;
  repoBranch?: string;
  /** Chosen blueprint name; ignored when `snapshotId` is set. */
  blueprintName?: string | null;
  /** A picked snapshot replaces the blueprint outright (server rejects both). */
  snapshotId?: string | null;
  resourceSize?: ResourceSize | null;
  envVars?: AgentEnvVarInput[];
  extraAttachments?: PluginAttachmentValue[];
  /** Inline files/images for the initial prompt (sent as content blocks, like the web composer). */
  inlineAttachments?: Attachment[];
}

/**
 * Assemble the `AgentConfigInput` launch payload exactly the way the web
 * form's submit does: snapshot XOR blueprint, `resolveSandboxOptions` for the
 * sandbox block, git repo as a plugin attachment, empty optionals omitted.
 */
export function buildLaunchPayload(sel: LaunchSelections): AgentConfigInput {
  const attachments: PluginAttachmentValue[] = [];
  const gitRepo = buildGitRepoAttachment({
    repoSlug: sel.repoSlug,
    repoBranch: sel.repoBranch,
  });
  if (gitRepo) attachments.push(gitRepo);
  attachments.push(...(sel.extraAttachments ?? []));

  const blueprintName = sel.snapshotId ? null : (sel.blueprintName ?? null);
  const sandboxOptions = resolveSandboxOptions({
    blueprintName,
    sandboxOptions: {
      ...(sel.resourceSize ? { resourceSize: sel.resourceSize } : {}),
      ...(sel.snapshotId ? { snapshotId: sel.snapshotId } : {}),
    },
  });

  const inline = sel.inlineAttachments ?? [];

  return {
    agentType: sel.agentType,
    prompt: sel.prompt,
    ...(sel.name?.trim() ? { name: sel.name.trim() } : {}),
    ...(sel.model ? { model: sel.model } : {}),
    ...(sel.systemPrompt?.trim() ? { systemPrompt: sel.systemPrompt.trim() } : {}),
    ...(blueprintName ? { blueprintName } : {}),
    ...(sandboxOptions ? { sandboxOptions } : {}),
    ...(inline.length > 0 ? { content: buildContentBlocks(sel.prompt, inline) } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(sel.envVars && sel.envVars.length > 0 ? { envVars: sel.envVars } : {}),
  };
}
