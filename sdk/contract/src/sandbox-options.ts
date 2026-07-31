import { z } from 'zod';
import { ResourceSizeSchema } from './resource-size.js';
import { CustomSandboxSizeSchema } from './custom-sandbox-size.js';

/**
 * Generic, provider-agnostic options for the sandbox a launched agent runs in.
 *
 * This is the type the SandboxProvider "promotes" to upstream surfaces (the
 * Launch dialog, the persona editor, the agent runner). Provider-specific
 * call sites unpack these into their native parameter shapes — today the
 * Runloop-backed provider maps `blueprintName`/`blueprintId` onto its create
 * call and `resourceSize` onto `launch_parameters.resource_size_request`.
 *
 * Every field is optional so callers can pass a partial override; the agent
 * runner merges these with provider defaults before creating the devbox.
 */
export const SandboxOptionsSchema = z
  .object({
    /** Blueprint name to launch from. Mutually exclusive with `blueprintId`. */
    blueprintName: z.string().nullable().optional(),
    /** Blueprint id (`bp_*`) to launch from. Mutually exclusive with `blueprintName`. */
    blueprintId: z.string().nullable().optional(),
    /**
     * Devbox disk snapshot id (`snp_*`) to launch from instead of a
     * blueprint. Mutually exclusive with the blueprint fields — the agent
     * runner rejects launches that set both.
     */
    snapshotId: z.string().nullable().optional(),
    /** Devbox resource size. Falls back to the org's default size when omitted. */
    resourceSize: ResourceSizeSchema.nullable().optional(),
    /**
     * Org-defined custom devbox size, snapshotted at launch time from the
     * org's `customSandboxSizes` so the agent row records the exact
     * dimensions. Takes precedence over `resourceSize` — the Runloop-backed
     * provider maps it onto `resource_size_request: 'CUSTOM_SIZE'`.
     */
    customSize: CustomSandboxSizeSchema.nullable().optional(),
    /**
     * Start a Docker daemon (Docker-in-Docker) inside the devbox at launch so
     * the agent can build and run containers. Opt-in per launch via the
     * "dockerd" chip. The Runloop-backed provider maps this onto an idempotent
     * dockerd-start launch command (see {@link DOCKERD_LAUNCH_COMMANDS}).
     */
    dockerd: z.boolean().nullable().optional(),
    /**
     * Enable computer use and browser use for the devbox: a virtual desktop
     * the agent can see and control through the computer-use plugin's MCP
     * tools, plus a live "Desktop" tab. Opt-in per launch via the
     * "computer use" capability chip (offered only when the org has the
     * computer-use plugin installed). The `plugin-computer-use` DevboxService,
     * setup hook, and tool-server contributor gate on this flag; unlike
     * `dockerd`, the on-box work lives in the plugin, so core carries only
     * the flag.
     */
    computerUse: z.boolean().nullable().optional(),
    /**
     * Route package installs (pip/uv, Node toolchain downloads) through the
     * Runloop environment's artifact mirror for faster, rate-limit-free
     * installs. **On by default** — unset/null means mirrors are active;
     * only an explicit `false` opts a launch out, so `false` must round-trip
     * through every layer. Not a per-launch capability: the agent runner
     * stamps this from the org-level "artifact mirrors" setting
     * (`Organization.sandboxArtifactMirrors`) before the options reach the
     * provider. The Runloop-backed provider derives the mirror URL from its
     * API base URL and injects the mirror env vars (`PIP_INDEX_URL`,
     * `UV_DEFAULT_INDEX`, `NVM_NODEJS_ORG_MIRROR`, …) on devbox create; npm
     * is deliberately left on the public registry so mirror URLs never leak
     * into committed lockfiles. Requires the Runloop environment to run a
     * mirror and allowlist it in network policies.
     */
    artifactMirrors: z.boolean().nullable().optional(),
    /**
     * Idle minutes before the devbox auto-suspends. Mapped onto Runloop's
     * `launch_parameters.lifecycle.after_idle.idle_time_seconds`. Falls back
     * to {@link DEFAULT_SANDBOX_IDLE_TIME_MINUTES} when omitted. Must be a
     * positive integer.
     */
    idleTimeMinutes: z.number().int().positive().nullable().optional(),
    /**
     * Wake a suspended devbox when an HTTP request reaches its tunnel. Maps
     * onto Runloop's `launch_parameters.lifecycle.resume_triggers.http`. Use
     * this for agents that host something browsers hit directly (a dev
     * server, a preview), so opening the URL resumes the box instead of
     * dead-ending on the suspended tunnel. The agent's own event stream
     * always resumes it regardless (that trigger stays on). Defaults to
     * `true` when omitted.
     */
    resumeOnHttp: z.boolean().nullable().optional(),
  })
  .strict();

export type SandboxOptions = z.infer<typeof SandboxOptionsSchema>;

/**
 * Resolve the effective {@link SandboxOptions} for a launch, layering an
 * explicit `sandboxOptions` object on top of the deprecated top-level
 * `blueprintId` / `blueprintName` carried by legacy payloads. Fields set on
 * `sandboxOptions` always win; legacy fields fill in only when the structured
 * counterpart is unset. Returns `null` when no relevant field is present
 * (so callers can avoid passing an empty options bag downstream).
 */
export function resolveSandboxOptions(input: {
  sandboxOptions?: SandboxOptions | null;
  blueprintId?: string | null;
  blueprintName?: string | null;
}): SandboxOptions | null {
  const so = input.sandboxOptions ?? null;
  const blueprintId = so?.blueprintId ?? input.blueprintId ?? null;
  const blueprintName = so?.blueprintName ?? input.blueprintName ?? null;
  const snapshotId = so?.snapshotId ?? null;
  const resourceSize = so?.resourceSize ?? null;
  const customSize = so?.customSize ?? null;
  const dockerd = so?.dockerd ?? null;
  const computerUse = so?.computerUse ?? null;
  // Mirrors are on by default, so only an explicit `false` differs from the
  // default — preserve it (like `resumeOnHttp`) while treating unset/true as
  // "use default".
  const artifactMirrors = so?.artifactMirrors ?? null;
  const idleTimeMinutes = so?.idleTimeMinutes ?? null;
  // Only a caller who explicitly disables http resume differs from the
  // default, so preserve `false` while treating unset/true as "use default".
  const resumeOnHttp = so?.resumeOnHttp ?? null;
  if (
    !blueprintId &&
    !blueprintName &&
    !snapshotId &&
    !resourceSize &&
    !customSize &&
    !dockerd &&
    !computerUse &&
    artifactMirrors === null &&
    !idleTimeMinutes &&
    resumeOnHttp === null
  )
    return null;
  const result: SandboxOptions = {};
  if (blueprintId) result.blueprintId = blueprintId;
  if (blueprintName) result.blueprintName = blueprintName;
  if (snapshotId) result.snapshotId = snapshotId;
  if (resourceSize) result.resourceSize = resourceSize;
  if (customSize) result.customSize = customSize;
  if (dockerd) result.dockerd = true;
  if (computerUse) result.computerUse = true;
  if (artifactMirrors !== null) result.artifactMirrors = artifactMirrors;
  if (idleTimeMinutes) result.idleTimeMinutes = idleTimeMinutes;
  if (resumeOnHttp !== null) result.resumeOnHttp = resumeOnHttp;
  return result;
}
