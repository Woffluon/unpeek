#!/usr/bin/env node
import { runCli } from '../dist/cli/index.js';

runCli(process.argv.slice(2)).catch((err) => {
  console.error('[unpeek] fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
