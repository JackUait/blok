// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../../../src/mcp/index';

class CliExit extends Error {
  constructor(public readonly code: number | string | null | undefined) {
    super('CLI requested exit');
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation(code => {
    throw new CliExit(code);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runCli configuration boundary', () => {
  it('reports invalid options on stderr and requests exit code 2', async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CLI configuration deadline exceeded')), 2_000);
    });

    try {
      await expect(Promise.race([runCli(['--schema', 'invalid'], {}), deadline]))
        .rejects.toMatchObject({ code: 2 });
      expect(console.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('blok-mcp: --schema'));
      expect(process.exit).toHaveBeenCalledExactlyOnceWith(2);
    } finally {
      clearTimeout(timer);
    }
  });

  describe('an --http address it cannot listen on', () => {
    const dir = { path: '' };

    beforeEach(() => {
      dir.path = mkdtempSync(join(tmpdir(), 'blok-mcp-listen-'));
      writeFileSync(join(dir.path, 'allow.mjs'), 'export default async () => true;\n');
    });

    afterEach(() => {
      rmSync(dir.path, { recursive: true, force: true });
    });

    const run = (listen: string): Promise<void> =>
      runCli(['--http', listen, '--source', `files:${dir.path}`, '--authorize', join(dir.path, 'allow.mjs')], {});

    it.each(['127.0.0.1:0x10', '127.0.0.1:1e3', '127.0.0.1:+80', '127.0.0.1: 80', '127.0.0.1:abc', '127.0.0.1:99999', '127.0.0.1:-1'])
      ('refuses %s with one line and exit code 1', async (listen) => {
        await expect(run(listen)).rejects.toMatchObject({ code: 1 });
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
          `blok-mcp: --http needs a port from 0 to 65535 after the last ":", got "${listen}"`
        );
      });

    it('reports a port already in use with one line and exit code 1', async () => {
      const taken = createServer();

      await new Promise<void>(resolve => taken.listen(0, '127.0.0.1', resolve));
      const address = taken.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;

      try {
        await expect(run(`127.0.0.1:${port}`)).rejects.toMatchObject({ code: 1 });
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
          expect.stringMatching(new RegExp(`^blok-mcp: Cannot listen on 127\\.0\\.0\\.1:${port}: .*EADDRINUSE`))
        );
      } finally {
        await new Promise<void>(resolve => taken.close(() => resolve()));
      }
    });
  });
});
