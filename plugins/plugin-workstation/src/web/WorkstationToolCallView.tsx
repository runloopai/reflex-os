import type { ElementType } from 'react';
import {
  CircleAlert,
  File,
  FileSymlink,
  Folder,
  HardDrive,
  Loader2,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';
import type { PluginAgentRef, ToolCallRendererProps } from '@reflex/plugin-api';
import { cn } from '@reflex/ui/lib/utils';
import { AnsiText } from '@reflex/ui/components/content/AnsiText';
import { CopyButton } from '@reflex/ui/components/shared/CopyButton';
import { useAgent } from '@reflex/ui/client/hooks';
import { formatBytes } from '@reflex/ui/lib/format';
import {
  RunCommandResultSchema,
  ReadFileResultSchema,
  WriteFileResultSchema,
  ListDirectoryResultSchema,
  type DirectoryEntry,
  type ListDirectoryResult,
  type ReadFileResult,
  type RunCommandResult,
  type WriteFileResult,
} from '@runloop/reflex-workstation';
import { getAgentWorkstation } from './agent-workstation.js';
import { WorkstationChip } from './WorkstationChip.js';

/**
 * Chat renderer for `workstation_*` tool calls (registered through the
 * `toolCallRenderers` extension point). One component covers all four tools —
 * it switches on the normalized `toolName` — so the manifest points every
 * entry at the same lazy chunk.
 *
 * The payload is the workstation registry result JSON-serialized into the
 * tool result's text by the on-box MCP shim; every branch parses it with the
 * shared Zod schema and falls back to the raw text when the shape is
 * unexpected, so a protocol drift degrades to the old raw view instead of a
 * crash.
 */
export function WorkstationToolCallView({
  toolName,
  status,
  input,
  outputText,
  agentId,
}: ToolCallRendererProps) {
  return (
    <div className="space-y-1.5">
      <WorkstationToolCallBody
        toolName={toolName}
        status={status}
        input={input}
        outputText={outputText}
      />
      {agentId ? <WorkstationSourceRow agentId={agentId} /> : null}
    </div>
  );
}

function WorkstationToolCallBody({
  toolName,
  status,
  input,
  outputText,
}: Omit<ToolCallRendererProps, 'agentId'>) {
  if (status === 'pending' || status === 'in_progress') {
    return <WaitingView toolName={toolName} />;
  }
  if (status === 'cancelled') {
    return <NoteView icon={CircleAlert} text="Interrupted before the workstation responded." />;
  }
  if (status === 'failed') {
    return <WorkstationErrorView message={outputText ?? 'The workstation call failed.'} />;
  }

  const result = parseJsonRecord(outputText);
  switch (toolName) {
    case 'workstation_run_command': {
      const parsed = RunCommandResultSchema.safeParse(result);
      if (parsed.success) return <RunCommandView input={input} result={parsed.data} />;
      break;
    }
    case 'workstation_read_file': {
      const parsed = ReadFileResultSchema.safeParse(result);
      if (parsed.success) return <ReadFileView result={parsed.data} />;
      break;
    }
    case 'workstation_write_file': {
      const parsed = WriteFileResultSchema.safeParse(result);
      if (parsed.success) return <WriteFileView result={parsed.data} />;
      break;
    }
    case 'workstation_list_directory': {
      const parsed = ListDirectoryResultSchema.safeParse(result);
      if (parsed.success) return <ListDirectoryView result={parsed.data} />;
      break;
    }
  }
  return <RawFallbackView text={outputText} />;
}

/**
 * "on <workstation>" attribution under every workstation tool call. The chip
 * carries the same hover popover as the agent-header badge (mode, host, tool
 * root, presence), so the answer to "which machine did this run on?" is one
 * hover away from the output itself. Resolved from the agent's Connect
 * attachment; renders nothing while the agent loads or when it has no
 * workstation attached.
 */
function WorkstationSourceRow({ agentId }: { agentId: string }) {
  const { data: agent } = useAgent(agentId);
  const config = agent ? getAgentWorkstation(agent as unknown as PluginAgentRef) : null;
  if (!config) return null;
  return (
    <div
      data-testid="workstation-tool-call-source"
      className="flex items-center gap-1.5 text-2xs text-muted-foreground/70"
    >
      <span>on</span>
      <WorkstationChip config={config} data-testid="workstation-tool-call-chip" />
    </div>
  );
}

export default WorkstationToolCallView;

function parseJsonRecord(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// --- Waiting / error states ---

/**
 * Exec and write calls block on the owner's y/a/n approval in the TUI unless
 * they launched with `--allow-exec` / `--allow-write` — say so, because "the
 * spinner just sits there" was exactly the confusion this view replaces.
 */
const APPROVAL_GATED_TOOLS = new Set(['workstation_run_command', 'workstation_write_file']);

function WaitingView({ toolName }: { toolName: string }) {
  const approvalGated = APPROVAL_GATED_TOOLS.has(toolName);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/20 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-status-info/70" />
      <span>
        Waiting for the workstation…
        {approvalGated && ' The machine’s owner may need to approve this call in their TUI.'}
      </span>
    </div>
  );
}

interface ErrorPresentation {
  icon: ElementType;
  title: string;
  hint?: string;
}

/** Map the relay's structured error prefixes to human explanations. */
function presentError(message: string): ErrorPresentation {
  if (message.includes('workstation_offline')) {
    return {
      icon: WifiOff,
      title: 'Workstation offline',
      hint: 'The machine is not connected. Start `reflex-cli connect` on it and retry.',
    };
  }
  if (message.includes('workstation_read_only')) {
    return {
      icon: ShieldAlert,
      title: 'Blocked by read-only access',
      hint: 'This workstation was attached with read-only access, so commands and writes are not permitted.',
    };
  }
  if (message.toLowerCase().includes('denied')) {
    return {
      icon: ShieldAlert,
      title: 'Denied by the workstation owner',
      hint: 'The owner declined this call in their TUI.',
    };
  }
  return { icon: CircleAlert, title: 'Workstation call failed' };
}

function WorkstationErrorView({ message }: { message: string }) {
  const { icon: Icon, title, hint } = presentError(message);
  return (
    <div className="rounded-lg border border-status-error/20 bg-status-error/5 px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-medium text-status-error">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {title}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <pre className="mt-1.5 max-h-32 overflow-auto font-mono text-2xs whitespace-pre-wrap text-status-error/70">
        {message}
      </pre>
    </div>
  );
}

function NoteView({ icon: Icon, text }: { icon: ElementType; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/20 bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {text}
    </div>
  );
}

// --- run_command ---

/** "187ms" under a second, then the shared precise formatter ("3.42s", "2m 5s"). */
function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function RunCommandView({
  input,
  result,
}: {
  input: Record<string, unknown> | null;
  result: RunCommandResult;
}) {
  const command = typeof input?.command === 'string' ? input.command : undefined;
  const cwd = typeof input?.cwd === 'string' ? input.cwd : undefined;
  const exitOk = result.exitCode === 0;
  const hasStdout = result.stdout.trim().length > 0;
  const hasStderr = result.stderr.trim().length > 0;

  return (
    <div
      data-testid="workstation-run-command"
      className="overflow-hidden rounded-lg border border-border/30 bg-muted/15 font-mono text-xs"
    >
      {command && (
        <div className="flex items-start gap-2 border-b border-border/20 bg-muted/25 px-3 py-2">
          <span className="select-none text-muted-foreground/50">$</span>
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-foreground/80">
            {command}
          </code>
          <CopyButton text={command} ariaLabel="Copy command" />
        </div>
      )}
      {hasStdout && (
        <pre className="max-h-64 overflow-auto px-3 py-2 whitespace-pre-wrap leading-relaxed text-foreground/70">
          <AnsiText text={result.stdout} />
        </pre>
      )}
      {hasStderr && (
        <div className={cn(hasStdout && 'border-t border-border/20')}>
          <div className="px-3 pt-2 text-2xs font-medium uppercase tracking-wide text-status-error/70">
            stderr
          </div>
          <pre className="max-h-40 overflow-auto px-3 pb-2 pt-1 whitespace-pre-wrap leading-relaxed text-status-error/80">
            <AnsiText text={result.stderr} />
          </pre>
        </div>
      )}
      {!hasStdout && !hasStderr && (
        <div className="px-3 py-2 italic text-muted-foreground/50">no output</div>
      )}
      <div className="flex items-center gap-3 border-t border-border/20 bg-muted/25 px-3 py-1.5 font-sans text-2xs text-muted-foreground">
        <span
          className={cn(
            'flex items-center gap-1 font-medium',
            exitOk ? 'text-status-success' : 'text-status-error',
          )}
        >
          {result.exitCode === null ? 'killed' : `exit ${result.exitCode}`}
        </span>
        <span>{formatMs(result.durationMs)}</span>
        {cwd && <span className="truncate">in {cwd}</span>}
        {result.timedOut && <span className="text-status-error">timed out</span>}
        {result.truncated && <span>output truncated</span>}
        {(hasStdout || hasStderr) && (
          <span className="ml-auto">
            <CopyButton
              text={[result.stdout, result.stderr].filter(Boolean).join('\n')}
              ariaLabel="Copy output"
            />
          </span>
        )}
      </div>
    </div>
  );
}

// --- read_file ---

function ReadFileView({ result }: { result: ReadFileResult }) {
  const isBinary = result.encoding === 'base64';
  return (
    <div
      data-testid="workstation-read-file"
      className="overflow-hidden rounded-lg border border-border/30 bg-muted/15"
    >
      <div className="flex items-center gap-2 border-b border-border/20 bg-muted/25 px-3 py-1.5 text-xs">
        <File className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <code className="min-w-0 flex-1 truncate font-mono text-foreground/80">{result.path}</code>
        <span className="shrink-0 text-2xs text-muted-foreground">{formatBytes(result.size)}</span>
        {result.truncated && (
          <span className="shrink-0 text-2xs text-muted-foreground">truncated</span>
        )}
        {!isBinary && <CopyButton text={result.content} ariaLabel="Copy file content" />}
      </div>
      {isBinary ? (
        <div className="px-3 py-2 text-xs italic text-muted-foreground/60">
          Binary file — content not shown.
        </div>
      ) : (
        <pre className="max-h-64 overflow-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap leading-relaxed text-foreground/70">
          {result.content}
        </pre>
      )}
    </div>
  );
}

// --- write_file ---

function WriteFileView({ result }: { result: WriteFileResult }) {
  return (
    <div
      data-testid="workstation-write-file"
      className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/15 px-3 py-2 text-xs"
    >
      <File className="h-3.5 w-3.5 shrink-0 text-status-success/70" />
      <code className="min-w-0 flex-1 truncate font-mono text-foreground/80">{result.path}</code>
      <span className="shrink-0 text-muted-foreground">
        {formatBytes(result.bytesWritten)} written
      </span>
    </div>
  );
}

// --- list_directory ---

const ENTRY_ICONS: Record<DirectoryEntry['type'], ElementType> = {
  directory: Folder,
  file: File,
  symlink: FileSymlink,
  other: HardDrive,
};

/** Directories first, then files, each group alphabetical — the ls -la instinct. */
function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.type === 'directory' ? 0 : 1;
    const bDir = b.type === 'directory' ? 0 : 1;
    return aDir - bDir || a.name.localeCompare(b.name);
  });
}

