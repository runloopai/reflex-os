/** The dispatch prompt: the player's suggestion plus the owner's optional note. */
import { describe, expect, it } from 'vitest';
import {
  buildGamePrompt,
  GAME_AGENT_SYSTEM_PROMPT,
  hostFixPrompt,
  suggestionPrompt,
} from '../server/reflex.ts';

describe('suggestionPrompt', () => {
  it('carries the owner note when one is set', () => {
    const prompt = suggestionPrompt('Fan one', 'add a boss fight', false, 'keep it beatable');
    expect(prompt).toContain('add a boss fight');
    expect(prompt).toContain('Note from the game owner: keep it beatable');
  });

  it('omits the note block when there is none', () => {
    const prompt = suggestionPrompt('Fan one', 'add a boss fight');
    expect(prompt).toContain('add a boss fight');
    expect(prompt).not.toContain('Note from the game owner');
  });
});

describe('hostFixPrompt', () => {
  it('names the broken URL and both vite settings', () => {
    const prompt = hostFixPrompt('https://5173-abc.tunnel.runloop.ai');
    expect(prompt).toContain('https://5173-abc.tunnel.runloop.ai');
    expect(prompt).toContain('allowedHosts: true');
    expect(prompt).toContain('host: "0.0.0.0"');
    expect(prompt).toContain('Restart the dev-server daemon');
  });
});

describe('GAME_AGENT_SYSTEM_PROMPT', () => {
  // The arcade puts the game on a phone screen inside its iframe, so a
  // keyboard-only game is one most players cannot play at all. These are
  // the rules the layout on our side assumes the game keeps.
  it('requires the game to be playable by touch', () => {
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/reachable by touch/i);
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/keyboard and mouse stay for desktop/i);
  });

  it('asks for a surface that resizes and stays sharp', () => {
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/orientationchange/);
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/devicePixelRatio/);
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/portrait and\s+landscape/i);
  });

  it('blocks the gestures that fight the player', () => {
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/touch-action: none/);
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/overscroll-behavior: contain/);
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/no hover-only/i);
  });

  it('names a phone viewport to check before ending a turn', () => {
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/390x660/);
  });
});

describe('buildGamePrompt', () => {
  it('asks for touch from the first build, not as a retrofit', () => {
    const prompt = buildGamePrompt('Neon Snake', 'a snake game');
    expect(prompt).toContain('Neon Snake');
    expect(prompt).toContain('a snake game');
    expect(prompt).toMatch(/playable with touch on a phone from the first build/i);
  });
});
