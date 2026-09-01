/** The dispatch prompt: the player's suggestion plus the owner's optional note. */
import { describe, expect, it } from 'vitest';
import {
  buildGamePrompt,
  briefUpdatePrompt,
  GAME_AGENT_SYSTEM_PROMPT,
  hostFixPrompt,
  suggestionPrompt,
} from '../server/reflex.ts';
import { PLAYER_PARAMS } from '../web/src/lib/game-frame.ts';

describe('suggestionPrompt', () => {
  it('carries the owner note when one is set', () => {
    const prompt = suggestionPrompt('Fan one', 'add a boss fight', {
      ownerNote: 'keep it beatable',
    });
    expect(prompt).toContain('add a boss fight');
    expect(prompt).toContain('Note from the game owner: keep it beatable');
  });

  it('omits the note block when there is none', () => {
    const prompt = suggestionPrompt('Fan one', 'add a boss fight');
    expect(prompt).toContain('add a boss fight');
    expect(prompt).not.toContain('Note from the game owner');
  });

  // The rules an agent got at launch are frozen there, so a game older than
  // the current brief is told the difference on its next turn — and only
  // then, since the appendix has nothing to re-check.
  it('appends the catch-up brief only when the game is behind', () => {
    const behind = suggestionPrompt('Fan one', 'add a boss fight', { needsBrief: true });
    expect(behind).toContain('Arcade update');
    expect(behind).toContain(PLAYER_PARAMS.name);
    expect(suggestionPrompt('Fan one', 'add a boss fight')).not.toContain('Arcade update');
  });

  // The suggestion card in the transcript parses this prompt (see
  // `game-timeline.ts`), and every appendix lands after the part it reads.
  it('keeps the suggestion header ahead of every appendix', () => {
    const prompt = suggestionPrompt('Fan one', 'add a boss fight', {
      needsArt: true,
      needsBrief: true,
      ownerNote: 'keep it beatable',
    });
    expect(prompt.indexOf('Implement this suggestion now')).toBeLessThan(
      prompt.indexOf('Housekeeping for this game'),
    );
    expect(prompt.indexOf('Housekeeping for this game')).toBeLessThan(
      prompt.indexOf('Arcade update'),
    );
  });
});

describe('briefUpdatePrompt', () => {
  // Everything the arcade side depends on: the parameter names the frame
  // URL actually carries, and the loading screen that replaces the template.
  it('names every player parameter the arcade sends', () => {
    const prompt = briefUpdatePrompt();
    for (const param of Object.values(PLAYER_PARAMS)) expect(prompt).toContain(param);
  });

  it('asks for a loading screen in index.html', () => {
    expect(briefUpdatePrompt()).toMatch(/loading screen/i);
    expect(briefUpdatePrompt()).toContain('index.html');
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

  // Players arrive while the agent is still scaffolding, so the first thing
  // index.html can show is never the Vite template page.
  it('rules out the template page and asks for a loading screen', () => {
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/Vite \+ TypeScript/);
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/loading screen/i);
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/removes it when it is ready/i);
  });

  // The contract with `web/src/lib/game-frame.ts`: same parameter names on
  // both sides, or the game asks for a name the arcade already sent.
  it('documents the player parameters the frame URL carries', () => {
    for (const param of Object.values(PLAYER_PARAMS)) {
      expect(GAME_AGENT_SYSTEM_PROMPT).toContain(param);
    }
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/never ask them to type a name/i);
    expect(GAME_AGENT_SYSTEM_PROMPT).toMatch(/display data, NOT a credential/);
  });
});

describe('buildGamePrompt', () => {
  it('asks for touch from the first build, not as a retrofit', () => {
    const prompt = buildGamePrompt('Neon Snake', 'a snake game');
    expect(prompt).toContain('Neon Snake');
    expect(prompt).toContain('a snake game');
    expect(prompt).toMatch(/playable with touch on a phone from the first build/i);
  });

  it('asks for the loading screen and the player parameters up front', () => {
    const prompt = buildGamePrompt('Neon Snake', 'a snake game');
    expect(prompt).toMatch(/loading screen/i);
    expect(prompt).toContain(PLAYER_PARAMS.name);
  });
});
