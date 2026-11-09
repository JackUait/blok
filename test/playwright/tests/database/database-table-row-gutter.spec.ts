/**
 * The row gutter ("+", grip, checkbox) sits left of the first column. When the
 * table is narrower than the text column plus that gutter (a side peek narrows
 * the page, or the host is narrow), it must still show and take the pointer.
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

const GUTTER = [
  '[data-blok-database-table-row-add]',
  '[data-blok-database-table-row-handle]',
  '[data-blok-database-table-row-checkbox]',
];

const blocks: OutputBlockData[] = [
  { id: 'above', type: 'paragraph', data: { text: 'Above' } },
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-text', name: 'Text', type: 'text', position: 'a1' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a2' },
        { id: 'p-more', name: 'More', type: 'text', position: 'a3' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-text', 'p-notes', 'p-more'] }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Beta' } } },
] as OutputBlockData[];

/** A host page with a gutter on both sides of the editor, like the playground. */
const mount = async (page: Page, hostWidth: number): Promise<void> => {
  await page.evaluate(async ({ input, width }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = `width:${width}px;margin:40px auto 0`;
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { input: blocks, width: hostWidth });
};

const row = (page: Page, id: string): ReturnType<Page['locator']> =>
  page.locator(`[data-blok-database-table-row][data-row-id="${id}"]`);

const hoverRow = async (page: Page, id: string): Promise<void> => {
  const box = await row(page, id).boundingBox();

  if (box === null) throw new Error(`row ${id} has no box`);
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await expect(row(page, id).locator(GUTTER[0])).toHaveCSS('opacity', '1');
};

/**
 * Each gutter control of the row: how much of it lies outside the visible
 * area its clipping ancestors leave, and whether a click at its centre lands on it.
 */
const gutterReach = (page: Page, id: string): Promise<Array<{ control: string; hiddenPx: number; hit: boolean }>> =>
  page.evaluate(({ rowId, selectors }) => {
    const rowEl = document.querySelector(`[data-blok-database-table-row][data-row-id="${rowId}"]`);

    if (rowEl === null) throw new Error('no row');

    return selectors.map((selector) => {
      const control = rowEl.querySelector(selector);

      if (control === null) throw new Error(`no ${selector}`);
      const box = control.getBoundingClientRect();
      const clip = { left: 0, right: window.innerWidth };

      for (let el = control.parentElement; el !== null; el = el.parentElement) {
        if (getComputedStyle(el).overflowX !== 'visible') {
          const r = el.getBoundingClientRect();

          clip.left = Math.max(clip.left, r.left);
          clip.right = Math.min(clip.right, r.right);
        }
      }
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);

      return {
        control: selector,
        hiddenPx: Math.round(Math.max(0, clip.left - box.left) + Math.max(0, box.right - clip.right)),
        hit: hit !== null && control.contains(hit),
      };
    });
  }, { rowId: id, selectors: GUTTER });

/** Where the first column starts, and where the database title starts. */
const columnAndTitleLeft = (page: Page): Promise<{ column: number; title: number }> =>
  page.evaluate(() => {
    const cell = document.querySelector('[data-blok-database-table-row] [data-blok-database-table-cell]');
    const scroller = document.querySelector('[data-blok-database-table-scroller]');

    if (cell === null || scroller === null) throw new Error('no table');
    const block = scroller.closest('[data-blok-element-content]');

    if (block === null) throw new Error('no block');
    const max = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--max-width-content')) || 720;
    const blockBox = block.getBoundingClientRect();

    return {
      column: Math.round(cell.getBoundingClientRect().left),
      title: Math.round(blockBox.left + Math.max(0, (blockBox.width - max) / 2)),
    };
  });

const expectReachable = async (page: Page, id: string): Promise<void> => {
  const reach = await gutterReach(page, id);

  expect(reach).toEqual(GUTTER.map((control) => ({ control, hiddenPx: 0, hit: true })));
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 717 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('keeps the row gutter visible beside a hovered row while the side peek is open', async ({ page }) => {
  await mount(page, 1000);
  await hoverRow(page, 'r1');
  await row(page, 'r1').locator('[data-blok-database-table-open]').click();
  await expect(page.locator('[data-blok-database-drawer][data-open]')).toBeVisible();

  await hoverRow(page, 'r2');

  await expectReachable(page, 'r2');
  const { column, title } = await columnAndTitleLeft(page);

  expect(column).toBe(title);
});

test('keeps the row gutter visible in a host narrower than the text column', async ({ page }) => {
  await mount(page, 640);
  await hoverRow(page, 'r2');

  await expectReachable(page, 'r2');
  const { column, title } = await columnAndTitleLeft(page);

  expect(column).toBe(title);
});

test('keeps the first column on the text column in a wide host', async ({ page }) => {
  await mount(page, 1200);
  await hoverRow(page, 'r2');

  await expectReachable(page, 'r2');
  const { column, title } = await columnAndTitleLeft(page);

  expect(column).toBe(title);
});
