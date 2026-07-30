/**
 * Reflex connection settings, read from Vite env vars. Copy `.env.example`
 * to `.env` and fill in your values.
 */
export interface ReflexEnv {
  baseUrl: string;
  apiKey: string;
  organizationId: string | undefined;
}

/** Returns null when no API key is configured (renders the setup screen). */
export function readReflexEnv(): ReflexEnv | null {
  const apiKey: string | undefined = import.meta.env.VITE_REFLEX_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: import.meta.env.VITE_REFLEX_BASE_URL ?? 'http://localhost:4000',
    apiKey,
    organizationId: import.meta.env.VITE_REFLEX_ORG || undefined,
  };
}
