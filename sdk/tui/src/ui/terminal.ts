/** Audible nudge for attention transitions (needs input / turn finished). */
export function ringBell() {
  if (process.stdout.isTTY) process.stdout.write('\x07');
}

/** Set the terminal window/tab title (OSC 0); no-op outside a TTY. */
export function setTerminalTitle(title: string) {
  if (process.stdout.isTTY) process.stdout.write(`\x1b]0;${title}\x07`);
}
