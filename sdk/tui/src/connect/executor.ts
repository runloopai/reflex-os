import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, open, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_READ_FILE_BYTES,
  MAX_COMMAND_OUTPUT_CHARS,
  MAX_READ_FILE_BYTES,
  WORKSTATION_TOOL_PARAM_SCHEMAS,
  type DirectoryEntry,
  type ListDirectoryParams,
  type ListDirectoryResult,
  type ReadFileParams,
  type ReadFileResult,
  type RunCommandParams,
  type RunCommandResult,
  type WorkstationToolName,
  type WriteFileParams,
  type WriteFileResult,
} from '@runloop/reflex-workstation';

/** Directory listings are for orientation, not bulk export. */
const MAX_DIRECTORY_ENTRIES = 500;

export class ToolRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolRootError';
  }
}

export interface ToolExecutor {
  execute(tool: WorkstationToolName, params: unknown, signal?: AbortSignal): Promise<unknown>;
}

/**
 * Resolve `target` against `root` and refuse anything that lands outside.
 * Two layers: lexical containment on the resolved path, then a symlink
 * check — the nearest existing ancestor of the target is realpath'd and
 * must still live inside the realpath'd root, so a symlink inside the root
 * cannot smuggle access out of it.
 */
export function resolveWithinRoot(root: string, target = '.'): string {
  const rootAbs = path.resolve(root);
  const resolved = path.resolve(rootAbs, target);
  assertLexicallyInside(rootAbs, resolved, target);

  const rootReal = safeRealpath(rootAbs) ?? rootAbs;
  let probe = resolved;
  for (;;) {
    const real = safeRealpath(probe);
    if (real !== null) {
      const realTarget = path.resolve(real, path.relative(probe, resolved) || '.');
      assertLexicallyInside(rootReal, realTarget, target);
      return resolved;
    }
    const parent = path.dirname(probe);
    if (parent === probe) return resolved;
    probe = parent;
  }
}

function assertLexicallyInside(root: string, candidate: string, original: string): void {
  const rel = path.relative(root, candidate);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return;
  throw new ToolRootError(`Path escapes the workstation root: ${original}`);
}

function safeRealpath(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Executes workstation tool calls against the local filesystem/shell,
 * confined to a root directory. Params are re-validated against the shared
 * schemas here — the client never trusts that the relay already did.
 */
export class LocalToolExecutor implements ToolExecutor {
  constructor(private readonly root: string) {}

  async execute(
    tool: WorkstationToolName,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    signal?.throwIfAborted();
    switch (tool) {
      case 'run_command':
        return this.runCommand(WORKSTATION_TOOL_PARAM_SCHEMAS.run_command.parse(params), signal);
      case 'read_file':
        return this.readFile(WORKSTATION_TOOL_PARAM_SCHEMAS.read_file.parse(params));
      case 'write_file':
        return this.writeFile(WORKSTATION_TOOL_PARAM_SCHEMAS.write_file.parse(params));
      case 'list_directory':
        return this.listDirectory(WORKSTATION_TOOL_PARAM_SCHEMAS.list_directory.parse(params));
      default: {
        const exhaustive: never = tool;
        throw new Error(`Unknown tool: ${String(exhaustive)}`);
      }
    }
  }

  private runCommand(params: RunCommandParams, signal?: AbortSignal): Promise<RunCommandResult> {
    const cwd = resolveWithinRoot(this.root, params.cwd);
    const timeoutMs = params.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      // `detached` puts the shell in its own process group so the timeout
      // can kill the whole tree — killing just the shell leaves grandchildren
      // (e.g. `sleep`) holding the stdio pipes and `close` never fires.
      const child = spawn(params.command, { shell: true, cwd, env: process.env, detached: true });
      const killTree = () => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      };
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;

      const remaining = () => MAX_COMMAND_OUTPUT_CHARS - stdout.length - stderr.length;
      const append = (current: string, chunk: Buffer): string => {
        const budget = remaining();
        if (budget <= 0) {
          truncated = true;
          return current;
        }
        const text = chunk.toString('utf8');
        if (text.length > budget) truncated = true;
        return current + text.slice(0, budget);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeoutMs);
      const abort = () => killTree();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();

      child.stdout.on('data', (chunk: Buffer) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = append(stderr, chunk);
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve({
          stdout,
          stderr: stderr ? `${stderr}\n${err.message}` : err.message,
          exitCode: null,
          durationMs: Date.now() - startedAt,
          truncated,
          timedOut,
        });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (signal?.aborted) {
          reject(signal.reason ?? new Error('Workstation call cancelled'));
          return;
        }
        resolve({
          stdout,
          stderr,
          exitCode: code,
          durationMs: Date.now() - startedAt,
          truncated,
          timedOut,
        });
      });
    });
  }

  private async readFile(params: ReadFileParams): Promise<ReadFileResult> {
    const abs = resolveWithinRoot(this.root, params.path);

    // Open first, then stat the handle: checking and reading through the same
    // file descriptor closes the TOCTOU gap a path-based stat() would leave.
    const handle = await open(abs, 'r');
    let bytes: Buffer;
    let info: Awaited<ReturnType<typeof handle.stat>>;
    try {
      info = await handle.stat();
      if (!info.isFile()) throw new Error(`Not a file: ${params.path}`);
      const limit = Math.min(params.maxBytes ?? DEFAULT_READ_FILE_BYTES, MAX_READ_FILE_BYTES);
      const length = Math.min(info.size, limit);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      bytes = buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }

    let encoding: 'utf8' | 'base64';
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      encoding = 'utf8';
    } catch {
      content = bytes.toString('base64');
      encoding = 'base64';
    }
    return {
      path: params.path,
      encoding,
      content,
      size: info.size,
      truncated: bytes.length < info.size,
    };
  }

  private async writeFile(params: WriteFileParams): Promise<WriteFileResult> {
    const abs = resolveWithinRoot(this.root, params.path);
    const bytes =
      params.encoding === 'base64'
        ? Buffer.from(params.content, 'base64')
        : Buffer.from(params.content, 'utf8');
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    return { path: params.path, bytesWritten: bytes.length };
  }

  private async listDirectory(params: ListDirectoryParams): Promise<ListDirectoryResult> {
    const abs = resolveWithinRoot(this.root, params.path);
    const names = await readdir(abs, { withFileTypes: true });
    const entries: DirectoryEntry[] = [];
    for (const dirent of names.slice(0, MAX_DIRECTORY_ENTRIES)) {
      const type = dirent.isSymbolicLink()
        ? 'symlink'
        : dirent.isDirectory()
          ? 'directory'
          : dirent.isFile()
            ? 'file'
            : 'other';
      let size: number | undefined;
      let modifiedAt: number | undefined;
      try {
        const info = await lstat(path.join(abs, dirent.name));
        size = type === 'file' ? info.size : undefined;
        modifiedAt = info.mtimeMs;
      } catch {
        // Entry vanished between readdir and lstat — report name/type only.
      }
      entries.push({ name: dirent.name, type, size, modifiedAt });
    }
    entries.sort(
      (a, b) =>
        Number(a.type !== 'directory') - Number(b.type !== 'directory') ||
        a.name.localeCompare(b.name),
    );
    return { path: params.path ?? '.', entries };
  }
}
