import type { ConnectEvent, WorkstationConnection } from './workstation-client.js';

/**
 * Render a connect event as a single structured log line, or `null` for
 * events that don't warrant one. Used by the headless daemon runtime — the
 * TUI has its own rich renderer (`ConnectApp`), but a service has only a log
 * file, so every line is timestamped and self-contained.
 *
 * Pure and injectable-clock for tests.
 */
export function formatConnectEvent(event: ConnectEvent, now: Date = new Date()): string | null {
  const ts = now.toISOString();
  switch (event.kind) {
    case 'status':
      if (event.status === 'registered') {
        return `${ts} registered as ${event.workstation?.name} (${event.workstation?.id})`;
      }
      return `${ts} ${event.status}${event.detail ? ` — ${event.detail}` : ''}`;
    case 'tool-start':
      return `${ts} → ${event.tool} ${event.summary}${event.agentId ? ` · ${event.agentId}` : ''}`;
    case 'tool': {
      const glyph =
        event.outcome === 'ok' ? 'ok' : event.outcome === 'denied' ? 'denied' : 'failed';
      return `${ts} ${glyph} ${event.tool} ${event.summary} (${event.durationMs}ms${
        event.agentId ? ` · ${event.agentId}` : ''
      })`;
    }
    case 'error':
      return `${ts} error: ${event.message}`;
    default:
      return null;
  }
}

export interface HeadlessConnectDeps {
  connection: Pick<WorkstationConnection, 'stop'>;
  registerListener: (listener: (event: ConnectEvent) => void) => () => void;
  /** Sink for log lines; defaults to stdout. Injectable for tests. */
  write?: (line: string) => void;
  /** Process handle for signal wiring; injectable for tests. */
  proc?: Pick<NodeJS.Process, 'once'>;
}

/**
 * Run connect mode without a UI: stream events to a log sink and keep the
 * process alive until SIGINT/SIGTERM, then stop the connection cleanly. This
 * is what the installed service invokes (`connect --headless`); launchd and
 * systemd capture the log sink to a file/journal and deliver the stop signal
 * on shutdown or `service uninstall`.
 *
 * Resolves once a termination signal has been handled, so the caller can let
 * the event loop drain and exit.
 */
export function runHeadlessConnect(deps: HeadlessConnectDeps): Promise<void> {
  const write = deps.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const proc = deps.proc ?? process;

  deps.registerListener((event) => {
    const line = formatConnectEvent(event);
    if (line) write(line);
  });

  return new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      write(`${new Date().toISOString()} received ${signal}, shutting down`);
      deps.connection.stop();
      resolve();
    };
    proc.once('SIGINT', () => shutdown('SIGINT'));
    proc.once('SIGTERM', () => shutdown('SIGTERM'));
  });
}
