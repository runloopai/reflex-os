import { describe, expect, it } from 'vitest';
import { createProgram, parseCli } from '../cli.js';
import { formatCliError } from '../output/errors.js';
import { ReflexApiError } from '@runloop/reflex-client';

/**
 * Commander-tree behavior beyond the legacy back-compat suite in
 * config.test.ts: global flag placement, help routing, option validation,
 * and the error formatter. The legacy suite stays authoritative for the
 * exact `ParsedCli` shapes.
 */
describe('parseCli (commander tree)', () => {
  it('accepts common flags before or after the subcommand', () => {
    expect(parseCli(['--url', 'https://x', 'connect']).flags.url).toBe('https://x');
    expect(parseCli(['connect', '--url', 'https://x']).flags.url).toBe('https://x');
    expect(parseCli(['--org', 'acme', 'login', '--key', 'rfx_1']).flags).toEqual(
      expect.objectContaining({ org: 'acme', key: 'rfx_1' }),
    );
  });

  it('maps help requests to the help command', () => {
    expect(parseCli(['--help']).command).toBe('help');
    expect(parseCli(['-h']).command).toBe('help');
    expect(parseCli(['help']).command).toBe('help');
    expect(parseCli(['connect', '--help']).command).toBe('help');
  });

  it('rejects unknown options with a printable message', () => {
    expect(() => parseCli(['--frob'])).toThrow(/unknown option/);
    expect(() => parseCli(['connect', '--frob'])).toThrow(/unknown option/);
  });

  it('rejects options missing their value', () => {
    expect(() => parseCli(['--url'])).toThrow(/argument missing/);
  });

  it('parses policy flags through the service command', () => {
    expect(parseCli(['service', 'install', '--read-only', '--name', 'buildbox'])).toEqual({
      command: 'service',
      serviceAction: 'install',
      flags: expect.objectContaining({ 'read-only': true, name: 'buildbox' }),
    });
  });

  it('does not leak unset flags into the parse result', () => {
    expect(parseCli([]).flags).toEqual({});
    expect(parseCli(['connect']).flags).toEqual({});
  });

  it('renders help for the tree, including subcommands', () => {
    const help = createProgram().helpInformation();
    expect(help).toContain('connect');
    expect(help).toContain('login');
    expect(help).toContain('service');
    expect(help).toContain('Terminal client for Reflex');
  });
});

describe('formatCliError', () => {
  it('formats API errors with status, code, and hint', () => {
    const err = new ReflexApiError('Invalid API key', 401, 'invalid_api_key');
    const message = formatCliError(err);
    expect(message).toContain('API error 401 (invalid_api_key): Invalid API key');
    expect(message).toContain('reflex-cli login');
  });

  it('prefers a server-provided hint', () => {
    const err = new ReflexApiError('Nope', 403, 'forbidden', 'Ask an org admin for access.');
    expect(formatCliError(err)).toContain('Ask an org admin for access.');
  });

  it('falls back to the message for plain errors', () => {
    expect(formatCliError(new Error('boom'))).toBe('boom');
    expect(formatCliError('boom')).toBe('boom');
  });
});
