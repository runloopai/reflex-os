import { readFileSync } from 'node:fs';
import { reflexRequest } from '@runloop/reflex-client';
import { API_OPS, type ApiOp } from '../generated/api-ops.js';
import { UsageError } from '../output/errors.js';
import { renderTable } from '../output/table.js';

/**
 * `reflex api <operation>` — the generated escape hatch. Every operation in
 * the public OpenAPI spec is callable by operationId: path params from
 * positional args, query params from repeatable `--param k=v`, request body
 * from `--input <file|->` and/or `--field a.b=v`. Output is always JSON.
 */

export interface ApiCallOptions {
  param?: string[];
  field?: string[];
  input?: string;
}

/** Exact-id lookup (case-insensitive), with suggestions on a miss. */
export function resolveApiOp(name: string): ApiOp {
  const exact = API_OPS.find((op) => op.id.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const near = API_OPS.filter((op) => op.id.toLowerCase().includes(name.toLowerCase()))
    .slice(0, 8)
    .map((op) => op.id);
  const hint = near.length
    ? `Did you mean: ${near.join(', ')}?`
    : 'Run `reflex-cli api --list` to see every operation.';
  throw new UsageError(`Unknown operation: ${name}. ${hint}`);
}

/** `a.b.c` → nested assignment; values parse as JSON when they look like it. */
function setDotted(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (typeof next !== 'object' || next === null) node[part] = {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

function parseFieldValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (/^[[{"]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

function splitPair(pair: string, flag: string): [string, string] {
  const eq = pair.indexOf('=');
  if (eq <= 0) throw new UsageError(`${flag} expects name=value, got: ${pair}`);
  return [pair.slice(0, eq), pair.slice(eq + 1)];
}

export interface BuiltApiRequest {
  path: string;
  init: RequestInit;
}

/** Pure request assembly, exported for tests. */
export function buildApiRequest(
  op: ApiOp,
  positionals: string[],
  opts: ApiCallOptions,
  readInput: (source: string) => string = readInputSource,
): BuiltApiRequest {
  if (positionals.length !== op.pathParams.length) {
    const expected = op.pathParams.length
      ? `expects <${op.pathParams.join('> <')}>`
      : 'takes no positional arguments';
    throw new UsageError(
      `${op.id} ${expected}; got ${positionals.length} argument(s). Path: ${op.method} ${op.path}`,
    );
  }
  let path = op.path;
  op.pathParams.forEach((name, i) => {
    path = path.replace(`{${name}}`, encodeURIComponent(positionals[i]));
  });

  const query = new URLSearchParams();
  const validQuery = new Set(op.queryParams.map((q) => q.name));
  for (const pair of opts.param ?? []) {
    const [name, value] = splitPair(pair, '--param');
    if (!validQuery.has(name)) {
      const known = op.queryParams.length
        ? `Query params for ${op.id}: ${op.queryParams.map((q) => q.name).join(', ')}.`
        : `${op.id} takes no query params.`;
      throw new UsageError(`Unknown query param: ${name}. ${known}`);
    }
    query.append(name, value);
  }
  const qs = query.toString();

  let body: Record<string, unknown> | undefined;
  if (opts.input !== undefined) {
    const raw = readInput(opts.input);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new UsageError('--input must contain a JSON object');
    }
    body = parsed as Record<string, unknown>;
  }
  for (const pair of opts.field ?? []) {
    const [name, value] = splitPair(pair, '--field');
    body ??= {};
    setDotted(body, name, parseFieldValue(value));
  }
  if (body !== undefined && !op.hasBody) {
    throw new UsageError(`${op.id} does not take a request body (${op.method} ${op.path})`);
  }

  const init: RequestInit = { method: op.method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  return { path: qs ? `${path}?${qs}` : path, init };
}

function readInputSource(source: string): string {
  if (source === '-') return readFileSync(0, 'utf8');
  return readFileSync(source, 'utf8');
}

export function listApiOps(): string {
  return renderTable(
    [
      { key: 'id', header: 'operation' },
      { key: 'route', header: 'route' },
      { key: 'summary', header: 'summary' },
    ],
    API_OPS.map((op) => ({
      id: op.id,
      route: `${op.method} ${op.path}`,
      summary: op.summary ?? '',
    })),
  );
}

export async function runApi(
  operation: string | undefined,
  positionals: string[],
  opts: ApiCallOptions & { list?: boolean },
): Promise<void> {
  if (opts.list || operation === undefined) {
    console.log(listApiOps());
    return;
  }
  const op = resolveApiOp(operation);
  const { path, init } = buildApiRequest(op, positionals, opts);
  const result = await reflexRequest<unknown>(path, init);
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
}
