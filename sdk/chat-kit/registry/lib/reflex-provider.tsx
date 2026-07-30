/**
 * Reflex context provider.
 *
 * Configures the `@runloop/reflex-client` SDK, owns one `ReflexSocket` for
 * live updates, and supplies a TanStack Query client (yours if you pass one,
 * otherwise its own). Mount it once, above every Reflex chat component.
 *
 * You own this file; wire it into your existing providers as needed.
 */
import { createContext, useContext, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configureReflex, ReflexSocket } from '@runloop/reflex-client';

export interface ReflexProviderProps {
  /** Reflex server origin, e.g. https://reflex.runloop.ai (no /api suffix). */
  baseUrl: string;
  /** Personal API key (rfx_...). Treat it like a password. */
  apiKey: string;
  /** Organization id (org_...) or slug to scope requests to. */
  organizationId?: string;
  /** Reuse your app's QueryClient; omit to let the provider own one. */
  queryClient?: QueryClient;
  children: ReactNode;
}

interface ReflexContextValue {
  socket: ReflexSocket;
}

const ReflexContext = createContext<ReflexContextValue | null>(null);

export function ReflexProvider({
  baseUrl,
  apiKey,
  organizationId,
  queryClient,
  children,
}: ReflexProviderProps) {
  // Configure synchronously (before children render) so queries fired on
  // first mount already see the config. Reruns when credentials change.
  useMemo(() => {
    configureReflex({ baseUrl, apiKey, organizationId });
  }, [baseUrl, apiKey, organizationId]);

  const socket = useMemo(() => new ReflexSocket(), []);
  const client = useMemo(() => queryClient ?? new QueryClient(), [queryClient]);

  useEffect(() => {
    socket.connect();
    return () => socket.close();
  }, [socket]);

  const value = useMemo(() => ({ socket }), [socket]);

  return (
    <ReflexContext.Provider value={value}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ReflexContext.Provider>
  );
}

/** Access the shared socket. Must be called under a `ReflexProvider`. */
export function useReflex(): ReflexContextValue {
  const ctx = useContext(ReflexContext);
  if (!ctx) {
    throw new Error('useReflex must be used inside a <ReflexProvider>.');
  }
  return ctx;
}
