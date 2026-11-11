/**
 * ⤢ "Open as full page" on an inline database (notion-motion.md Round 15 B):
 * the database fills the editor, Back returns, and an edit made on the full
 * page shows on the inline database.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const blocks: OutputBlockData[] = [
  { id: 'before', type: 'paragraph', data: { text: 'Before the database' } },
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-notes': 'old' } } },
  { id: 'after', type: 'paragraph', data: { text: 'After the database' } },
];

const mount = async (page: Page): Promise<void> => {
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
  }, blocks);
  await expect(page.getByRole('grid')).toBeVisible();
};

const notes = (page: Page): Locator =>
  page.locator('[data-blok-database-table-row][data-row-id="r1"] [role="gridcell"][data-property-id="p-notes"]');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(() => history.replaceState(history.state, '', location.pathname + location.search));
});

test('⤢ fills the editor with the database, Back returns, and an edit on the full page shows inline', async ({ page }) => {
  await mount(page);
  const expand = page.getByRole('link', { name: 'Open as full page' });

  await expect(expand).toBeVisible();
  await expand.click();

  await expect(page.getByText('Before the database')).toBeHidden();
  await expect(page.getByText('After the database')).toBeHidden();
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(expand).toBeHidden();
  expect(new URL(page.url()).hash).toBe('#db-1?full');

  await notes(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('edited on the full page');
  await page.keyboard.press('Enter');
  await expect(notes(page)).toContainText('edited on the full page');

  await page.goBack();

  await expect(page.getByText('Before the database')).toBeVisible();
  await expect(page.getByText('After the database')).toBeVisible();
  await expect(expand).toBeVisible();
  await expect(notes(page)).toContainText('edited on the full page');
  expect(new URL(page.url()).hash).toBe('');
});
