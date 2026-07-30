#!/usr/bin/env node
/** `reflex-chat-kit` executable: thin wrapper around {@link runCli}. */
import { runCli } from './cli.js';

process.exit(runCli(process.argv.slice(2)));
