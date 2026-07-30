import { describe, expect, it } from 'vitest';
import { detectServiceManager } from '../service/index.js';
import {
  SERVICE_LABEL,
  resolveCliInvocation,
  launchdPlistPath,
  systemdUnitPath,
} from '../service/paths.js';
import { buildConnectArgs, renderLaunchdPlist, renderSystemdUnit } from '../service/unit.js';

describe('detectServiceManager', () => {
  it('maps platforms to their init system', () => {
    expect(detectServiceManager('darwin')).toBe('launchd');
    expect(detectServiceManager('linux')).toBe('systemd');
    expect(detectServiceManager('win32')).toBeNull();
  });
});

describe('resolveCliInvocation', () => {
  it('uses execPath and the resolved entry script', () => {
    const result = resolveCliInvocation(
      ['/usr/bin/node', `${process.cwd()}/bin/reflex-cli.js`],
      '/opt/node',
    );
    expect(result.execPath).toBe('/opt/node');
    expect(result.script.endsWith('/bin/reflex-cli.js')).toBe(true);
  });

  it('throws when there is no entry script', () => {
    expect(() => resolveCliInvocation(['/usr/bin/node'], '/opt/node')).toThrow(/entry script/);
  });
});

describe('buildConnectArgs', () => {
  it('always runs headless connect with the confinement dir', () => {
    expect(buildConnectArgs({ dir: '/Users/me/dev' })).toEqual([
      'connect',
      '--headless',
      '--dir',
      '/Users/me/dev',
    ]);
  });

  it('passes the name and permission flags through', () => {
    expect(buildConnectArgs({ dir: '/d', name: 'laptop', ask: true, 'allow-exec': true })).toEqual([
      'connect',
      '--headless',
      '--dir',
      '/d',
      '--name',
      'laptop',
      '--ask',
      '--allow-exec',
    ]);
  });

  it('read-only wins and drops the ask/allow flags', () => {
    expect(
      buildConnectArgs({ dir: '/d', 'read-only': true, ask: true, 'allow-write': true }),
    ).toEqual(['connect', '--headless', '--dir', '/d', '--read-only']);
  });
});

describe('renderLaunchdPlist', () => {
  const plist = renderLaunchdPlist({
    execPath: '/opt/node',
    script: '/home/me/bin/reflex-cli.js',
    args: ['connect', '--headless', '--dir', '/home/me/dev'],
    workingDir: '/home/me/dev',
    logOut: '/home/me/.reflex/logs/connect.out.log',
    logErr: '/home/me/.reflex/logs/connect.err.log',
  });

  it('declares the label, program arguments, and boot/restart keys', () => {
    expect(plist).toContain(`<string>${SERVICE_LABEL}</string>`);
    expect(plist).toContain('<string>/opt/node</string>');
    expect(plist).toContain('<string>--headless</string>');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('/home/me/.reflex/logs/connect.err.log');
  });

  it('escapes XML-significant characters in arguments', () => {
    const escaped = renderLaunchdPlist({
      execPath: '/opt/node',
      script: '/bin/x',
      args: ['--name', 'A & B <lab>'],
      workingDir: '/tmp',
      logOut: '/tmp/o',
      logErr: '/tmp/e',
    });
    expect(escaped).toContain('A &amp; B &lt;lab&gt;');
    expect(escaped).not.toContain('A & B <lab>');
  });
});

describe('renderSystemdUnit', () => {
  const unit = renderSystemdUnit({
    execPath: '/usr/bin/node',
    script: '/home/me/bin/reflex-cli.js',
    args: ['connect', '--headless', '--dir', '/home/me/dev'],
    workingDir: '/home/me/dev',
  });

  it('builds an ExecStart line and restart/boot directives', () => {
    expect(unit).toContain(
      'ExecStart=/usr/bin/node /home/me/bin/reflex-cli.js connect --headless --dir /home/me/dev',
    );
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('quotes arguments containing spaces', () => {
    const quoted = renderSystemdUnit({
      execPath: '/usr/bin/node',
      script: '/bin/x',
      args: ['--dir', '/home/my dev'],
      workingDir: '/home/my dev',
    });
    expect(quoted).toContain('"/home/my dev"');
  });
});

describe('service paths', () => {
  it('locates unit files under the given home', () => {
    expect(launchdPlistPath('/home/me')).toBe(
      `/home/me/Library/LaunchAgents/${SERVICE_LABEL}.plist`,
    );
    expect(systemdUnitPath('/home/me')).toBe(
      '/home/me/.config/systemd/user/reflex-connect.service',
    );
  });
});
