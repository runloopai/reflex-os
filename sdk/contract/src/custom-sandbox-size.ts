import { z } from 'zod';

/**
 * Org-defined custom devbox sizes, split out from `sandbox.types.ts` into their
 * own dependency-free module so both `sandbox.types.ts` (the launch options) and
 * `blueprint.types.ts` (the blueprint create request) can reference them without
 * forming an import cycle — `sandbox.types.ts` already depends on
 * `blueprint.types.ts` for {@link ResourceSize}, so `blueprint.types.ts` cannot
 * import back from `sandbox.types.ts`.
 */

/**
 * Bounds for org-defined custom sandbox sizes, mirroring Runloop's
 * `CUSTOM_SIZE` launch parameters (`custom_cpu_cores`, `custom_gb_memory`,
 * `custom_disk_size` — see https://docs.runloop.ai/docs/devboxes/configuration/sizes).
 * Disk is optional; Runloop defaults it to 16 GiB when omitted.
 *
 * The minimums are Runloop platform floors and fixed. The maximums are the
 * platform's *documented* ceilings, but accounts can be provisioned higher.
 * Deployments raise CPU and memory with environment variables. Platform
 * admins control the disk ceiling through Reflex service settings (with the
 * legacy `CUSTOM_SANDBOX_MAX_DISK_GB` environment value used until a setting
 * is saved). The effective {@link CustomSandboxSizeLimits} reach the web
 * through `GET /config`.
 */
export const MIN_CUSTOM_SANDBOX_CPU_CORES = 0.5;
export const MAX_CUSTOM_SANDBOX_CPU_CORES = 16;
export const MIN_CUSTOM_SANDBOX_GB_MEMORY = 1;
export const MAX_CUSTOM_SANDBOX_GB_MEMORY = 64;
export const MIN_CUSTOM_SANDBOX_DISK_GB = 2;
export const MAX_CUSTOM_SANDBOX_DISK_GB = 64;

/**
 * The effective maximums for org-defined custom sandbox sizes on this
 * deployment. Resolved server-side from environment defaults plus Reflex
 * service settings, enforced when an org saves its custom-size list, and
 * exposed on `GET /config` so the settings form validates against the same
 * numbers.
 */
export const CustomSandboxSizeLimitsSchema = z
  .object({
    maxCpuCores: z.number().positive(),
    maxGbMemory: z.number().positive(),
    maxDiskSizeGb: z.number().positive(),
  })
  .meta({ id: 'CustomSandboxSizeLimits' });
export type CustomSandboxSizeLimits = z.infer<typeof CustomSandboxSizeLimitsSchema>;

/** Documented Runloop ceilings, used when no deployment override is set. */
export const DEFAULT_CUSTOM_SANDBOX_SIZE_LIMITS: CustomSandboxSizeLimits = {
  maxCpuCores: MAX_CUSTOM_SANDBOX_CPU_CORES,
  maxGbMemory: MAX_CUSTOM_SANDBOX_GB_MEMORY,
  maxDiskSizeGb: MAX_CUSTOM_SANDBOX_DISK_GB,
};
/** Cap on how many custom sizes one org can define. */
export const MAX_CUSTOM_SANDBOX_SIZES = 20;
/** Max length of a custom size's display name. */
export const MAX_CUSTOM_SANDBOX_SIZE_NAME_LENGTH = 50;

/**
 * An org-defined devbox size. Stored on the organization
 * (`customSandboxSizes`), offered in the launcher's size picker alongside
 * the named {@link ResourceSize} tiers, and — when picked — snapshotted onto
 * the launch's {@link SandboxOptions.customSize} so the agent row records the
 * exact dimensions the box was provisioned with (later edits to the org's
 * size list don't retroactively change past launches). It is offered the same
 * way in the blueprint create form so a built blueprint can pin custom
 * dimensions. The Runloop-backed provider maps it onto
 * `resource_size_request: 'CUSTOM_SIZE'` + `custom_cpu_cores` /
 * `custom_gb_memory` / `custom_disk_size`.
 *
 * The schema is structural (names, minimums, integers) and deliberately
 * carries no maximums — account-level ceilings vary per deployment, so upper
 * bounds are enforced with {@link customSandboxSizeLimitViolation} against
 * the env-configured {@link CustomSandboxSizeLimits} when an org saves its
 * size list. Sizes already provisioned elsewhere (a blueprint built with
 * CUSTOM_SIZE) pass through unchecked.
 */
export const CustomSandboxSizeSchema = z
  .object({
    /** Display name, unique within the org (case-insensitive). */
    name: z.string().trim().min(1).max(MAX_CUSTOM_SANDBOX_SIZE_NAME_LENGTH),
    /** vCPU cores, at least {@link MIN_CUSTOM_SANDBOX_CPU_CORES}. */
    cpuCores: z.number().min(MIN_CUSTOM_SANDBOX_CPU_CORES),
    /** Memory in GiB, at least {@link MIN_CUSTOM_SANDBOX_GB_MEMORY}. */
    gbMemory: z.number().int().min(MIN_CUSTOM_SANDBOX_GB_MEMORY),
    /** Disk in GiB. Omit/null to take Runloop's 16 GiB default. */
    diskSizeGb: z.number().int().min(MIN_CUSTOM_SANDBOX_DISK_GB).nullable().optional(),
  })
  .strict();
export type CustomSandboxSize = z.infer<typeof CustomSandboxSizeSchema>;

/** Human spec string for a custom size, e.g. `4 vCPU · 32 GB RAM · 24 GB disk`. */
export function formatCustomSandboxSizeSpec(size: CustomSandboxSize): string {
  const parts = [`${size.cpuCores} vCPU`, `${size.gbMemory} GB RAM`];
  if (size.diskSizeGb != null) parts.push(`${size.diskSizeGb} GB disk`);
  return parts.join(' · ');
}

/**
 * Check a (structurally valid) custom size against the deployment's
 * effective maximums. Returns a human-readable message naming the first
 * violated limit, or `null` when the size fits. Shared so the server's
 * org-settings validation and the web settings form reject with the same
 * copy.
 */
export function customSandboxSizeLimitViolation(
  size: CustomSandboxSize,
  limits: CustomSandboxSizeLimits,
): string | null {
  if (size.cpuCores > limits.maxCpuCores) {
    return `"${size.name}": vCPU must be between ${MIN_CUSTOM_SANDBOX_CPU_CORES} and ${limits.maxCpuCores}.`;
  }
  if (size.gbMemory > limits.maxGbMemory) {
    return `"${size.name}": memory must be between ${MIN_CUSTOM_SANDBOX_GB_MEMORY} and ${limits.maxGbMemory} GB.`;
  }
  if (size.diskSizeGb != null && size.diskSizeGb > limits.maxDiskSizeGb) {
    return `"${size.name}": disk must be between ${MIN_CUSTOM_SANDBOX_DISK_GB} and ${limits.maxDiskSizeGb} GB.`;
  }
  return null;
}
