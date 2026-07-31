import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useState } from 'react';
import type { Workstation } from '@runloop/reflex-workstation';
import type { ConnectEvent, WorkstationConnection } from '../connect/workstation-client.js';
import { describePolicy, type ToolApprover } from '../connect/policy.js';
import { ApprovalPrompt, useApproverPending } from './ApprovalPrompt.js';

interface ConnectAppProps {
  connection: WorkstationConnection;
  toolRoot: string;
  approver: ToolApprover | null;
  registerListener: (listener: (event: ConnectEvent) => void) => () => void;
}

interface LogLine {
  id: number;
  color?: string;
  dim?: boolean;
  text: string;
}

interface RunningCall {
  id: string;
  tool: string;
  summary: string;
  agentId?: string;
  startedAt: number;
}

const MAX_LOG_LINES = 200;
const VISIBLE_LOG_LINES = 16;

/**
 * Standalone `reflex-cli connect` screen: connection state, the confinement
 * root and policy, live in-flight calls with elapsed time, an activity log
 * of everything agents ran here, and the approval prompt for gated calls —
 * visibility is the point; nothing here is silent.
 */
export function ConnectApp({ connection, toolRoot, approver, registerListener }: ConnectAppProps) {
  const { exit } = useApp();
  const [status, setStatus] = useState<'connecting' | 'registered' | 'closed'>('connecting');
  const [workstation, setWorkstation] = useState<Workstation | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState<RunningCall[]>([]);
  const [, setClockTick] = useState(0);
  const pending = useApproverPending(approver);

  useEffect(() => {
    let nextId = 0;
    const append = (line: Omit<LogLine, 'id'>) =>
      setLog((prev) => [...prev, { ...line, id: nextId++ }].slice(-MAX_LOG_LINES));

    return registerListener((event) => {
      if (event.kind === 'status') {
        setStatus(event.status);
        if (event.workstation) setWorkstation(event.workstation);
        if (event.status !== 'registered') setRunning([]);
        append({
          dim: true,
          text:
            event.status === 'registered'
              ? `registered as ${event.workstation?.name} (${event.workstation?.id})`
              : event.status + (event.detail ? ` — ${event.detail}` : ''),
        });
      } else if (event.kind === 'tool-start') {
        setRunning((prev) => [
          ...prev,
          {
            id: event.id,
            tool: event.tool,
            summary: event.summary,
            agentId: event.agentId,
            startedAt: Date.now(),
          },
        ]);
      } else if (event.kind === 'tool') {
        setRunning((prev) => prev.filter((call) => call.id !== event.id));
        const glyph = event.outcome === 'ok' ? '✓' : event.outcome === 'denied' ? '⊘' : '✗';
        append({
          color: event.outcome === 'ok' ? undefined : event.outcome === 'denied' ? 'yellow' : 'red',
          text: `${glyph} ${event.tool} ${event.summary} (${event.durationMs}ms${
            event.agentId ? ` · ${event.agentId}` : ''
          })`,
        });
      } else {
        append({ color: 'red', text: event.message });
      }
    });
  }, [registerListener]);

  // Re-render every second while calls are in flight so elapsed times move.
  useEffect(() => {
    if (running.length === 0) return;
    const timer = setInterval(() => setClockTick((t) => t + 1), 1_000);
    return () => clearInterval(timer);
  }, [running.length]);

  useInput((input) => {
    if (input === 'q') {
      connection.stop();
      exit();
    }
  });

  const statusColor =
    status === 'registered' ? 'green' : status === 'connecting' ? 'yellow' : 'red';

  return (
    <Box flexDirection="column" padding={1}>
      <Box gap={1}>
        <Text color={statusColor}>●</Text>
        <Text bold color="cyan">
          Reflex workstation
        </Text>
        <Text dimColor>
          {status}
          {workstation ? ` · ${workstation.name} (${workstation.id})` : ''}
        </Text>
      </Box>
      <Text dimColor>
        root {toolRoot}
        {approver ? ` · ${describePolicy(approver.getPolicy())}` : ''}
      </Text>
      {running.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {running.map((call) => (
            <Text key={call.id} color="cyan">
              ⚒ {call.tool} {call.summary}{' '}
              <Text dimColor>
                running {Math.round((Date.now() - call.startedAt) / 1000)}s
                {call.agentId ? ` · ${call.agentId}` : ''}
              </Text>
            </Text>
          ))}
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {log.slice(-VISIBLE_LOG_LINES).map((line) => (
          <Text key={line.id} color={line.color} dimColor={line.dim}>
            {line.text}
          </Text>
        ))}
        {log.length === 0 ? <Text dimColor>waiting for activity…</Text> : null}
      </Box>
      {approver && pending ? (
        <Box marginTop={1}>
          <ApprovalPrompt approver={approver} pending={pending} />
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text dimColor>q quit</Text>
      </Box>
    </Box>
  );
}
