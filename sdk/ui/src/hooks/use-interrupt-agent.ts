// AUTO-SYNCED from sdk/chat-kit/registry/hooks/use-interrupt-agent.ts — edit there, then run `pnpm --filter @runloop/reflex-ui sync`.
/**
 * Interrupt mutation: stop the agent's current turn.
 *
 * Wraps `POST /agents/:id/interrupt`. The stream reports the outcome
 * (`turn.cancelled` and a status change), so there is no cache surgery to
 * do here — the live subscription picks it up.
 *
 * You own this file; add confirmation UX or toasts as your product needs.
 */
import { useMutation } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { interruptAgent } from '@runloop/reflex-client';

export function useInterruptAgent(agentId: string): UseMutationResult<void, Error, void> {
  return useMutation<void, Error, void>({
    mutationFn: async () => {
      await interruptAgent(agentId);
    },
  });
}
