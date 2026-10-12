#!/usr/bin/env node
// Guard before importing the CLI; module-load logs would corrupt stdout.
import { installStdoutGuard } from '../dist/stdout-guard.mjs';

installStdoutGuard(console);

const { runCli } = await import('../dist/mcp.mjs');

await runCli(process.argv.slice(2), process.env);
