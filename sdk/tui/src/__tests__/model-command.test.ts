import { describe, expect, it } from 'vitest';
import { isModelSwitchCommand } from '../chat/model-command.js';

describe('isModelSwitchCommand', () => {
  it('reads /model with anything after it as a switch', () => {
    expect(isModelSwitchCommand('/model claude-opus-5-5')).toBe(true);
    expect(isModelSwitchCommand('  /Model  opus ')).toBe(true);
    // Extra words are the server's to refuse, not a prompt.
    expect(isModelSwitchCommand('/model opus please')).toBe(true);
  });

  it('leaves a bare /model and ordinary text to the harness', () => {
    expect(isModelSwitchCommand('/model')).toBe(false);
    expect(isModelSwitchCommand('/models are neat')).toBe(false);
    expect(isModelSwitchCommand('switch to /model opus')).toBe(false);
  });
});
