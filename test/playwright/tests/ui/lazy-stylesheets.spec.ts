import type { Browser, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
  }
}

/** A 1×1 PNG, so an image block renders without the network. */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** A database with one table row, the smallest block that needs the database sheet. */
const DATABASE: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
];

const mount = async (page: Page, id: string, blocks: OutputBlockData[], nonce?: string): Promise<void> => {
  await page.evaluate(async ({ holderId, input, styleNonce }) => {
    const holder = document.createElement('div');

    holder.id = holderId;
    document.body.appendChild(holder);
    const blok = new window.Blok({
      holder,
      data: { blocks: input },
      ...(styleNonce === undefined ? {} : { style: { nonce: styleNonce } }),
    });

    await blok.isReady;
  }, { holderId: id, input: blocks, styleNonce: nonce });
};

const blokStyleTags = async (page: Page): Promise<Array<{ id: string; nonce: string; markers: string[] }>> =>
  page.evaluate(() => [...document.head.querySelectorAll('style[id^="blok"]')]
    .filter((tag) => tag.id.startsWith('blok-styles'))
    .map((tag) => ({
      id: tag.id,
      nonce: (tag as HTMLStyleElement).nonce,
      markers: [...(tag.textContent ?? '').matchAll(/\[data-blok-sheet=([a-z0-9-]+)\]/g)].map((match) => match[1]),
    })));

