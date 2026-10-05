import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let vite: ViteDevServer | undefined;
let pageUrl: string;

test.beforeAll(async () => {
  vite = await createServer({
    root: resolve(__dirname, '../../../..'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, open: false },
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
