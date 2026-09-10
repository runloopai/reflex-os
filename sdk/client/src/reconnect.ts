/** Timing policy shared by the SDK and host web socket clients. Owns no timers or sockets. */
export interface ReconnectOptions {
  /** Initial envelope in ms (default 1,000). Must be finite and between 0 and 2^31 - 1. */
  initialReconnectDelayMs?: number;
  /** Full jitter by default; `none` preserves deterministic envelope delays. */
  reconnectJitter?: 'full' | 'none';
  /**
   * Trusted test seam: must not throw and must return a finite number in [0, 1).
   * May advance its own RNG state, but must not invoke socket lifecycle or backoff-policy methods.
   */
  reconnectRandom?: () => number;
}

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/** Create one policy per client. Reset only on open or explicit immediate recovery. */
export function createReconnectBackoff(options: ReconnectOptions = {}) {
  const initial = options.initialReconnectDelayMs ?? INITIAL_DELAY_MS;
  if (!Number.isFinite(initial) || initial < 0 || initial > MAX_TIMER_DELAY_MS) {
    throw new RangeError('initialReconnectDelayMs must be finite and between 0 and 2147483647');
  }
  const jitter = options.reconnectJitter ?? 'full';
  const random = options.reconnectRandom ?? (() => Math.random());
  let envelope = initial;

  return {
    nextDelayMs(): number {
      const delay = jitter === 'none' ? envelope : Math.floor(random() * envelope);
      // Preserve the existing initial override, including a first envelope above 30s.
      envelope = Math.min(envelope * 2, MAX_DELAY_MS);
      return delay;
    },
    reset(): void {
      envelope = initial;
    },
  };
}
