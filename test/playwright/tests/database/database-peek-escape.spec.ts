/**
 * One Escape on an open row peek closes the peek only (findings-darkkeys K01).
 * The database block must not end up block-selected, and the gallery gets its
 * peeked card back.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  { id: 'above', type: 'paragraph', data: { text: 'Above' } },
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        {
          id: 'p-status', name: 'Status', type: 'select', position: 'a1', config: { options: [
            { id: 'o-todo', label: 'Todo', position: 'a0' },
            { id: 'o-done', label: 'Done', position: 'a1' },
          ] },
        },
      ],
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-status': 'o-todo' } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Beta', 'p-status': 'o-done' } } },
] as OutputBlockData[];

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, data);
};

const selectedBlockCount = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('[data-blok-selected="true"]').length);

const peek = (page: Page): ReturnType<Page['locator']> => page.locator('[data-blok-database-drawer][data-open]');

/** Escape from the peek's title field, the field a fresh peek focuses. */
const escapeFromTitle = async (page: Page): Promise<void> => {
  await expect(peek(page)).toBeVisible();
  await page.getByRole('textbox', { name: 'Card title' }).focus();
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('Escape on a side peek from the board closes it and selects no block', async ({ page }) => {
  await mount(page, blocks({ type: 'board', groupBy: 'p-status' }));
  await page.locator('[data-blok-database-card][data-row-id="r1"]').click();

  await escapeFromTitle(page);

  expect(await selectedBlockCount(page)).toBe(0);
});

test('Escape on a center peek from the gallery closes it and gives the card back', async ({ page }) => {
  await mount(page, blocks({ type: 'gallery' }));
  const card = page.locator('[data-blok-database-gallery-card][data-row-id="r1"]');

  await card.click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await page.keyboard.press('Enter');

  await escapeFromTitle(page);

  expect(await selectedBlockCount(page)).toBe(0);
  await expect(card).toHaveAttribute('data-blok-database-row-selected', '');
  await expect(page.locator('[data-blok-database-gallery]')).toBeFocused();
});
