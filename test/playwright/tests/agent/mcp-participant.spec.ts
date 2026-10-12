import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

import { blokTicket } from '../../../../packages/server/src/ticket';
import { assembleMcp, type AssembledMcp } from '../../../../src/mcp/server';
import { startDocEndpoint } from '../../../unit/server-conformance/doc-endpoint';
import { startServer, type RunningServer } from '../../../unit/server-conformance/run-against';

/**
 * A browser tab on the playground sees an MCP agent's edit and its participant
 * face, against the built C# host. Gated like the conformance suite.
 */

const ROOT = resolve(__dirname, '../../../..');
const SECRET = 'mcp-e2e-secret-0123456789abcdefghijkl';
const DOC = 'mcp-e2e';
// The playground's fixed DEV_SERVER_URL (index.html).
const SYNC_PORT = 4000;
// The browser composes "<agent> for <person>" (presence.agentFor); MCP publishes the bare agent name.
const AGENT_FACE = /^claude-code( for .+)?$/;

// Registered only with the built C# host (scripts/test-server-conformance.mjs
// builds it), like the conformance suite: a run without it has nothing to talk to.
const HAS_HOST = process.env.BLOK_CONFORMANCE_SERVER !== undefined && process.env.BLOK_CONFORMANCE_SERVER !== '';

const state: {
  vite?: ViteDevServer;
  viteUrl: string;
  mint?: Server;
  room?: RunningServer;
  endpoint?: Awaited<ReturnType<typeof startDocEndpoint>>;
  collabDir?: string;
  cacheDir?: string;
  mcp?: AssembledMcp;
} = { viteUrl: '' };

const portOf = (server: { address(): unknown } | null | undefined): number => {
  const address = server?.address();

  if (typeof address !== 'object' || address === null || !('port' in address) || typeof address.port !== 'number') {
    throw new Error('server did not bind a port');
  }

  return address.port;
};

if (HAS_HOST) {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    state.cacheDir = mkdtempSync(join(tmpdir(), 'blok-vite-'));
    state.collabDir = mkdtempSync(join(tmpdir(), 'blok-mcp-e2e-'));

    const mint = createHttpServer((request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      response.end(JSON.stringify({ ticket: blokTicket(SECRET, { user: 'e2e-human', doc: DOC, write: true, ttlSeconds: 600 }) }));
    });

    state.mint = mint;
    await new Promise<void>((done) => {
      mint.listen(0, '127.0.0.1', done);
    });

    // vite.config.mjs defines __BLOK_DEV_BACKEND__ from this, so the playground joins a room.
    process.env.BLOK_DEV_BACKEND = '1';
    process.env.VITE_BLOK_TICKET_URL = `http://127.0.0.1:${portOf(mint)}/ticket`;
    state.vite = await createServer({
      root: ROOT,
      logLevel: 'error',
      // A private deps dir: vite.config.mjs re-optimizes on boot, and a shared one is deleted under peers.
      cacheDir: state.cacheDir,
      server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
    });
    await state.vite.listen();
    state.viteUrl = `http://127.0.0.1:${portOf(state.vite.httpServer)}`;

    state.endpoint = await startDocEndpoint();
    state.room = await startServer({
      allocatePort: () => Promise.resolve(SYNC_PORT),
      args: [
        '--listen', '127.0.0.1:0', '--auth', 'ticket', '--storage-dir', '', '--rate-limit', '0',
        '--collab', '--collab-dir', state.collabDir, '--doc-endpoint', state.endpoint.url,
        '--conformance-journal', '--allow-origin', state.viteUrl,
      ],
      env: { BLOK_SECRET: SECRET },
    });
    state.mcp = assembleMcp({
      transport: { kind: 'stdio' },
      auth: { kind: 'none' },
      sync: { url: `ws://127.0.0.1:${SYNC_PORT}/sync`, origin: state.viteUrl },
      tickets: { kind: 'secret', secret: SECRET },
    });
  });

  test.afterAll(async () => {
    await state.mcp?.stop();
    await state.room?.stop();
    await state.endpoint?.stop();
    await state.vite?.close();
    await new Promise<void>((done) => {
      if (state.mint === undefined) {
        done();

        return;
      }
      state.mint.close(() => done());
      state.mint.closeAllConnections();
    });
    delete process.env.BLOK_DEV_BACKEND;
    delete process.env.VITE_BLOK_TICKET_URL;
    [state.collabDir, state.cacheDir].forEach((dir) => {
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  test('the human sees the agent block and the agent participant', async ({ page }) => {
    const mcp = state.mcp;

    if (mcp === undefined) {
      throw new Error('the MCP server did not start');
    }

    await page.goto(`${state.viteUrl}/editor?collab=${DOC}&name=Alice`);
    await expect(page.locator('[data-blok-collab="connected"]').first()).toBeAttached({ timeout: 15_000 });

    const caller = { principal: 'alice', clientName: 'claude-code', scopes: null };
    const opened = await mcp.dispatch('blok_open', { documentId: DOC, write: true }, caller);
    const { handle } = opened.structuredContent;
    const executed = await mcp.dispatch('blok_execute', {
      handle,
      commands: [{ name: 'block.insert', args: { type: 'paragraph', data: { text: 'Hello from the agent' } } }],
    }, caller);

    expect(executed.structuredContent).toMatchObject({ ok: true });
    await expect(page.getByText('Hello from the agent')).toBeVisible();
    await expect(page.getByLabel(AGENT_FACE)).toBeVisible();

    await mcp.dispatch('blok_close', { handle }, caller);
    await expect(page.getByLabel(AGENT_FACE)).toHaveCount(0);
  });
}
