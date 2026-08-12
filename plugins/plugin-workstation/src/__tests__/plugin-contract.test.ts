import { describe, it, expect } from 'vitest';
import { getPluginReleaseStatus } from '@reflex/plugin-api';
import { describePluginContract } from '@reflex/plugin-api/test';
import { workstationPlugin } from '../index.js';
import webRegistration from '../web/register.js';

describePluginContract(workstationPlugin, { webRegistration });

describe('workstationPlugin visibility', () => {
  it('ships on the alpha channel', () => {
    expect(getPluginReleaseStatus(workstationPlugin)).toBe('alpha');
  });
});
