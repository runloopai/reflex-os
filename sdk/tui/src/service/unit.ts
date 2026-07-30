import { SERVICE_LABEL } from './paths.js';

/**
 * Connect flags the service bakes into its unit. Credentials are deliberately
 * excluded — the daemon reads `~/.reflex/tui.json`, so the API key never lands
 * in a world-readable unit file. Only the confinement dir, display name, and
 * permission posture travel with the install.
 */
export interface ServiceConnectFlags {
  dir?: string;
  name?: string;
  ask?: boolean;
  'allow-exec'?: boolean;
  'allow-write'?: boolean;
  'read-only'?: boolean;
}

/**
 * Build the argv the daemon runs: always `connect --headless` (no TTY UI),
 * plus the confinement dir and any permission flags. `dir` is resolved to an
 * absolute path by the caller. The order is stable so the generated unit is
 * deterministic (and diffable across reinstalls).
 */
export function buildConnectArgs(flags: ServiceConnectFlags): string[] {
  const args = ['connect', '--headless'];
  if (flags.dir) args.push('--dir', flags.dir);
  if (flags.name) args.push('--name', flags.name);
  if (flags['read-only']) {
    args.push('--read-only');
  } else {
    if (flags.ask) args.push('--ask');
    if (flags['allow-exec']) args.push('--allow-exec');
    if (flags['allow-write']) args.push('--allow-write');
  }
  return args;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface LaunchdPlistOptions {
  execPath: string;
  script: string;
  args: string[];
  workingDir: string;
  logOut: string;
  logErr: string;
  label?: string;
}

/**
 * Render a launchd LaunchAgent plist. `RunAtLoad` starts it at login and
 * `KeepAlive` restarts it if it crashes or the network drops it — matching the
 * connection's own reconnect posture but surviving a full process death.
 */
export function renderLaunchdPlist(options: LaunchdPlistOptions): string {
  const label = options.label ?? SERVICE_LABEL;
  const programArgs = [options.execPath, options.script, ...options.args];
  const argEntries = programArgs.map((a) => `    <string>${escapeXml(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${argEntries}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(options.workingDir)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.logOut)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.logErr)}</string>
</dict>
</plist>
`;
}

function shellQuote(value: string): string {
  // systemd ExecStart follows shell-like quoting; double-quote anything that
  // isn't a plain token and escape embedded quotes/backslashes.
  if (/^[A-Za-z0-9_./:@%+-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export interface SystemdUnitOptions {
  execPath: string;
  script: string;
  args: string[];
  workingDir: string;
}

/**
 * Render a systemd *user* unit. `Restart=always` mirrors launchd's KeepAlive;
 * `WantedBy=default.target` starts it on login, and enabling linger (done by
 * the installer) lets it start at boot before any login. stdout/stderr go to
 * the journal (`journalctl --user -u reflex-connect`).
 */
export function renderSystemdUnit(options: SystemdUnitOptions): string {
  const execStart = [options.execPath, options.script, ...options.args].map(shellQuote).join(' ');
  return `[Unit]
Description=Reflex workstation connect daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${shellQuote(options.workingDir)}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
}
