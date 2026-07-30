import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalToolExecutor, ToolRootError, resolveWithinRoot } from '../connect/executor.js';
import type {
  ListDirectoryResult,
  ReadFileResult,
  RunCommandResult,
  WriteFileResult,
} from '@reflex/plugin-workstation/shared/types';

let root: string;
let outside: string;
let executor: LocalToolExecutor;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'reflex-cli-root-'));
  outside = mkdtempSync(path.join(tmpdir(), 'reflex-cli-outside-'));
  executor = new LocalToolExecutor(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('resolveWithinRoot', () => {
  it('resolves relative paths inside the root', () => {
    expect(resolveWithinRoot(root, 'a/b.txt')).toBe(path.join(root, 'a/b.txt'));
    expect(resolveWithinRoot(root)).toBe(root);
  });

  it('rejects traversal and absolute escapes', () => {
    expect(() => resolveWithinRoot(root, '../etc/passwd')).toThrow(ToolRootError);
    expect(() => resolveWithinRoot(root, '/etc/passwd')).toThrow(ToolRootError);
    expect(() => resolveWithinRoot(root, 'a/../../b')).toThrow(ToolRootError);
  });

  it('rejects symlinks that point outside the root', () => {
    writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, path.join(root, 'link'));
    expect(() => resolveWithinRoot(root, 'link/secret.txt')).toThrow(ToolRootError);
  });
});

describe('LocalToolExecutor', () => {
  it('runs commands in the root and captures output', async () => {
    const result = (await executor.execute('run_command', {
      command: 'echo hello && pwd',
    })) as RunCommandResult;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello');
    expect(result.timedOut).toBe(false);
  });

  it('kills commands that outrun their timeout', async () => {
    const result = (await executor.execute('run_command', {
      command: 'sleep 5',
      timeoutMs: 200,
    })) as RunCommandResult;
    expect(result.timedOut).toBe(true);
  });

  it('kills a command when its call is aborted', async () => {
    const controller = new AbortController();
    const running = executor.execute(
      'run_command',
      { command: 'sleep 5', timeoutMs: 5_000 },
      controller.signal,
    );
    setTimeout(() => controller.abort(new Error('connection stopped')), 50);
    await expect(running).rejects.toThrow(/connection stopped/);
  });

  it('round-trips text files and reports binary as base64', async () => {
    const write = (await executor.execute('write_file', {
      path: 'notes/hello.txt',
      content: 'hi there',
    })) as WriteFileResult;
    expect(write.bytesWritten).toBe(8);

    const read = (await executor.execute('read_file', {
      path: 'notes/hello.txt',
    })) as ReadFileResult;
    expect(read.encoding).toBe('utf8');
    expect(read.content).toBe('hi there');
    expect(read.truncated).toBe(false);

    const binary = Buffer.from([0, 159, 146, 150, 255, 0, 1]);
    writeFileSync(path.join(root, 'blob.bin'), binary);
    const readBinary = (await executor.execute('read_file', {
      path: 'blob.bin',
    })) as ReadFileResult;
    expect(readBinary.encoding).toBe('base64');
    expect(Buffer.from(readBinary.content, 'base64')).toEqual(binary);
  });

  it('writes base64 payloads', async () => {
    // Invalid UTF-8 on purpose so the read-back reports base64.
    const bytes = Buffer.from([0xff, 0xfe, 1, 2]);
    await executor.execute('write_file', {
      path: 'bin/out.bin',
      content: bytes.toString('base64'),
      encoding: 'base64',
    });
    const read = (await executor.execute('read_file', { path: 'bin/out.bin' })) as ReadFileResult;
    expect(Buffer.from(read.content, 'base64')).toEqual(bytes);
  });

  it('lists directories with types, directories first', async () => {
    mkdirSync(path.join(root, 'sub'));
    writeFileSync(path.join(root, 'a.txt'), 'a');
    const result = (await executor.execute('list_directory', {})) as ListDirectoryResult;
    expect(result.entries.map((e) => `${e.type}:${e.name}`)).toEqual([
      'directory:sub',
      'file:a.txt',
    ]);
  });

  it('refuses tool calls that escape the root', async () => {
    await expect(executor.execute('read_file', { path: '../outside.txt' })).rejects.toThrow(
      ToolRootError,
    );
    await expect(
      executor.execute('write_file', { path: '/tmp/evil.txt', content: 'x' }),
    ).rejects.toThrow(ToolRootError);
    await expect(executor.execute('run_command', { command: 'pwd', cwd: '../..' })).rejects.toThrow(
      ToolRootError,
    );
  });

  it('rejects malformed params before touching the filesystem', async () => {
    await expect(executor.execute('read_file', { nope: true })).rejects.toThrow();
    await expect(executor.execute('run_command', { command: '' })).rejects.toThrow();
  });
});
