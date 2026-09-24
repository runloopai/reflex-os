// Executable entrypoint — kept separate from cli.ts so tests can import
// the CLI's pure pieces without triggering a render.
// Must evaluate before any module constructs a Zod schema, or the compiled fast path never installs.
import 'zod/compile';
import { main } from './cli.js';

// `reflex-cli --help | head` closes stdout early; treat the broken pipe as
// a normal end of output instead of crashing with an EPIPE stack trace.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

void main();
