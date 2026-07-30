import { describe, expect, it } from 'vitest';
import {
  buildAskUserControlResponse,
  buildAskUserDenyResponse,
  buildPermissionAllowResponse,
  buildPermissionDenyResponse,
} from '../chat/control.js';

const ref = { requestId: 'req_1', toolUseId: 'tu_1' };
const questions = [
  { question: 'Which one?', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] },
];

describe('control response builders', () => {
  it('builds the AskUserQuestion answer payload the web chat sends', () => {
    expect(buildAskUserControlResponse(ref, questions, { 'Which one?': 'A' })).toEqual({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'req_1',
        response: {
          behavior: 'allow',
          updatedInput: { questions, answers: { 'Which one?': 'A' } },
          toolUseID: 'tu_1',
        },
      },
    });
  });

  it('omits toolUseID when the request has none', () => {
    const payload = buildAskUserControlResponse(
      { requestId: 'req_2', toolUseId: null },
      questions,
      {},
    );
    const response = (payload.response as { response: Record<string, unknown> }).response;
    expect('toolUseID' in response).toBe(false);
  });

  it('builds skip (deny) and dismiss (deny + interrupt) payloads', () => {
    const skip = buildAskUserDenyResponse(ref, 'skipped');
    const dismiss = buildAskUserDenyResponse(ref, 'dismissed', true);
    expect(skip.response).toMatchObject({
      response: { behavior: 'deny', message: 'skipped' },
    });
    expect((skip.response as { response: Record<string, unknown> }).response.interrupt).toBe(
      undefined,
    );
    expect((dismiss.response as { response: Record<string, unknown> }).response.interrupt).toBe(
      true,
    );
  });

  it('builds permission allow payloads, with session-wide rules when requested', () => {
    const once = buildPermissionAllowResponse(ref, { command: 'ls' });
    expect(once.response).toMatchObject({
      response: { behavior: 'allow', updatedInput: { command: 'ls' } },
    });

    const always = buildPermissionAllowResponse(ref, null, { alwaysAllowTool: 'Bash' });
    expect((always.response as { response: Record<string, unknown> }).response).toMatchObject({
      updatedInput: {},
      updatedPermissions: [
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash' }],
          behavior: 'allow',
          destination: 'session',
        },
      ],
    });
  });

  it('builds permission deny payloads with optional interrupt', () => {
    const deny = buildPermissionDenyResponse(ref);
    expect(deny.response).toMatchObject({
      response: { behavior: 'deny', message: 'User denied the request' },
    });
    const interrupt = buildPermissionDenyResponse(ref, true);
    expect((interrupt.response as { response: Record<string, unknown> }).response.interrupt).toBe(
      true,
    );
  });
});
