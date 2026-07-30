/**
 * Live agent stream hook.
 *
 * Fetches the agent's event history over REST, then keeps the TanStack
 * Query cache current by appending events that arrive over the shared
 * `ReflexSocket` subscription (deduplicated by event id, so the REST
 * history and the socket replay overlap safely). Mirrors the pattern the
 * Reflex web app itself uses.
 *
 * You own this file; extend the query options to fit your app.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { getAgentStream } from '@runloop/reflex-client';
import type { ReflexStreamEvent } from '@runloop/reflex-client';
import { useReflex } from '../lib/reflex-provider';
import { deduplicateEvents, reconcilePendingEvents } from '../lib/event-utils';

/** Cache key for one agent's event stream. */
export const agentStreamKey = (agentId: string) => ['reflex-chat', 'stream', agentId] as const;

/**
 * Subscribe to an agent's event stream.
 *
 * @param agentId - the agent whose history to fetch (null disables).
 * @param streamId - the agent's `streamId` (from `getAgent`); the socket
 *   subscription key. Null skips the live subscription.
 */
export function useAgentStream(
  agentId: string | null,
  streamId: string | null,
): UseQueryResult<ReflexStreamEvent[]> {
  const { socket } = useReflex();
  const queryClient = useQueryClient();

  const query = useQuery<ReflexStreamEvent[]>({
    queryKey: agentStreamKey(agentId ?? ''),
    queryFn: async () => {
      if (!agentId) return [];
      const { data } = await getAgentStream(agentId);
      return data;
    },
    enabled: agentId !== null,
    // Live events keep the cache fresh; no refetch-on-interval needed.
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!agentId || !streamId) return;
    // The socket replays stream history on subscribe and after reconnects,
    // so dedupe by id when appending into the cache.
    return socket.subscribe(streamId, (event) => {
      // Dedupe by id (REST history and the socket replay overlap) and drop
      // optimistic pending entries the incoming event confirms — the socket
      // echo of a send usually lands before the POST response does.
      queryClient.setQueryData<ReflexStreamEvent[]>(agentStreamKey(agentId), (old) =>
        reconcilePendingEvents(deduplicateEvents([...(old ?? []), event])),
      );
    });
  }, [agentId, streamId, socket, queryClient]);

  return query;
}
