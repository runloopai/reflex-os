import { describe, expect, it } from 'vitest';
import type { ReflexStreamEvent } from '@runloop/reflex-client';
import { parseCli } from '../cli.js';
import { exitCodeForOutcome } from '../commands/run.js';
import { parseUntilFlag, watchAgent, type StreamSource } from '../commands/watch.js';
import { UsageError } from '../output/errors.js';

/**
 * The streaming slice: parse records for `watch`/`run`/`chat`/`open`, the
 * `--until` flag, and `watchAgent` against a scripted stream source (no
 * socket, no server).
 */

describe('streaming command parsing', () => {
  it('records watch under both names', () => {
    expect(parseCli(['agents', 'watch', 'agt_1']).command).toBe('agents:watch');
    expect(parseCli(['watch', 'agt_1']).command).toBe('watch');
  });

  it('records run, chat, and open', () => {
    expect(parseCli(['run', '-p', 'fix it']).command).toBe('run');
    expect(parseCli(['chat', 'agt_1']).command).toBe('chat');
    expect(parseCli(['open', 'agt_1']).command).toBe('open');
    expect(parseCli(['open', 'agt_1', 'pr']).command).toBe('open');
  });

  it('keeps global flags working on the new commands', () => {
    expect(parseCli(['watch', 'agt_1', '--org', 'acme']).flags.org).toBe('acme');
    expect(parseCli(['run', '-p', 'x', '--url', 'https://x']).flags.url).toBe('https://x');
    expect(parseCli(['chat', 'agt_1', '--key', 'rfx_1']).flags.key).toBe('rfx_1');
  });

  it('accepts the watch and run streaming flags', () => {
    expect(parseCli(['watch', 'agt_1', '--json', '--until', 'pr']).command).toBe('watch');
    expect(parseCli(['run', '-p', 'x', '--until', 'forever', '--json']).command).toBe('run');
  });

  it('rejects a bad --until value as a usage error', () => {
    expect(() => parseCli(['watch', 'agt_1', '--until', 'nope'])).toThrow(UsageError);
    expect(() => parseCli(['run', '-p', 'x', '--until', 'nope'])).toThrow(/done, pr, or forever/);
  });

  it('requires the agent argument', () => {
    expect(() => parseCli(['watch'])).toThrow(/missing required argument/i);
    expect(() => parseCli(['chat'])).toThrow(/missing required argument/i);
    expect(() => parseCli(['open'])).toThrow(/missing required argument/i);
  });
});

describe('parseUntilFlag', () => {
  it('defaults to done and passes the valid values through', () => {
    expect(parseUntilFlag(undefined)).toBe('done');
    expect(parseUntilFlag('done')).toBe('done');
    expect(parseUntilFlag('pr')).toBe('pr');
    expect(parseUntilFlag('forever')).toBe('forever');
  });

  it('rejects anything else', () => {
    expect(() => parseUntilFlag('until-dawn')).toThrow(UsageError);
  });
});

describe('exitCodeForOutcome', () => {
  it('maps reached conditions to 0 and agent errors to 1', () => {
    expect(exitCodeForOutcome('done')).toBe(0);
    expect(exitCodeForOutcome('pr')).toBe(0);
    expect(exitCodeForOutcome('error')).toBe(1);
  });
});

// --- watchAgent against a scripted source ---

let eventSeq = 0;

function event(type: string, payload: unknown = {}): ReflexStreamEvent {
  eventSeq += 1;
  return {
    id: `evt_${eventSeq}`,
    streamId: 'str_1',
    type,
    payload,
    timestamp: 1_000 + eventSeq * 100,
  };
}

interface FakeStream {
  source: StreamSource;
  emit: (event: ReflexStreamEvent) => void;
  subscribed: () => boolean;
  closed: () => boolean;
}

function fakeStream(history: ReflexStreamEvent[]): FakeStream {
  let handler: ((event: ReflexStreamEvent) => void) | null = null;
  let closed = false;
  return {
    source: {
      backfill: () => Promise.resolve(history),
      subscribe: (_streamId, onEvent) => {
        handler = onEvent;
        return () => {
          handler = null;
        };
      },
      close: () => {
        closed = true;
      },
    },
    emit: (e) => handler?.(e),
    subscribed: () => handler !== null,
    closed: () => closed,
  };
}

const AGENT = { id: 'agt_1', streamId: 'str_1' };

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('watchAgent', () => {
  it('resolves done from the backfill alone when the last turn completed', async () => {
    const stream = fakeStream([
      event('query', { message: { role: 'user', content: 'go' } }),
      event('turn.claude.assistant', {
        message: { content: [{ type: 'text', text: 'All set.' }] },
      }),
      event('turn.claude.result', { is_error: false }),
      event('turn.completed'),
    ]);
    const lines: string[] = [];
    const outcome = await watchAgent(AGENT, {
      until: 'done',
      json: false,
      source: stream.source,
      out: (line) => lines.push(line),
    });
    expect(outcome).toBe('done');
    expect(stream.subscribed()).toBe(false);
    expect(stream.closed()).toBe(true);
    const text = lines.join('\n');
    expect(text).toContain('❯ go');
    expect(text).toContain('● All set.');
  });

  it('follows live events until the turn completes', async () => {
    const stream = fakeStream([]);
    const lines: string[] = [];
    const promise = watchAgent(AGENT, {
      until: 'done',
      json: false,
      source: stream.source,
      out: (line) => lines.push(line),
    });
    await settle();
    expect(stream.subscribed()).toBe(true);
    stream.emit(event('query', { message: { role: 'user', content: 'fix the bug' } }));
    stream.emit(
      event('turn.claude.assistant', { message: { content: [{ type: 'text', text: 'Done.' }] } }),
    );
    stream.emit(event('turn.claude.result', { is_error: false }));
    await expect(promise).resolves.toBe('done');
    expect(stream.closed()).toBe(true);
    expect(lines.join('\n')).toContain('fix the bug');
  });

  it('resolves error when the live turn fails', async () => {
    const stream = fakeStream([event('query', { message: { role: 'user', content: 'go' } })]);
    const promise = watchAgent(AGENT, {
      until: 'done',
      json: true,
      source: stream.source,
      out: () => {},
    });
    await settle();
    stream.emit(event('turn.failed', { error: 'exploded' }));
    await expect(promise).resolves.toBe('error');
  });

  it('waits for a PR with --until pr, ignoring completed turns', async () => {
    const stream = fakeStream([
      event('query', { message: { role: 'user', content: 'open a PR' } }),
      event('turn.completed'),
    ]);
    const promise = watchAgent(AGENT, {
      until: 'pr',
      json: true,
      source: stream.source,
      out: () => {},
    });
    await settle();
    expect(stream.subscribed()).toBe(true);
    stream.emit(event('agent.pr_created', { url: 'https://g/1', number: 1, title: 'fix' }));
    await expect(promise).resolves.toBe('pr');
  });

  it('emits NDJSON in json mode and dedupes the socket replay overlap', async () => {
    const shared = event('query', { message: { role: 'user', content: 'go' } });
    const stream = fakeStream([shared]);
    const lines: string[] = [];
    const promise = watchAgent(AGENT, {
      until: 'done',
      json: true,
      source: stream.source,
      out: (line) => lines.push(line),
    });
    await settle();
    stream.emit(shared); // socket replays the cached window
    stream.emit(event('turn.completed'));
    await expect(promise).resolves.toBe('done');
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => (JSON.parse(l) as ReflexStreamEvent).type)).toEqual([
      'query',
      'turn.completed',
    ]);
  });
});
