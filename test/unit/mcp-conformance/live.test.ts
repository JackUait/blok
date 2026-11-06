// @vitest-environment node
import { describe, it } from 'vitest';

import { conformanceCommand } from './mcp-process';

/*
 * LIVE mode (blok_open against a remote sync room) is not covered yet.
 * TODO: add the live group here, per docs/plans/2026-11-06-csharp-mcp-research/07-remote-live-client.md §3.
 * It is kept as its own suite so the runner can tell this placeholder from a skipped case.
 */
describe.skipIf(conformanceCommand() === undefined)('MCP conformance: live mode', () => {
  it.todo('joins a remote sync room (07-remote-live-client.md §3)');
});