function ListDirectoryView({ result }: { result: ListDirectoryResult }) {
  const entries = sortEntries(result.entries);
  return (
    <div
      data-testid="workstation-list-directory"
      className="overflow-hidden rounded-lg border border-border/30 bg-muted/15"
    >
      <div className="flex items-center gap-2 border-b border-border/20 bg-muted/25 px-3 py-1.5 text-xs">
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        <code className="min-w-0 flex-1 truncate font-mono text-foreground/80">{result.path}</code>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="px-3 py-2 text-xs italic text-muted-foreground/60">Empty directory.</div>
      ) : (
        <ul className="max-h-64 overflow-auto py-1">
          {entries.map((entry) => {
            const Icon = ENTRY_ICONS[entry.type];
            return (
              <li
                key={entry.name}
                className="flex items-center gap-2 px-3 py-0.5 text-xs text-foreground/70"
              >
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 shrink-0',
                    entry.type === 'directory'
                      ? 'text-status-accent-indigo/70'
                      : 'text-muted-foreground/50',
                  )}
                />
                <span className="min-w-0 flex-1 truncate font-mono">{entry.name}</span>
                {entry.size !== undefined && entry.type !== 'directory' && (
                  <span className="shrink-0 text-2xs text-muted-foreground/60">
                    {formatBytes(entry.size)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// --- fallback ---

function RawFallbackView({ text }: { text: string | null }) {
  if (!text) {
    return <NoteView icon={CircleAlert} text="The workstation returned no output." />;
  }
  return (
    <pre className="max-h-64 overflow-auto rounded-lg border border-border/20 bg-muted/10 p-3 font-mono text-xs whitespace-pre-wrap leading-relaxed text-foreground/60">
      {text}
    </pre>
  );
}
