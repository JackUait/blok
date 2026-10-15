/**
 * Backlinks on a row page (research/17 §2, research/09 §6): "N backlinks"
 * first in the title hover row, nothing at all with none, and a
 * "Linked to this page" list whose items go to the mentioning block.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    hostOpened?: unknown[];
    hostAsked?: number;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

const SCHEMA = [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }];

const mention = (id: string): { embed: { page: { id: string } } } => ({ embed: { page: { id } } });

const blocks = (extra: { top?: boolean; bravo?: boolean } = {}): OutputBlockData[] => [
  { id: 'top', type: 'paragraph', data: { text: extra.top === false ? 'Plain' : [{ text: 'See ' }, mention('r1')] } },
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', title: 'Alpha', properties: { 'p-title': 'Alpha' } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', title: 'Bravo', properties: { 'p-title': 'Bravo' } }, content: ['b2'] },
  { id: 'b2', type: 'paragraph', parent: 'r2', data: { text: extra.bravo === false ? 'Bravo body' : [{ text: 'Bravo body ' }, mention('r1')] } },
] as OutputBlockData[];

const mount = async (page: Page, data: OutputBlockData[], host = false): Promise<void> => {
  await page.evaluate(async ({ data: input, host: withHost }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.hostOpened = [];
    window.hostAsked = 0;
    const backlinks = {
      list: async () => {
        window.hostAsked = (window.hostAsked ?? 0) + 1;

        return [{ pageId: 'far', title: 'Roadmap', path: ['Team'], blockId: 'x9' }];
      },
      open: (link: unknown) => window.hostOpened?.push(link),
    };

    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      ...(withHost ? { tools: { database: { class: window.BlokDatabase, config: { backlinks } }, 'database-row': { class: window.BlokDatabaseRow } } } : {}),
    });
    await window.blokInstance.isReady;
  }, { data, host });
  await expect(page.getByRole('grid')).toBeVisible();
};

const openRow = async (page: Page, rowId: string): Promise<void> => {
  const row = page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
  await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();
};

const backlinks = (page: Page) => page.locator('[data-blok-database-drawer]').getByRole('button', { name: /backlink/ });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('draws nothing when no page mentions the row', async ({ page }) => {
  await mount(page, blocks({ top: false, bravo: false }));
  await openRow(page, 'r1');

  await expect(page.locator('[data-blok-database-drawer-page-head]')).toBeAttached();
  expect(await page.locator('[data-blok-database-drawer]').innerHTML()).not.toMatch(/acklink/);
});

test('shows "2 backlinks" first in the hover row, hidden until the page is hovered', async ({ page }) => {
  await mount(page, blocks());
  await openRow(page, 'r1');

  const button = backlinks(page);

  await expect(button).toHaveText('2 backlinks');
  expect(await button.evaluate((el) => el.parentElement?.firstElementChild === el)).toBe(true);
  await page.mouse.move(5, 5);
  await expect(button).toHaveCSS('opacity', '0');
  await page.locator('[data-blok-database-drawer-title]').hover();
  await expect(button).toHaveCSS('opacity', '1');
  const box = await button.boundingBox();

  expect(box?.height).toBe(28);
});

test('lists the mentioning pages; one Escape closes only the list', async ({ page }) => {
  await mount(page, blocks());
  await openRow(page, 'r1');
  await page.locator('[data-blok-database-drawer-title]').hover();
  await backlinks(page).click();

  await expect(page.getByText('Linked to this page')).toBeVisible();
  const bravo = page.locator('[data-blok-item-name="backlink-r2"]');

  await expect(bravo.locator('[data-blok-database-backlink-title]')).toHaveText('Bravo');
  await expect(bravo.locator('[data-blok-database-backlink-path]')).toHaveText('Tasks');
  await expect(page.locator('[data-blok-item-name="backlink-document"]')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByText('Linked to this page')).toBeHidden();
  await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();
});

test('a picked page opens at the mentioning block, not selected', async ({ page }) => {
  await mount(page, blocks());
  await openRow(page, 'r1');
  await page.locator('[data-blok-database-drawer-title]').hover();
  await backlinks(page).click();
  await expect(page.getByText('Linked to this page')).toBeVisible();

  // Keyboard path: a click clears the block selection by itself (memory: toc jump traps).
  const items = page.locator('[data-blok-item-name^="backlink-"]');

  await expect(items).toHaveCount(2);
  const names = await items.evaluateAll((els) => els.map((el) => el.getAttribute('data-blok-item-name')));

  for (let i = 0; i <= names.indexOf('backlink-r2'); i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(page.locator('[data-blok-database-drawer-title]')).toHaveValue('Bravo');
  await expect(page.getByText('Bravo body')).toBeInViewport();
  await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(0);
});

test('counts again when a mention comes or goes while the page is open', async ({ page }) => {
  await mount(page, blocks({ top: false }));
  await openRow(page, 'r1');
  await expect(backlinks(page)).toHaveText('1 backlink');

  await page.evaluate(() => {
    window.blokInstance?.blocks.insert('paragraph', { text: 'More <a data-blok-page-id="r1">x</a>' }, undefined, 0);
  });
  await expect(backlinks(page)).toHaveText('2 backlinks');

  await page.evaluate(async () => {
    const at = window.blokInstance?.blocks.getBlockIndex('b2');

    if (at !== undefined) await window.blokInstance?.blocks.delete(at);
  });
  await expect(backlinks(page)).toHaveText('1 backlink');
});

test('adds the host\'s pages from other documents and opens them through the host', async ({ page }) => {
  await mount(page, blocks({ top: false, bravo: false }), true);
  await openRow(page, 'r1');

  await expect(backlinks(page)).toHaveText('1 backlink');
  await page.locator('[data-blok-database-drawer-title]').hover();
  await backlinks(page).click();
  const far = page.locator('[data-blok-item-name="backlink-host-far"]');

  await expect(far.locator('[data-blok-database-backlink-title]')).toHaveText('Roadmap');
  await expect(far.locator('[data-blok-database-backlink-path]')).toHaveText('Team');
  await far.click();

  expect(await page.evaluate(() => window.hostOpened)).toEqual([{ pageId: 'far', title: 'Roadmap', path: ['Team'], blockId: 'x9' }]);
});

test('asks the host again each time the row page opens', async ({ page }) => {
  await mount(page, blocks({ top: false, bravo: false }), true);
  await openRow(page, 'r1');
  await expect(backlinks(page)).toHaveText('1 backlink');

  await page.locator('[data-blok-database-drawer-close]').click();
  await expect(page.locator('[data-blok-database-drawer]')).toBeHidden();
  await openRow(page, 'r1');

  await expect.poll(() => page.evaluate(() => window.hostAsked)).toBe(2);
  await expect(backlinks(page)).toHaveText('1 backlink');
});
