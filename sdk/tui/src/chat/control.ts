import type { AskUserQuestionItem } from '@reflex/shared';

/**
 * Claude `control_response` payload builders, ported verbatim from the web
 * chat (`plugin-chat` `TurnBlockRenderers`) so the TUI answers questions and
 * permission requests with byte-identical payloads. All of these are POSTed
 * through `sendAgentControlResponse` as `{ payload }`.
 */

export interface ControlRequestRef {
  requestId: string;
  toolUseId: string | null;
}

/** Answers keyed by question text; multi-select labels joined with ", ". */
export function buildAskUserControlResponse(
  ref: ControlRequestRef,
  questions: AskUserQuestionItem[],
  answers: Record<string, string>,
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    behavior: 'allow',
    updatedInput: { questions, answers },
  };
  if (ref.toolUseId) response.toolUseID = ref.toolUseId;
  return {
    type: 'control_response',
    response: { subtype: 'success', request_id: ref.requestId, response },
  };
}

/**
 * Decline an AskUserQuestion. Without `interrupt` the model learns the user
 * passed and continues the turn (skip); with it the turn is aborted (dismiss).
 */
export function buildAskUserDenyResponse(
  ref: ControlRequestRef,
  message: string,
  interrupt?: boolean,
): Record<string, unknown> {
  const response: Record<string, unknown> = { behavior: 'deny', message };
  if (ref.toolUseId) response.toolUseID = ref.toolUseId;
  if (interrupt) response.interrupt = true;
  return {
    type: 'control_response',
    response: { subtype: 'success', request_id: ref.requestId, response },
  };
}

/** Approve a `can_use_tool` permission request, optionally for the whole session. */
export function buildPermissionAllowResponse(
  ref: ControlRequestRef,
  toolInput: Record<string, unknown> | null,
  options: { alwaysAllowTool?: string | null } = {},
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    behavior: 'allow',
    updatedInput: toolInput ?? {},
  };
  if (ref.toolUseId) response.toolUseID = ref.toolUseId;
  if (options.alwaysAllowTool) {
    response.updatedPermissions = [
      {
        type: 'addRules',
        rules: [{ toolName: options.alwaysAllowTool }],
        behavior: 'allow',
        destination: 'session',
      },
    ];
  }
  return {
    type: 'control_response',
    response: { subtype: 'success', request_id: ref.requestId, response },
  };
}

/** Deny a `can_use_tool` permission request, optionally interrupting the turn. */
export function buildPermissionDenyResponse(
  ref: ControlRequestRef,
  interrupt = false,
): Record<string, unknown> {
  const response: Record<string, unknown> = {
    behavior: 'deny',
    message: 'User denied the request',
  };
  if (ref.toolUseId) response.toolUseID = ref.toolUseId;
  if (interrupt) response.interrupt = true;
  return {
    type: 'control_response',
    response: { subtype: 'success', request_id: ref.requestId, response },
  };
}
