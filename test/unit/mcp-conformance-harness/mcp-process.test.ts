// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { caseEnv, startHttp } from '../mcp-conformance/mcp-process';

// Rust's eprintln! writes each format piece with its own write(2):
// "...listening on ", the URL, then "/mcp\n".
const SPLIT_LINE = `
process.stderr.write('blok-mcp: listening on ');
process.stderr.write('http://127.0.0.1:1');
setTimeout(() => process.stderr.write('/mcp\\n'), 200);
setInterval(() => undefined, 1000);
`;

describe('startHttp', () => {
  let cwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cwd = mkdtempSync(join(tmpdir(), 'blok-mcp-process-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('takes the URL from a whole line when the server writes it in pieces', async () => {
    const server = await startHttp([process.execPath, '-e', SPLIT_LINE], [], caseEnv({}), cwd);

    try {
      expect(server.url).toBe('http://127.0.0.1:1/mcp');
    } finally {
      await server.stop();
    }
  });
});
