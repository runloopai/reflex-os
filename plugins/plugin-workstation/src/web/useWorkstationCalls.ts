import { useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@reflex/ui/client/http';
import { useOrgKey } from '@reflex/ui/client/context';
import { usePluginEvent } from '@reflex/ui/client/socket';
import {
  WORKSTATION_CALL_EVENT,
  WORKSTATION_PLUGIN_NAME,
  type WorkstationToolCallRecord,
} from '@runloop/reflex-workstation';

export function workstationCallsQueryKey(orgKey: string, workstationId: string) {
  return ['workstation-calls', orgKey, workstationId] as const;
}

/**
 * Recent audit rows for one workstation (owner-only server-side). The
 * completion broadcast is a bare `{ workstationId }` ping, so we refetch on
 * match rather than patching the cache.
 */
export function useWorkstationCalls(workstationId: string | null) {
  const orgKey = useOrgKey();
  const queryClient = useQueryClient();
  usePluginEvent(WORKSTATION_PLUGIN_NAME, WORKSTATION_CALL_EVENT, (payload) => {
    const id = (payload as { workstationId?: string } | null)?.workstationId;
    if (id && id === workstationId) {
      void queryClient.invalidateQueries({ queryKey: workstationCallsQueryKey(orgKey, id) });
    }
  });
  return useQuery({
    queryKey: workstationCallsQueryKey(orgKey, workstationId ?? 'none'),
    enabled: Boolean(workstationId),
    // Non-owners get a 404 by design — retrying won't change that.
    retry: false,
    queryFn: async () => {
      const res = await request<{ calls: WorkstationToolCallRecord[] }>(
        `/workstations/${encodeURIComponent(workstationId!)}/calls`,
      );
      return res.calls;
    },
  });
}
