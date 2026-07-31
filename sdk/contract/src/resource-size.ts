import { z } from 'zod';

/** Devbox resource size a sandbox or blueprint runs at. */
export const ResourceSizeSchema = z.enum(['SMALL', 'MEDIUM', 'LARGE', 'X_LARGE', 'XX_LARGE']);

export type ResourceSize = z.infer<typeof ResourceSizeSchema>;

/**
 * Coerce a raw devbox resource-size string (e.g. Runloop's
 * `launch_parameters.resource_size_request`) into our {@link ResourceSize}
 * enum. Runloop also reports `X_SMALL` and `CUSTOM_SIZE`, which have no badge in
 * our UI, so those, along with any unknown, empty, or null value, map to `null`.
 */
export function coerceResourceSize(raw: string | null | undefined): ResourceSize | null {
  const parsed = ResourceSizeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Whether a blueprint is one of the platform-managed base images rather than
 * something an organization built.
 *
 * Takes the fields structurally instead of the full `Blueprint` type: the
 * blueprint record itself stays private to the server, and this only ever
 * looks at a name and a metadata tag.
 *
 * Three ways a blueprint counts as a base:
 *   1. `metadata.type === 'base'` — the current, explicit marker.
 *   2. `name === 'base'` — the original singleton the bootstrap service
 *      has always managed under that exact name.
 *   3. `name` contains `_base` — convention for derived bases that
 *      predates the metadata tag (e.g. `node_base`, `node_base_arm`).
 */
export function isBaseBlueprint(bp: {
  name: string;
  metadata?: { type?: string | null } | null;
}): boolean {
  if (bp.metadata?.type === 'base') return true;
  if (bp.name === 'base') return true;
  if (bp.name.includes('_base')) return true;
  return false;
}
