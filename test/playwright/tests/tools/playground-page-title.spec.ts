import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

/**
 * The playground's page title is Blok's built-in `pageTitle`, fed from the
 * playground's page registry. Local mode only: `?collab=off`.
 */

let vite: ViteDevServer | undefined;
let baseUrl: string;
let cacheDir: string | undefined;

test.describe.configure({ mode: 'default' });

test.beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), 'blok-vite-'));
  vite = await createServer({
    root: resolve(__dirname, '../../../..'),
    logLevel: 'error',
    // A private deps dir: another Vite booting in the shared node_modules/.vite
    // deletes the deps this one serves (504 Outdated Optimize Dep).
    cacheDir,
    // No HMR: another session's edit in a shared checkout would reload the page mid-test.
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
  });
  await vite.listen();

  const address = vite.httpServer?.address();

  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('Playground Vite server did not bind a port');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await vite?.close();
  if (cacheDir !== undefined) {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

const url = (path: string, query = 'collab=off'): string => `${baseUrl}${path}?${query}`;

const titleOf = (page: Page): ReturnType<Page['getByTestId']> => page.getByTestId('page-header-title');

const crumbs = (page: Page): ReturnType<Page['getByRole']> => page.getByRole('navigation', { name: 'Breadcrumb' });

/** The registry's stored title for a page; undefined while the page is still the seed's. */
const storedTitle = (page: Page, pageId: string): Promise<string | undefined> => page.evaluate((id) => {
  const stored: unknown = JSON.parse(localStorage.getItem('blok-playground-pages') ?? '{}');

  if (typeof stored !== 'object' || stored === null) {
    return undefined;
  }
  const record: unknown = Reflect.get(stored, id);
  const title: unknown = typeof record === 'object' && record !== null ? Reflect.get(record, 'title') : undefined;

  return typeof title === 'string' ? title : undefined;
}, pageId);

/** Puts the caret at the end of the title and types. */
const typeAtEnd = async (page: Page, text: string): Promise<void> => {
  const title = titleOf(page);
  const box = await title.boundingBox();

  if (box === null) {
    throw new Error('The page title is not on screen');
  }
  // A click past the text, at the h1's right edge, puts the caret at the end.
  // Not End: on macOS End scrolls the page and leaves the caret.
  await title.click({ position: { x: box.width - 4, y: box.height / 2 } });
  await page.keyboard.type(text);
};

test.describe('playground page title', () => {
  test.setTimeout(90_000);

  test('the root page shows the built-in title, and a rename survives a reload', async ({ page }) => {
    await page.goto(url('/editor'));

    await expect(titleOf(page)).toHaveText('Blok');
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveCount(1);

    await typeAtEnd(page, ' Plan');

    await expect(titleOf(page)).toHaveText('Blok Plan');
    await expect.poll(() => page.title()).toContain('Blok Plan');

    await page.reload();

    await expect(titleOf(page)).toHaveText('Blok Plan');
    await expect.poll(() => page.title()).toContain('Blok Plan');
  });

  test('typing in a child page title updates the breadcrumb and document title', async ({ page }) => {
    await page.goto(url('/editor/page/getting-started'));

    await expect(titleOf(page)).toHaveText('Getting started');
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveCount(1);

    await typeAtEnd(page, ' Plan');

    await expect(crumbs(page).getByText('Getting started Plan')).toBeVisible();
    await expect.poll(() => page.title()).toContain('Getting started Plan');

    await page.reload();

    await expect(titleOf(page)).toHaveText('Getting started Plan');
  });

  test('a page opened from a link block shows its own title, and the link follows a rename', async ({ page }) => {
    await page.goto(url('/editor/page/getting-started'));
    await expect(titleOf(page)).toHaveText('Getting started');

    await page.getByTestId('page-link').getByTestId('page-title').click();

    await expect(titleOf(page)).toHaveText('Keyboard shortcuts');
    await expect(page).toHaveURL(/\/editor\/page\/keyboard-shortcuts/);

    await typeAtEnd(page, ' 2');
    await expect(crumbs(page).getByText('Keyboard shortcuts 2')).toBeVisible();

    await crumbs(page).getByRole('link', { name: 'Getting started' }).click();

    await expect(titleOf(page)).toHaveText('Getting started');
    await expect(page.getByTestId('page-link').getByTestId('page-title')).toHaveText('Keyboard shortcuts 2');
  });

  test('a rename followed at once by navigation never renames the next page', async ({ page }) => {
    await page.goto(url('/editor/page/getting-started'));
    await expect(titleOf(page)).toHaveText('Getting started');

    await typeAtEnd(page, ' X');
    await page.getByTestId('page-link').getByTestId('page-title').click();

    await expect(titleOf(page)).toHaveText('Keyboard shortcuts');
    await expect.poll(() => storedTitle(page, 'getting-started')).toBe('Getting started X');

    // The way back gives any late callback of the first editor time to land.
    await crumbs(page).getByRole('link', { name: 'Getting started X' }).click();

    await expect(titleOf(page)).toHaveText('Getting started X');
    await expect(page.getByTestId('page-link').getByTestId('page-title')).toHaveText('Keyboard shortcuts');
    expect(await storedTitle(page, 'keyboard-shortcuts') ?? 'Keyboard shortcuts').toBe('Keyboard shortcuts');
  });

  test('?slowLoad shows the title once the delayed document loads', async ({ page }) => {
    await page.goto(url('/editor/page/getting-started', 'collab=off&slowLoad=600'));

    await expect(titleOf(page)).toHaveText('Getting started');
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveCount(1);
  });
});
