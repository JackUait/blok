/**
 * Table cell editors look like Notion's (research/22 §4): a box over the cell
 * at its top-left minus 1px, radius 6px, the menu shadow, no ring. Text grows
 * downward; select is 300 wide; date is 248 wide and never scrolls inside.
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

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a2' },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a3' },
  { id: 'p-stage', name: 'Stage', type: 'select', position: 'a4', config: { options: [{ id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' }] } },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a5' },
];

const blocks = (order: string[]): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{
        id: 'v1',
        name: 'Table',
        type: 'table',
        position: 'a0',
        sorts: [],
        filters: [],
        visibleProperties: [],
        properties: order.map((id) => ({ id, visible: true, width: id === 'p-title' ? 280 : 200 })),
      }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-notes': 'short' } } },
];

const SHADOW = {
  light: 'rgba(25, 25, 25, 0.05) 0px 20px 24px 0px, rgba(25, 25, 25, 0.027) 0px 5px 8px 0px, rgba(42, 28, 0, 0.07) 0px 0px 0px 1px',
  dark: 'rgb(56, 56, 54) 0px 0px 0px 1px, rgba(25, 25, 25, 0.2) 0px 14px 28px -6px, rgba(25, 25, 25, 0.118) 0px 2px 4px -1px',
};
const BG = { light: 'rgb(255, 255, 255)', dark: 'rgb(37, 37, 37)' };

const ORDER = ['p-title', 'p-notes', 'p-amount', 'p-link', 'p-stage', 'p-due'];

const mount = async (page: Page, order = ORDER): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1400px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, blocks(order));
  await expect(page.getByRole('grid').first()).toBeVisible();
};

const cell = (page: Page, propertyId: string): Locator => page.locator(`[role="gridcell"][data-property-id="${propertyId}"]`);
const box = (page: Page): Locator => page.locator('[data-blok-popover-container]:has([data-blok-database-cell-editor])');
const input = (page: Page): Locator => page.locator('[data-blok-database-cell-editor] [data-blok-database-cell-input]');

interface Measured {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: string;
  shadow: string;
  bg: string;
  padding: string;
}

const measure = async (page: Page): Promise<Measured> => box(page).evaluate((el) => {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    radius: style.borderRadius,
    shadow: style.boxShadow,
    bg: style.backgroundColor,
    padding: style.padding,
  };
});

const open = async (page: Page, propertyId: string): Promise<{ cell: { x: number; y: number }; box: Measured }> => {
  await cell(page, propertyId).click();
  if (await box(page).count() === 0) {
    await page.keyboard.press('Enter');
  }
  await expect(box(page)).toBeVisible();
  // The open motion scales the box: wait until it is at full size.
  await expect.poll(async () => box(page).evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  const rect = await cell(page, propertyId).boundingBox();

  return { cell: { x: rect?.x ?? 0, y: rect?.y ?? 0 }, box: await measure(page) };
};

const close = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-blok-database-cell-editor]')).toHaveCount(0);
};

test.beforeAll(ensureBlokBundleBuilt);

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`${scheme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1512, height: 717 });
      await mount(page);
    });

    test('text: a 240x39 box over the cell, radius 6px, the menu shadow, padding 8px 9px, no ring', async ({ page }) => {
      const { cell: at, box: measured } = await open(page, 'p-notes');

      expect(measured.width).toBe(240);
      expect(measured.height).toBe(39);
      expect(Math.abs(measured.x - (at.x - 1))).toBeLessThan(0.5);
      expect(Math.abs(measured.y - (at.y - 1))).toBeLessThan(0.5);
      expect(measured.radius).toBe('6px');
      expect(measured.shadow).toBe(SHADOW[scheme]);
      expect(measured.bg).toBe(BG[scheme]);
      expect(measured.padding).toBe('0px');
      await expect(input(page)).toHaveCSS('padding', '8px 9px');
      await expect(input(page)).toHaveCSS('line-height', '21px');
      await expect(input(page)).toHaveCSS('white-space', 'break-spaces');
      await expect(input(page)).toHaveCSS('outline-style', 'none');
      await expect(input(page)).toHaveCSS('box-shadow', 'none');
    });

    test('text grows downward as you type: 79px for three lines, top unchanged', async ({ page }) => {
      const { box: before } = await open(page, 'p-notes');

      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('two');
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.type('three');

      await expect.poll(async () => (await measure(page)).height).toBe(79);
      expect((await measure(page)).y).toBe(before.y);
    });

    test('a keyboard open draws no ring either', async ({ page }) => {
      await cell(page, 'p-notes').click();
      await close(page);
      await page.keyboard.press('Enter');
      await expect(box(page)).toBeVisible();
      await expect(input(page)).toHaveCSS('outline-style', 'none');
      await expect(input(page)).toHaveCSS('box-shadow', 'none');
      await expect(box(page)).toHaveCSS('box-shadow', SHADOW[scheme]);
    });

    test('url: 240x39; title: as wide as its 280px cell', async ({ page }) => {
      const link = await open(page, 'p-link');

      expect([link.box.width, link.box.height]).toEqual([240, 39]);
      await close(page);

      const title = await open(page, 'p-title');

      expect([title.box.width, title.box.height]).toEqual([280, 39]);
      expect(Math.abs(title.box.x - (title.cell.x - 1))).toBeLessThan(0.5);
    });

    test('number: 240x38, right-aligned', async ({ page }) => {
      const { cell: at, box: measured } = await open(page, 'p-amount');

      expect([measured.width, measured.height]).toEqual([240, 38]);
      expect(Math.abs(measured.y - (at.y - 1))).toBeLessThan(0.5);
      await expect(input(page)).toHaveCSS('text-align', 'end');
    });

    test('select: a 300px box over the cell with the same chrome', async ({ page }) => {
      // Away from the right edge, where a 300px box would slide left.
      await mount(page, ['p-title', 'p-stage', 'p-notes']);
      const { cell: at, box: measured } = await open(page, 'p-stage');

      expect(measured.width).toBe(300);
      expect(Math.abs(measured.x - (at.x - 1))).toBeLessThan(0.5);
      expect(Math.abs(measured.y - (at.y - 1))).toBeLessThan(0.5);
      expect(measured.radius).toBe('6px');
      expect(measured.shadow).toBe(SHADOW[scheme]);
      expect(measured.padding).toBe('0px');
    });

    test('date: 248 wide, every row shown without an inner scrollbar, inside the viewport', async ({ page }) => {
      const { cell: at, box: measured } = await open(page, 'p-due');

      expect(measured.width).toBe(248);
      // Nothing between the editor and the box scrolls, and the last row is inside the box.
      const scrolling = await page.locator('[data-blok-database-cell-editor]').evaluate((el) => {
        const found: string[] = [];

        for (let node: Element | null = el; node !== null; node = node.parentElement) {
          if (node.scrollHeight > node.clientHeight) found.push([...node.attributes].map((a) => a.name).join(' '));
          if (node.hasAttribute('data-blok-popover-container')) break;
        }

        return found;
      });

      expect(scrolling).toEqual([]);
      const clear = await page.locator('[data-blok-database-date-clear]').boundingBox();

      expect((clear?.y ?? Infinity) + (clear?.height ?? 0)).toBeLessThanOrEqual(measured.y + measured.height);
      expect(Math.abs(measured.x - (at.x - 1))).toBeLessThan(0.5);
      expect(measured.y + measured.height).toBeLessThanOrEqual(717);
      expect(measured.radius).toBe('6px');
      expect(measured.shadow).toBe(SHADOW[scheme]);
    });
  });
}

test('near the right edge the box slides left to stay on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 717 });
  await mount(page, ['p-title', 'p-amount', 'p-link', 'p-stage', 'p-notes']);
  const { box: measured } = await open(page, 'p-notes');

  expect(measured.width).toBe(240);
  expect(measured.x + measured.width).toBeLessThanOrEqual(1000);
});
