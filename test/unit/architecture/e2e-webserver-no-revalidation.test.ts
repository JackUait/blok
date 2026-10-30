// @vitest-environment node
/**
 * LAW: the E2E web server tells the browser not to keep its files.
 *
 * serve-handler 6.1.7 opens a read stream before it answers 304 and never
 * closes it. A kept file is revalidated on every navigation, so each fresh
 * test page leaked one fd per dist chunk (262 at a time). The server hit
 * EMFILE mid-shard and every later test failed with ERR_CONNECTION_REFUSED.
 * `no-store` stops the browser from sending conditional requests at all.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const SERVE_BIN = resolve(REPO_ROOT, 'node_modules/serve/build/main.js');

const freePort = (): Promise<number> => new Promise((done, fail) => {
  const probe = createServer();

  probe.once('error', fail);
  probe.listen(0, () => {
    const address = probe.address();

    probe.close(() => (typeof address === 'object' && address !== null ? done(address.port) : fail(new Error('no port'))));
  });
});

const waitForServer = async (url: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(url);

      return;
    } catch {
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  throw new Error(`serve did not start at ${url}`);
};

describe('E2E web server caching', () => {
  let server: ChildProcess | undefined;
  let origin = '';

  beforeAll(async () => {
    const port = await freePort();

    origin = `http://localhost:${port}`;
    // Same flags as playwright.config.ts webServer; serve reads serve.json from cwd.
    server = spawn(process.execPath, [SERVE_BIN, '.', '-l', String(port), '--no-clipboard', '--no-compression'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
    await waitForServer(`${origin}/serve.json`);
  }, 20_000);

  afterAll(() => {
    server?.kill();
  });

  it('answers with Cache-Control: no-store, so the browser never asks for a 304', async () => {
    const response = await fetch(`${origin}/test/playwright/fixtures/test.html`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
