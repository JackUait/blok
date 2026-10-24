/**
 * Block navigation past a database (findings-darkkeys K09): the row blocks the
 * database keeps in its hidden pool are never selected.
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
      ],
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Beta' } } },
  { id: 'below', type: 'paragraph', data: { text: 'Below' } },
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

const selectedBlocks = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('[data-blok-selected="true"]')].map((el) => el.getAttribute('data-blok-id') ?? ''));

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('ArrowDown steps from the database to the block below, not into a hidden row', async ({ page }) => {
  await mount(page, blocks({ type: 'list' }));
  await page.getByText('Above', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  expect(await selectedBlocks(page)).toEqual(['db-1']);
  await page.keyboard.press('ArrowDown');

  expect(await selectedBlocks(page)).toEqual(['below']);
});

test('ArrowUp from the block below selects the database, not a hidden row', async ({ page }) => {
  await mount(page, blocks({ type: 'list' }));
  await page.getByText('Below', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowUp');

  expect(await selectedBlocks(page)).toEqual(['db-1']);
});
