/** Current player, shared from the app shell after the join gate. */
import { createContext, useContext } from 'react';
import type { Me } from './api.ts';

export interface Session {
  me: Me;
  refresh: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside the app shell.');
  return ctx;
}
