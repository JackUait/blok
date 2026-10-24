/**
 * Core childTools enforcement in a real browser (2bcf738a): a database takes
 * only rows, sources and its layout tabs, so Tab and a deep drop next to one
 * leave the block at root. A tabs block takes only tabs (and owns them).
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData, OutputData } from '@/types';
import { DATA_ATTR, createSelector } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const INDENT_PER_LEVEL = 27;
const SETTINGS_BUTTON = `${createSelector(DATA_ATTR.interface)} [data-blok-testid="settings-toggler"]`;

const database = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: [{ id: 'p-title', name: 'Name', type: 'title', position: 'a0' }],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', title: 'Alpha', properties: { 'p-title': 'Alpha' } } },
] as OutputBlockData[];

const mount = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
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
};

const save = (page: Page): Promise<OutputData | undefined> => page.evaluate(() => window.blokInstance?.save());

const savedBlock = async (page: Page, id: string): Promise<OutputBlockData | undefined> =>
  (await save(page))?.blocks.find((block) => block.id === id);

const pressTabAtEnd = async (page: Page, text: string): Promise<void> => {
  const editable = page.locator('[contenteditable="true"]', { hasText: text });

  await editable.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('Tab on the paragraph right after a database does not nest it', async ({ page }) => {
  await mount(page, [...database(), { id: 'after', type: 'paragraph', data: { text: 'After the database' } }] as OutputBlockData[]);
  await expect(page.getByRole('grid')).toBeVisible();

  await pressTabAtEnd(page, 'After the database');

  expect((await savedBlock(page, 'after'))?.parent ?? null).toBeNull();
  expect((await savedBlock(page, 'db-1'))?.content).toEqual(['r1']);
});

test('Tab after editing the database title leaves the database where it is', async ({ page }) => {
  await mount(page, [{ id: 'above', type: 'paragraph', data: { text: 'Above' } }, ...database()] as OutputBlockData[]);
  await expect(page.getByRole('grid')).toBeVisible();

  await page.locator('[data-blok-database-title]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-blok-database-title]')).not.toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');

  expect((await savedBlock(page, 'db-1'))?.parent ?? null).toBeNull();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('Tab after clicking a divider still nests it under the block above', async ({ page }) => {
  await mount(page, [
    { id: 'above', type: 'paragraph', data: { text: 'Above' } },
    { id: 'hr', type: 'divider', data: {} },
  ] as OutputBlockData[]);
  await page.locator('[contenteditable="true"]', { hasText: 'Above' }).click();
  await page.keyboard.press('End');
  await page.locator(`[data-blok-id="hr"]`).click();
  await page.keyboard.press('Tab');

  expect((await savedBlock(page, 'hr'))?.parent).toBe('above');
});

test('Tab on the paragraph right after a tabs block does not nest it', async ({ page }) => {
  await mount(page, [
    { id: 'tabs1', type: 'tabs', data: {}, content: ['t1'] },
    { id: 't1', type: 'tab', data: { title: 'Alpha' }, parent: 'tabs1', content: ['p1'] },
    { id: 'p1', type: 'paragraph', data: { text: 'Alpha body' }, parent: 't1' },
    { id: 'after', type: 'paragraph', data: { text: 'After the tabs' } },
  ] as OutputBlockData[]);
  await expect(page.getByRole('tab', { name: 'Alpha', exact: true })).toBeVisible();

  await pressTabAtEnd(page, 'After the tabs');

  // childTools allows only "tab" and the block owns its children: no tab, no paragraph.
  expect((await savedBlock(page, 'after'))?.parent ?? null).toBeNull();
  expect((await savedBlock(page, 'tabs1'))?.content).toEqual(['t1']);
});

test('a list dropped at a deeper indent right below a database stays at root', async ({ page }) => {
  await mount(page, [
    ...database(),
    { id: 'below', type: 'paragraph', data: { text: 'Below' } },
    { id: 'item', type: 'list', data: { text: 'Drag me', style: 'unordered' } },
  ] as OutputBlockData[]);
  await expect(page.getByRole('grid')).toBeVisible();

  const item = page.getByTestId('block-wrapper').filter({ hasText: 'Drag me' });
  const below = page.getByTestId('block-wrapper').filter({ hasText: 'Below' });

  await item.hover();
  const handle = page.locator(SETTINGS_BUTTON);

  await expect(handle).toBeVisible();
  const source = await handle.boundingBox();
  const target = await below.boundingBox();
  const contentLeft = await below.locator('[data-blok-element-content]').evaluate((el) => el.getBoundingClientRect().left);

  if (source === null || target === null) {
    throw new Error('no box');
  }
  // Top edge of "Below": the block above the gap is the database.
  const dropY = target.y + 1;

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, dropY, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') === 'true');
  await page.mouse.move(contentLeft + Math.round(1.3 * INDENT_PER_LEVEL), dropY, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('[data-blok-interface=blok]')?.getAttribute('data-blok-dragging') !== 'true');

  const saved = await save(page);
  const ids = saved?.blocks.map((block) => block.id) ?? [];

  expect(saved?.blocks.find((block) => block.id === 'item')?.parent ?? null).toBeNull();
  expect(saved?.blocks.find((block) => block.id === 'db-1')?.content).toEqual(['r1']);
  // The drop did happen: the list moved above "Below".
  expect(ids.indexOf('item')).toBeLessThan(ids.indexOf('below'));
});
