import { installService, serviceStatus, uninstallService } from '../service/index.js';
import type { CliFlags, ServiceAction } from '../context.js';

/**
 * Handle `reflex-cli service <action>`. Install/uninstall/status all touch the
 * platform service manager; errors (unsupported OS, missing credentials) carry
 * their own actionable message, so surface it and set a failing exit code.
 */
export function runService(action: ServiceAction, flags: CliFlags): void {
  try {
    if (action === 'install') {
      const result = installService(flags);
      console.log(`Installed the connect daemon (${result.manager}).`);
      console.log(`  unit: ${result.unitPath}`);
      console.log(`  runs: reflex-cli ${result.args.join(' ')}`);
      console.log(`  logs: ${result.logHint}`);
      console.log('It is running now and will start again on boot.');
      console.log('Remove it later with `reflex-cli service uninstall`.');
      return;
    }
    if (action === 'uninstall') {
      const result = uninstallService();
      console.log(
        result.removed
          ? `Removed the connect daemon (${result.manager}).`
          : `No connect daemon was installed (${result.manager}).`,
      );
      return;
    }
    const status = serviceStatus();
    console.log(`Connect daemon (${status.manager}): ${status.detail}`);
    console.log(`  installed: ${status.installed ? 'yes' : 'no'}`);
    console.log(`  running:   ${status.running ? 'yes' : 'no'}`);
    console.log(`  unit:      ${status.unitPath}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
