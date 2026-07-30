import { Box, Text, useInput } from 'ink';
import { useEffect, useState } from 'react';
import {
  createAgent,
  getAgentModelSupport,
  listBlueprints,
  listSnapshots,
  type Agent,
  type CreateAgentBody,
  type Snapshot,
} from '@runloop/reflex-client';
import type {
  AgentEnvVarInput,
  AgentModelSupportResponse,
  Attachment,
  Blueprint,
  ResourceSize,
} from '@reflex/shared';
import {
  assertAttachmentLimits,
  attachmentFromBytes,
  extractPastedPath,
  loadAttachment,
} from '../attachments.js';
import { readClipboardImage } from '../clipboard.js';
import {
  WORKSTATION_ATTACHMENT_ID,
  WORKSTATION_PLUGIN_NAME,
  type Workstation,
} from '@reflex/plugin-workstation/shared/types';
import { listWorkstations } from '../client.js';
import {
  agentTypeOptions,
  autoBlueprintName,
  availableBlueprints,
  buildLaunchPayload,
  modelOptions,
  parseEnvVars,
  type PickOption,
} from '../launch/options.js';
import { ComposerInput } from './ComposerInput.js';
import { SelectList } from './SelectList.js';

/** Names pasted clipboard images uniquely within the process. */
let pastedImageSeq = 0;

interface LaunchScreenProps {
  /**
   * Agent type the wizard starts on — the saved last-used type. When absent
   * the server catalog's default applies once it loads.
   */
  defaultAgentType?: string;
  /** Repo the wizard prefills — the last one launched with (from config). */
  initialRepo?: string;
  /** Model the model step's cursor starts on (only passed when the saved
   * agent type is in effect, so it can't pair with the wrong type). */
  initialModel?: string;
  onLaunched: (agent: Agent) => void;
  /** Fires on a successful launch so the host can save the choices as the
   * next launch's defaults. */
  onDefaultsUsed?: (defaults: { agentType: string; model: string | null; repo: string }) => void;
  onCancel: () => void;
}

const FALLBACK_AGENT_TYPE = 'claude-code';

const RESOURCE_SIZES: ResourceSize[] = ['SMALL', 'MEDIUM', 'LARGE', 'X_LARGE', 'XX_LARGE'];

type Step =
  | 'prompt'
  | 'agentType'
  | 'model'
  | 'repo'
  | 'blueprint'
  | 'workstation'
  | 'confirm'
  | 'name'
  | 'systemPrompt'
  | 'envVars'
  | 'resourceSize'
  | 'launching';

/** Wizard order for esc-back navigation (advanced steps return to confirm). */
const STEP_BACK: Partial<Record<Step, Step>> = {
  agentType: 'prompt',
  model: 'agentType',
  repo: 'model',
  blueprint: 'repo',
  workstation: 'blueprint',
  confirm: 'workstation',
  name: 'confirm',
  systemPrompt: 'confirm',
  envVars: 'confirm',
  resourceSize: 'confirm',
};

/**
 * Launch wizard with the same launch surface as the web dialog: prompt →
 * agent type and model (from the server's model-support catalog) → repo →
 * blueprint or snapshot (repo-matched auto pick, base fallback) → workstation
 * → confirm, with advanced fields (name, system prompt, env vars, resource
 * size) behind `a` on the confirm step. Selections assemble the identical
 * `AgentConfig` payload the web form submits (`launch/options.ts`).
 */
