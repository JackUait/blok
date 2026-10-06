import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let vite: ViteDevServer | undefined;
let pageUrl: string;
let cacheDir: string | undefined;

test.beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), 'blok-vite-'));
  vite = await createServer({
    root: resolve(__dirname, '../../../..'),
    logLevel: 'error',
    // vite.config.mjs forces re-optimization, so every Vite boot deletes its
    // deps dir. In the shared node_modules/.vite, another Vite booting
    // (page-real-host.spec.ts's worker, a retry, `yarn serve`) deletes the deps
    // this one is serving: 504 Outdated Optimize Dep and a blank page.
    cacheDir,
    // Without hmr off, another session's edit in this shared checkout makes
    // Vite full-reload every open page mid-test.
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
  });
  await vite.listen();

  const address = vite.httpServer?.address();

  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Playground Vite server did not bind a port');
  }
  pageUrl = `http://127.0.0.1:${address.port}/editor/page/getting-started?collab=off`;
});

test.afterAll(async () => {
  await vite?.close();
  if (cacheDir !== undefined) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('page title and Undo reach another playground tab', async ({ page, context }) => {
  test.setTimeout(90_000);
  const other = await context.newPage();

  try {
    await page.goto(pageUrl);
    await other.goto(pageUrl);

    const titleA = page.getByRole('textbox', { name: 'Page title' });
    const titleB = other.getByRole('textbox', { name: 'Page title' });

    await expect(titleA).toHaveText('Getting started');
    await expect(titleB).toHaveText('Getting started');

    await titleA.fill('Renamed in tab A');

    await expect(titleB).toHaveText('Renamed in tab A');

    await titleA.press('ControlOrMeta+z');

    await expect(titleA).toHaveText('Getting started');
    await expect(titleB).toHaveText('Getting started');
  } finally {
    await other.close();
  }
});
