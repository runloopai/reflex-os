import { describe, it, expect } from 'vitest';
import { CLAUDE_USER_CONFIG_PATH } from '@reflex/shared';
import {
  WORKSTATION_SHIM_MODE_ENV,
  WORKSTATION_SHIM_PATH,
  WORKSTATION_SHIM_SCRIPT,
  WORKSTATION_SHIM_SERVER_NAME,
  buildWorkstationShimProvisionParams,
  shimToolsForMode,
} from '../server/workstation-mcp-shim.js';

describe('shimToolsForMode', () => {
  it('read mode advertises only the observe-only tools', () => {
    expect(shimToolsForMode('read').sort()).toEqual(['list_directory', 'read_file']);
  });

  it('read-write mode advertises every tool', () => {
    expect(shimToolsForMode('read-write').sort()).toEqual([
      'list_directory',
      'read_file',
      'run_command',
      'write_file',
    ]);
  });
});

describe('WORKSTATION_SHIM_SCRIPT', () => {
  it('is a dependency-free node script that reads the mode + ipc env and posts to /tool', () => {
    // No MCP SDK / workspace imports — only node builtins.
    expect(WORKSTATION_SHIM_SCRIPT).toContain("from 'node:readline'");
    expect(WORKSTATION_SHIM_SCRIPT).toContain("from 'node:http'");
    expect(WORKSTATION_SHIM_SCRIPT).not.toMatch(/@reflex\//);
    expect(WORKSTATION_SHIM_SCRIPT).toContain(WORKSTATION_SHIM_MODE_ENV);
    expect(WORKSTATION_SHIM_SCRIPT).toContain("path: '/tool'");
    // Fully-qualified tool names pass through the relay unchanged.
    expect(WORKSTATION_SHIM_SCRIPT).toContain('workstation_run_command');
  });
});

describe('buildWorkstationShimProvisionParams', () => {
  it('mounts the shim and registers it as a stdio MCP server in the Claude config', () => {
    const params = buildWorkstationShimProvisionParams('read-write');
    expect(params.fileMounts?.[WORKSTATION_SHIM_PATH]).toBe(WORKSTATION_SHIM_SCRIPT);

    const once = params.onceLaunchCommands ?? [];
    expect(once).toHaveLength(1);
    const cmd = once[0]!.command;
    expect(cmd).toContain(CLAUDE_USER_CONFIG_PATH);
    expect(cmd).toContain('.mcpServers[$name]');
    expect(cmd).toContain(WORKSTATION_SHIM_SERVER_NAME);
    // The chosen mode is threaded to the shim so tools/list is mode-filtered.
    expect(cmd).toContain("--arg mode 'read-write'");
  });

  it('threads read-only mode into the shim env', () => {
    const cmd = buildWorkstationShimProvisionParams('read').onceLaunchCommands![0]!.command;
    expect(cmd).toContain("--arg mode 'read'");
  });
});
