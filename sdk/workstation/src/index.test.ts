import { describe, it, expect } from 'vitest';

import {
  WORKSTATION_PROTOCOL_VERSION,
  WORKSTATION_READ_ONLY_TOOLS,
  WORKSTATION_TOOL_PARAM_SCHEMAS,
  WorkstationClientMessageSchema,
  WorkstationServerMessageSchema,
  WorkstationToolNameSchema,
  isWorkstationToolAllowed,
  workstationToolsForMode,
} from './index.js';

/**
 * This package is a wire contract, so these tests cover what a third-party
 * client can rely on: every declared tool has a parameter schema, both message
 * unions reject frames they do not recognise, and read access really does
 * withhold the mutating tools.
 */

describe('tool declarations', () => {
  it('gives every tool name a parameter schema', () => {
    for (const tool of WorkstationToolNameSchema.options) {
      expect(WORKSTATION_TOOL_PARAM_SCHEMAS[tool], `missing schema for ${tool}`).toBeDefined();
    }
  });

  it('declares no parameter schema for a tool that does not exist', () => {
    const declared = new Set<string>(WorkstationToolNameSchema.options);
    for (const tool of Object.keys(WORKSTATION_TOOL_PARAM_SCHEMAS)) {
      expect(declared.has(tool), `${tool} has a schema but is not a tool name`).toBe(true);
    }
  });
});

describe('access modes', () => {
  it('withholds every mutating tool in read mode', () => {
    expect(workstationToolsForMode('read')).toEqual([...WORKSTATION_READ_ONLY_TOOLS]);

    for (const tool of WorkstationToolNameSchema.options) {
      const readOnly = (WORKSTATION_READ_ONLY_TOOLS as readonly string[]).includes(tool);
      expect(isWorkstationToolAllowed(tool, 'read'), tool).toBe(readOnly);
    }
  });

  it('allows every tool in read-write mode', () => {
    for (const tool of WorkstationToolNameSchema.options) {
      expect(isWorkstationToolAllowed(tool, 'read-write'), tool).toBe(true);
    }
  });
});

describe('message unions', () => {
  it('parses a tool result from a client', () => {
    const parsed = WorkstationClientMessageSchema.safeParse({
      v: WORKSTATION_PROTOCOL_VERSION,
      type: 'tool.result',
      id: 'call-1',
      ok: true,
      result: {
        stdout: 'hi',
        stderr: '',
        exitCode: 0,
        durationMs: 4,
        truncated: false,
        timedOut: false,
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('parses a tool call from the server', () => {
    const parsed = WorkstationServerMessageSchema.safeParse({
      v: WORKSTATION_PROTOCOL_VERSION,
      type: 'tool.call',
      id: 'call-1',
      tool: 'run_command',
      params: { command: 'echo hi' },
    });

    expect(parsed.success).toBe(true);
  });

  // A client that trusts unknown frames breaks the moment the server learns a
  // new message type, so both directions reject what they do not know.
  it('rejects an unknown message type in either direction', () => {
    const unknown = { v: WORKSTATION_PROTOCOL_VERSION, type: 'nope', id: 'x' };

    expect(WorkstationClientMessageSchema.safeParse(unknown).success).toBe(false);
    expect(WorkstationServerMessageSchema.safeParse(unknown).success).toBe(false);
  });

  it('rejects a tool call naming a tool that does not exist', () => {
    const parsed = WorkstationServerMessageSchema.safeParse({
      v: WORKSTATION_PROTOCOL_VERSION,
      type: 'tool.call',
      id: 'call-1',
      tool: 'rm_rf',
      params: {},
    });

    expect(parsed.success).toBe(false);
  });

  // The version is on every frame so a client can refuse a server speaking a
  // protocol it was not built against, rather than misreading the payload.
  it('rejects a frame carrying a different protocol version', () => {
    const parsed = WorkstationServerMessageSchema.safeParse({
      v: WORKSTATION_PROTOCOL_VERSION + 1,
      type: 'tool.call',
      id: 'call-1',
      tool: 'run_command',
      params: { command: 'echo hi' },
    });

    expect(parsed.success).toBe(false);
  });
});
