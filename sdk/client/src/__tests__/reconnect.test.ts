import { describe, expect, it, vi } from 'vitest';
import { createReconnectBackoff } from '../reconnect.js';

describe('reconnect policy', () => {
  it('samples each envelope independently through the cap and resets on open', () => {
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.75).mockReturnValue(0.5);
    const policy = createReconnectBackoff({ reconnectRandom: random });
    expect(random).not.toHaveBeenCalled();
    expect(Array.from({ length: 8 }, () => policy.nextDelayMs())).toEqual([
      0, 1500, 2000, 4000, 8000, 15000, 15000, 15000,
    ]);
    policy.reset();
    expect(random).toHaveBeenCalledTimes(8);
    expect(policy.nextDelayMs()).toBe(500);
    expect(createReconnectBackoff({ reconnectRandom: () => 0.999999 }).nextDelayMs()).toBe(999);
  });

  it('keeps clients independent and uses fresh default randomness per attempt', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);
    try {
      const a = createReconnectBackoff();
      const b = createReconnectBackoff();
      expect(a.nextDelayMs()).toBe(100);
      expect(b.nextDelayMs()).toBe(900);
      expect(random).toHaveBeenCalledTimes(2);
    } finally {
      random.mockRestore();
    }
  });

  it('preserves exact no-jitter delays without consuming randomness', () => {
    const random = vi.fn();
    const policy = createReconnectBackoff({ reconnectJitter: 'none', reconnectRandom: random });
    expect(Array.from({ length: 8 }, () => policy.nextDelayMs())).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    expect(random).not.toHaveBeenCalled();
  });

  it.each([0, 250, 60_000, 2 ** 31 - 1])(
    'preserves the timer-safe initial override %s',
    (initial) => {
      const policy = createReconnectBackoff({
        initialReconnectDelayMs: initial,
        reconnectJitter: 'none',
      });
      expect(policy.nextDelayMs()).toBe(initial);
      expect(policy.nextDelayMs()).toBe(Math.min(initial * 2, 30_000));
      policy.reset();
      expect(policy.nextDelayMs()).toBe(initial);
    },
  );

  it.each([-1, NaN, Infinity, 2 ** 31])(
    'rejects unsafe initial delay %s at construction',
    (initial) => {
      expect(() => createReconnectBackoff({ initialReconnectDelayMs: initial })).toThrow(
        RangeError,
      );
    },
  );
});