/** A fresh page whose stylesheet chunk matching `pattern` fails to load. */
const pageWithoutChunk = async (
  browser: Browser,
  pattern: RegExp
): Promise<{ page: Page; errors: string[]; aborted: string[]; close: () => Promise<void> }> => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  const aborted: string[] = [];

  page.on('pageerror', (error) => errors.push(error.message));
  // A tool's code chunk can share the sheet's name, so only the chunk that
  // carries the compiled CSS is dropped.
  await page.route(pattern, async (route) => {
    const response = await route.fetch();

    if ((await response.text()).includes('/*! tailwindcss')) {
      aborted.push(route.request().url());
      await route.abort();
    } else {
      await route.fulfill({ response });
    }
  });
  await page.goto(TEST_PAGE_URL);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  return { page, errors, aborted, close: () => context.close() };
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('lazy stylesheets', () => {
  test('a database is styled the moment the editor is ready, from the one #blok-styles', async ({ page }) => {
    await mount(page, 'blok', DATABASE, 'n0nce');

    const [tag, ...others] = await blokStyleTags(page);

    expect(others).toEqual([]);
    expect(tag?.id).toBe('blok-styles');
    expect(tag?.nonce).toBe('n0nce');
    // Fonts, database and media (the page has media tools) are in; the toolbox
    // preview sheet waits for its card, and Ask AI needs an assistant.
    expect(tag?.markers.filter((name) => name !== 'presence')).toEqual(['block-preview', 'askai']);
    // database.css paints the wrapper in the database ink.
    await expect(page.locator('[data-blok-database-wrapper]').first()).toHaveCSS('color', 'rgb(44, 44, 43)');
  });

  test('an image block is styled the moment the editor is ready', async ({ page }) => {
    await mount(page, 'blok', [{ type: 'image', data: { url: PNG, caption: 'An image' } }]);

    // image.css places the block; unstyled it would be `static`.
    await expect(page.locator('[data-blok-tool="image"]').first()).toHaveCSS('position', 'relative', { timeout: 1 });
    expect((await blokStyleTags(page))[0]?.markers.some((name) => name.startsWith('media'))).toBe(false);
  });

  test('with an assistant, the Ask AI sheet is in the moment the editor is ready', async ({ page }) => {
    await page.evaluate(async () => {
      const holder = document.createElement('div');

      holder.id = 'blok';
      document.body.appendChild(holder);
      const blok = new window.Blok({ holder, agent: { assistant: { model: () => undefined } } });

      await blok.isReady;
    });

    expect((await blokStyleTags(page))[0]?.markers.includes('askai')).toBe(false);
  });

  test('"Nothing found" never shows its drawing unstyled, in an editor with no media tool', async ({ browser }) => {
    // A fresh page: the loaded sheets are page-wide, and another test may have loaded media.
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.evaluate(async () => {
      const holder = document.createElement('div');

      holder.id = 'blok';
      document.body.appendChild(holder);
      const { BlokOriginal, BlokParagraph } = window as unknown as { BlokOriginal: typeof window.Blok; BlokParagraph: unknown };
      const blok = new BlokOriginal({ holder, tools: { paragraph: BlokParagraph }, data: { blocks: [{ type: 'paragraph', data: { text: '' } }] } });

      await blok.isReady;
    });
    expect((await blokStyleTags(page))[0]?.markers.includes('media')).toBe(true);

    const paragraph = page.locator('[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]');

    await paragraph.click();
    await paragraph.type('/qqqzzzxx');

    const art = page.getByTestId('popover-nothing-found').locator('[data-blok-media-preview="search"]');

    await expect(art).toBeVisible();
    // media-empty.css sizes the drawing; it may show only once that is in.
    expect((await blokStyleTags(page))[0]?.markers.includes('media-2')).toBe(false);
    await expect(art).toHaveCSS('display', 'block');
    await context.close();
  });

  for (const [sheet, pattern] of [
    // `database-csv-<hash>` is code; the hash is exactly 8 characters.
    ['fonts', /\/dist\/(?:pure-)?chunks\/fonts-[\w-]{8}\.mjs$/],
    ['database', /\/dist\/(?:pure-)?chunks\/database-[\w-]{8}\.mjs$/],
  ] as const) {
    test(`the editor still boots when the ${sheet} chunk fails to load`, async ({ browser }) => {
      const { page, errors, aborted, close } = await pageWithoutChunk(browser, pattern);

      await mount(page, 'blok', DATABASE);

      expect(aborted).toHaveLength(1);

      await expect(page.locator('[data-blok-database-wrapper]').first()).toBeVisible();
      expect((await blokStyleTags(page))[0]?.markers.includes(sheet)).toBe(true);
      expect(errors).toEqual([]);
      await close();
    });
  }

  test('the bundled faces exist once the editor is ready', async ({ page }) => {
    await mount(page, 'blok', []);

    const families = await page.evaluate(() => [...document.fonts].map((face) => face.family.replace(/"/g, '')));

    expect(families).toEqual(expect.arrayContaining(['Inter', 'Source Serif 4', 'JetBrains Mono', 'Permanent Marker']));
  });

  test('a second editor adds no second copy of any sheet', async ({ page }) => {
    await mount(page, 'one', DATABASE);
    await mount(page, 'two', DATABASE);

    expect((await blokStyleTags(page)).map((tag) => tag.id)).toEqual(['blok-styles']);
    // Each sheet is spliced in once: the four bundled faces appear four times, not eight.
    expect(await page.evaluate(() => document.getElementById('blok-styles')?.textContent?.match(/@font-face/g)?.length)).toBe(4);
  });

  test('the toolbox preview card is styled when it first opens', async ({ page }) => {
    await mount(page, 'blok', [{ type: 'paragraph', data: { text: '' } }]);

    const paragraph = page.locator('[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]');

    await paragraph.click();
    await paragraph.type('/');
    await page.getByTestId('toolbox-popover').locator('[data-blok-item-name="header-1"]').hover();

    const card = page.getByTestId('toolbox-preview');

    await expect(card).toBeVisible();
    // block-preview.css fixes the card at 248px.
    await expect(card).toHaveCSS('width', '248px');
  });

  test('under a nonce-only style policy the lazy sheets still apply', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.route(TEST_PAGE_URL, async (route) => {
      const response = await route.fetch();

      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': "style-src 'nonce-n0nce'" } });
    });
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    // The policy is live: a style tag without the nonce does nothing.
    const blocked = await page.evaluate(() => {
      const probe = document.createElement('style');

      probe.textContent = 'html { --probe: on; }';
      document.head.append(probe);

      return getComputedStyle(document.documentElement).getPropertyValue('--probe') === '';
    });

    expect(blocked).toBe(true);
    await mount(page, 'blok', DATABASE, 'n0nce');

    await expect(page.locator('[data-blok-database-wrapper]').first()).toHaveCSS('color', 'rgb(44, 44, 43)');
    expect(await page.evaluate(() => [...document.fonts].some((face) => face.family.replace(/"/g, '') === 'JetBrains Mono'))).toBe(true);
    await context.close();
  });
});