export function LaunchScreen({
  defaultAgentType,
  initialRepo,
  initialModel,
  onLaunched,
  onDefaultsUsed,
  onCancel,
}: LaunchScreenProps) {
  const [step, setStep] = useState<Step>('prompt');
  const [error, setError] = useState<string | null>(null);

  // Catalog data — all optional; every fetch failure degrades to a simpler
  // wizard rather than blocking launches.
  const [support, setSupport] = useState<AgentModelSupportResponse | null>(null);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [workstations, setWorkstations] = useState<Workstation[]>([]);

  // Selections
  const [prompt, setPrompt] = useState('');
  const [agentType, setAgentType] = useState(defaultAgentType ?? FALLBACK_AGENT_TYPE);
  const [model, setModel] = useState<string | null>(initialModel ?? null);
  const [modelLabel, setModelLabel] = useState('default');
  const [repo, setRepo] = useState(initialRepo ?? '');
  const [blueprintPick, setBlueprintPick] = useState<PickOption | null>(null);
  const [workstation, setWorkstation] = useState<Workstation | null>(null);
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [envVarsInput, setEnvVarsInput] = useState('');
  const [envVars, setEnvVars] = useState<AgentEnvVarInput[]>([]);
  const [resourceSize, setResourceSize] = useState<ResourceSize | null>(null);
  const [staged, setStaged] = useState<Attachment[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [supportRes, blueprintsRes, snapshotsRes, workstationsRes] = await Promise.allSettled([
        getAgentModelSupport(),
        listBlueprints(),
        listSnapshots(),
        listWorkstations(),
      ]);
      if (cancelled) return;
      if (supportRes.status === 'fulfilled') {
        const data = supportRes.value.data as unknown as AgentModelSupportResponse;
        setSupport(data);
        // The catalog default applies only when there is no saved preference
        // — a remembered agent type must not be clobbered by the fetch.
        if (!defaultAgentType && data.defaultAgentType) setAgentType(data.defaultAgentType);
      }
      if (blueprintsRes.status === 'fulfilled') {
        setBlueprints(blueprintsRes.value.data as unknown as Blueprint[]);
      }
      // Snapshots 403 for orgs without the devbox-snapshots capability.
      if (snapshotsRes.status === 'fulfilled') setSnapshots(snapshotsRes.value.data);
      if (workstationsRes.status === 'fulfilled') {
        setWorkstations(workstationsRes.value.filter((w) => w.status === 'online'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const textStep =
    step === 'prompt' ||
    step === 'repo' ||
    step === 'name' ||
    step === 'systemPrompt' ||
    step === 'envVars';

  useInput(
    (input, key) => {
      // ctrl+v on the prompt step pastes a clipboard image into the initial
      // prompt's attachments, like the web launch composer.
      if (key.ctrl && input === 'v' && step === 'prompt') {
        void stageClipboardImage();
        return;
      }
      if (key.escape && step !== 'launching') {
        const back = STEP_BACK[step];
        if (back) setStep(back);
        else onCancel();
        return;
      }
      if (step === 'confirm') {
        if (key.return) void launch();
        if (input === 'a') setStep('name');
      }
    },
    // Select steps handle their own keys (incl. esc) inside SelectList; this
    // hook covers the text steps' esc-back and the confirm-step shortcuts.
    { isActive: textStep || step === 'confirm' || step === 'launching' },
  );

  async function stageFile(filePath: string) {
    try {
      const attachment = await loadAttachment(filePath);
      assertAttachmentLimits(staged, attachment);
      setStaged((prev) => [...prev, attachment]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function stageClipboardImage() {
    const bytes = await readClipboardImage();
    if (!bytes) {
      setError('no image on the clipboard');
      return;
    }
    try {
      const attachment = attachmentFromBytes(`pasted-image-${++pastedImageSeq}.png`, bytes);
      assertAttachmentLimits(staged, attachment);
      setStaged((prev) => [...prev, attachment]);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Pasted chunk that is an existing file's path → attachment, not text. */
  function handlePastedChunk(text: string): boolean {
    const filePath = extractPastedPath(text);
    if (!filePath) return false;
    void stageFile(filePath);
    return true;
  }

  const [repoSlug, repoBranch] = repo.trim().split('#', 2);
  const blueprintsForRepo = availableBlueprints(blueprints, repoSlug || undefined);
  const autoName = autoBlueprintName(blueprintsForRepo, repoSlug || undefined);

  const agentTypePicks = agentTypeOptions(support);
  const modelPicks = modelOptions(support, agentType);
  const blueprintPicks: PickOption[] = [
    { value: null, label: `auto${autoName ? ` (${autoName})` : ''}`, hint: 'repo match or base' },
    ...blueprintsForRepo.map((bp) => ({
      value: `bp:${bp.name}`,
      label: bp.name,
      hint: bp.metadata?.repo ?? undefined,
    })),
    ...snapshots.map((snap) => ({
      value: `snap:${snap.id}`,
      label: `snapshot: ${snap.name}`,
      hint: snap.sourceAgentName ?? undefined,
    })),
  ];
  const workstationPicks: PickOption[] = [
    { value: null, label: 'none' },
    ...workstations.map((w) => ({
      value: w.id,
      label: w.name,
      hint: `${w.hostname} · ${w.platform}`,
    })),
  ];
  const resourcePicks: PickOption[] = [
    { value: null, label: 'default', hint: 'server-resolved' },
    ...RESOURCE_SIZES.map((size) => ({ value: size, label: size })),
  ];

  async function launch() {
    setStep('launching');
    setError(null);

    const snapshotId = blueprintPick?.value?.startsWith('snap:')
      ? blueprintPick.value.slice('snap:'.length)
      : null;
    const blueprintName = blueprintPick?.value?.startsWith('bp:')
      ? blueprintPick.value.slice('bp:'.length)
      : (autoName ?? null);

    const payload = buildLaunchPayload({
      agentType,
      prompt: prompt.trim(),
      name,
      model,
      systemPrompt,
      repoSlug: repoSlug || undefined,
      repoBranch: repoBranch || undefined,
      blueprintName,
      snapshotId,
      resourceSize,
      envVars,
      inlineAttachments: staged,
      extraAttachments: workstation
        ? [
            {
              attachmentId: WORKSTATION_ATTACHMENT_ID,
              pluginName: WORKSTATION_PLUGIN_NAME,
              config: { workstationId: workstation.id, workstationName: workstation.name },
            },
          ]
        : [],
    });

    try {
      const res = await createAgent(payload as CreateAgentBody);
      onDefaultsUsed?.({ agentType, model, repo: repo.trim() });
      onLaunched(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('confirm');
    }
  }

  /** One summary row on the confirm screen / completed step trail. */
  function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
    return (
      <Box gap={1}>
        <Box width={13}>
          <Text dimColor>{label}</Text>
        </Box>
        <Text dimColor={dim} wrap="truncate-end">
          {value}
        </Text>
      </Box>
    );
  }

  const stepOrder: Step[] = ['prompt', 'agentType', 'model', 'repo', 'blueprint', 'workstation'];
  const currentIdx = stepOrder.indexOf(step);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Launch agent
      </Text>

      {/* Completed steps render as a compact trail above the active one. */}
      <Box flexDirection="column" marginTop={1}>
        {(currentIdx > 0 || step === 'confirm' || !stepOrder.includes(step)) && (
          <Row label="prompt" value={prompt} />
        )}
        {(currentIdx > 1 || !stepOrder.includes(step)) && <Row label="agent" value={agentType} />}
        {(currentIdx > 2 || !stepOrder.includes(step)) && <Row label="model" value={modelLabel} />}
        {(currentIdx > 3 || !stepOrder.includes(step)) && (
          <Row label="repo" value={repo.trim() || 'none'} />
        )}
        {(currentIdx > 4 || !stepOrder.includes(step)) && (
          <Row
            label="blueprint"
            value={blueprintPick?.label ?? `auto${autoName ? ` (${autoName})` : ''}`}
          />
        )}
        {!stepOrder.includes(step) && (
          <Row label="workstation" value={workstation?.name ?? 'none'} />
        )}
      </Box>

      {step === 'prompt' ? (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={1}>
            <Text color="cyan">❯</Text>
            <Text>Prompt:</Text>
            <ComposerInput
              value={prompt}
              onChange={setPrompt}
              onSubmit={() => {
                if (prompt.trim()) setStep('agentType');
              }}
              onPaste={handlePastedChunk}
              placeholder="what should the agent do?"
            />
          </Box>
          <Text dimColor>{'  '}^v paste image · drop a file to attach</Text>
        </Box>
      ) : null}
      {staged.length > 0 ? (
        <Text dimColor>
          {'  ⎘ '}
          {staged.map((a) => a.name).join(' · ')}
        </Text>
      ) : null}

      {step === 'agentType' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Agent type{support ? '' : ' (catalog unavailable — using default)'}:</Text>
          {agentTypePicks.length > 0 ? (
            <SelectList
              options={agentTypePicks}
              initialValue={agentType}
              onPick={(pick) => {
                if (pick.value) setAgentType(pick.value);
                setModel(null);
                setModelLabel('default');
                setStep('model');
              }}
              onBack={() => setStep('prompt')}
            />
          ) : (
            <SelectList
              options={[{ value: agentType, label: agentType, hint: 'default' }]}
              onPick={() => setStep('model')}
              onBack={() => setStep('prompt')}
            />
          )}
        </Box>
      ) : null}

      {step === 'model' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Model:</Text>
          <SelectList
            options={modelPicks}
            initialValue={model}
            onPick={(pick) => {
              setModel(pick.value);
              setModelLabel(pick.value ? pick.label : 'default');
              setStep('repo');
            }}
            onBack={() => setStep('agentType')}
          />
        </Box>
      ) : null}

      {step === 'repo' ? (
        <Box gap={1} marginTop={1}>
          <Text color="cyan">❯</Text>
          <Text>Repo (owner/repo[#branch], empty to skip):</Text>
          <ComposerInput value={repo} onChange={setRepo} onSubmit={() => setStep('blueprint')} />
        </Box>
      ) : null}

      {step === 'blueprint' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            Blueprint{snapshots.length > 0 ? ' or snapshot' : ''}
            {repoSlug ? <Text dimColor> (scoped to {repoSlug})</Text> : null}:
          </Text>
          <SelectList
            options={blueprintPicks}
            initialValue={blueprintPick?.value ?? null}
            onPick={(pick) => {
              setBlueprintPick(pick);
              setStep('workstation');
            }}
            onBack={() => setStep('repo')}
          />
        </Box>
      ) : null}

      {step === 'workstation' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Connect a workstation:</Text>
          <SelectList
            options={workstationPicks}
            initialValue={workstation?.id ?? null}
            onPick={(pick) => {
              setWorkstation(workstations.find((w) => w.id === pick.value) ?? null);
              setStep('confirm');
            }}
            onBack={() => setStep('blueprint')}
          />
          {workstations.length === 0 ? (
            <Text dimColor>
              {'  '}no online workstations — run `reflex-cli connect` on a machine first
            </Text>
          ) : null}
        </Box>
      ) : null}

      {step === 'confirm' || step === 'launching' ? (
        <Box flexDirection="column" marginTop={1}>
          {name.trim() ? <Row label="name" value={name} /> : null}
          {systemPrompt.trim() ? <Row label="system" value={systemPrompt} /> : null}
          {envVars.length > 0 ? (
            <Row label="env" value={envVars.map((v) => v.key).join(', ')} />
          ) : null}
          {resourceSize ? <Row label="size" value={resourceSize} /> : null}
          {step === 'launching' ? (
            <Text color="yellow">launching…</Text>
          ) : (
            <Text>
              <Text color="cyan" bold>
                enter
              </Text>{' '}
              launch · <Text bold>a</Text> advanced (name, system prompt, env vars, size) ·{' '}
              <Text bold>esc</Text> back
            </Text>
          )}
        </Box>
      ) : null}

      {step === 'name' ? (
        <Box gap={1} marginTop={1}>
          <Text color="cyan">❯</Text>
          <Text>Name (empty for auto):</Text>
          <ComposerInput value={name} onChange={setName} onSubmit={() => setStep('systemPrompt')} />
        </Box>
      ) : null}

      {step === 'systemPrompt' ? (
        <Box gap={1} marginTop={1}>
          <Text color="cyan">❯</Text>
          <Text>System prompt (empty to skip):</Text>
          <ComposerInput
            value={systemPrompt}
            onChange={setSystemPrompt}
            onSubmit={() => setStep('envVars')}
          />
        </Box>
      ) : null}

      {step === 'envVars' ? (
        <Box flexDirection="column" marginTop={1}>
          <Box gap={1}>
            <Text color="cyan">❯</Text>
            <Text>Env vars (KEY=VALUE, space-separated, empty to skip):</Text>
            <ComposerInput
              value={envVarsInput}
              onChange={setEnvVarsInput}
              onSubmit={() => {
                const parsed = parseEnvVars(envVarsInput);
                if (parsed.errors.length > 0) {
                  setError(parsed.errors.join('; '));
                  return;
                }
                setError(null);
                setEnvVars(parsed.envVars);
                setStep('resourceSize');
              }}
            />
          </Box>
        </Box>
      ) : null}

      {step === 'resourceSize' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>Devbox size:</Text>
          <SelectList
            options={resourcePicks}
            initialValue={resourceSize}
            onPick={(pick) => {
              setResourceSize((pick.value as ResourceSize | null) ?? null);
              setStep('confirm');
            }}
            onBack={() => setStep('confirm')}
          />
        </Box>
      ) : null}

      {error ? <Text color="red">{error}</Text> : null}
      <Box marginTop={1}>
        <Text dimColor>{textStep ? 'enter continue · esc back' : 'esc back'}</Text>
      </Box>
    </Box>
  );
}
