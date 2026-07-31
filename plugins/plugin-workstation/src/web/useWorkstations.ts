import { useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@reflex/ui/client/http';
import { useOrgKey } from '@reflex/ui/client/context';
import { usePluginEvent } from '@reflex/ui/client/socket';
import {
  WORKSTATION_PLUGIN_NAME,
  WORKSTATION_UPDATED_EVENT,
  type Workstation,
} from '@runloop/reflex-workstation';

export function workstationsQueryKey(orgKey: string) {
  return ['workstations', orgKey] as const;
}

/**
 * The caller's workstations in the active org. Presence flips arrive over
 * the shared socket as `workstation:updated` plugin events; we invalidate
 * rather than patch so the list stays the server's ordering (most recently
 * seen first).
 */
export function useWorkstations() {
  const orgKey = useOrgKey();
  const queryClient = useQueryClient();
  usePluginEvent(WORKSTATION_PLUGIN_NAME, WORKSTATION_UPDATED_EVENT, () => {
    void queryClient.invalidateQueries({ queryKey: workstationsQueryKey(orgKey) });
  });
  return useQuery({
    queryKey: workstationsQueryKey(orgKey),
    queryFn: async () => {
      const res = await request<{ workstations: Workstation[] }>('/workstations');
      return res.workstations;
    },
  });
}
