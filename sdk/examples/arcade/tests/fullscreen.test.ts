/**
 * The browser half of fullscreen mode.
 *
 * Every rule here exists because the Fullscreen API is not uniformly
 * available and not uniformly spelled: Safari keeps the `webkit` prefix,
 * iPhone Safari has no element fullscreen at all, and a request without a
 * user gesture rejects. A helper that assumed any of that away would leave a
 * dead button on the phones this app is most played on, or an unhandled
 * rejection where a fallback belongs.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  canFullscreen,
  enterFullscreen,
  fullscreenElement,
  isTypingTarget,
  leaveFullscreen,
} from '../web/src/lib/fullscreen.ts';

describe('fullscreenElement', () => {
  it('reads either spelling', () => {
    const element = {} as Element;
    expect(fullscreenElement({ fullscreenElement: element })).toBe(element);
    expect(fullscreenElement({ webkitFullscreenElement: element })).toBe(element);
  });

  it('is null when nothing is fullscreen', () => {
    expect(fullscreenElement({ fullscreenElement: null })).toBeNull();
    expect(fullscreenElement({})).toBeNull();
  });
});

describe('canFullscreen', () => {
  it('accepts either spelling', () => {
    expect(canFullscreen({ requestFullscreen: () => {} })).toBe(true);
    expect(canFullscreen({ webkitRequestFullscreen: () => {} })).toBe(true);
  });

  it('says no on iPhone Safari, which has no element fullscreen', () => {
    expect(canFullscreen({})).toBe(false);
    expect(canFullscreen(null)).toBe(false);
  });
});

describe('enterFullscreen', () => {
  it('reports success so the caller can stop there', async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    await expect(enterFullscreen({ requestFullscreen })).resolves.toBe(true);
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it('reports a refusal instead of rejecting', async () => {
    // What a request outside a user gesture, or under a permissions policy
    // that forbids fullscreen, actually does.
    const requestFullscreen = vi.fn(() => Promise.reject(new Error('not allowed')));
    await expect(enterFullscreen({ requestFullscreen })).resolves.toBe(false);
  });

  it('reports failure where the API does not exist', async () => {
    await expect(enterFullscreen({})).resolves.toBe(false);
    await expect(enterFullscreen(null)).resolves.toBe(false);
  });
});

describe('leaveFullscreen', () => {
  it('exits what is fullscreen', async () => {
    const exitFullscreen = vi.fn(() => Promise.resolve());
    await leaveFullscreen({ fullscreenElement: {} as Element, exitFullscreen });
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it('does nothing when nothing is fullscreen', async () => {
    // The CSS-only stage leaves through this same path, and calling
    // exitFullscreen with no fullscreen element rejects.
    const exitFullscreen = vi.fn(() => Promise.resolve());
    await leaveFullscreen({ fullscreenElement: null, exitFullscreen });
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it('swallows a rejection — the change event is the truth', async () => {
    const exitFullscreen = vi.fn(() => Promise.reject(new Error('already left')));
    await expect(
      leaveFullscreen({ fullscreenElement: {} as Element, exitFullscreen }),
    ).resolves.toBeUndefined();
  });
});

describe('isTypingTarget', () => {
  it('protects every text surface of the stream view', () => {
    // The room composer, the agent chat, the suggestion box: a bare `f`
    // shortcut must not eat the letter and throw the writer into fullscreen.
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('leaves the shortcut alone everywhere else', () => {
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isTypingTarget({ tagName: 'BUTTON', isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
