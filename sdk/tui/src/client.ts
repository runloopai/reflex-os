import { configureReflex, reflexRequest } from '@runloop/reflex-client';
import type { Workstation } from '@runloop/reflex-workstation';
import type { TuiConfig } from './config.js';

/** Point the shared reflex-client singleton at the configured server. */
export function configureClient(config: TuiConfig): void {
  configureReflex({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    organizationId: config.organizationId,
  });
}

/**
 * Workstation routes are plugin-contributed and therefore not part of the
 * generated OpenAPI client — call them through `reflexRequest`, which
 * carries the same auth/org headers as the generated operations.
 */
export async function listWorkstations(): Promise<Workstation[]> {
  const res = await reflexRequest<{ workstations: Workstation[] }>('/workstations');
  return res.workstations;
}
