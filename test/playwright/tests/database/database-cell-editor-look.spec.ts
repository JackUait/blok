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

const mount = async (page: Page, order = ORDER, direction: 'ltr' | 'rtl' = 'ltr'): Promise<void> => {
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async ({ data, direction: dir }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1400px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data }, i18n: { direction: dir } });
    await window.blokInstance.isReady;
  }, { data: blocks(order), direction });
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

// notion-measure12/17-date-edit and notion-measure8/16-time-on: the rows under the grid, top to bottom.
test.describe('date picker rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await mount(page);
  });

  const rows = (page: Page): Promise<string[]> => page.locator('[data-blok-database-date-options]').evaluate((el) =>
    [...el.children].map((row) => (row.textContent ?? '').trim()));

  test('End date, Date format › Full date, Include time, Remind, Clear', async ({ page }) => {
    await open(page, 'p-due');

    expect(await rows(page)).toEqual(['End date', 'Date formatFull date', 'Include time', 'RemindNone', 'Clear']);
  });

  test('a Date format pick saves on the property and keeps the picker open', async ({ page }) => {
    await open(page, 'p-due');
    await page.locator('[data-blok-database-date-setting="dateFormat"]').click();
    await page.getByRole('menuitemradio', { name: 'Day/Month/Year' }).click();

    await expect(page.locator('[data-blok-database-cell-editor]')).toHaveCount(1);
    await expect(page.locator('[data-blok-database-date-setting="dateFormat"]')).toHaveText(/Day\/Month\/Year/);
    const saved = await page.evaluate(async () => {
      const out = await window.blokInstance?.save();
      const db = out?.blocks.find((block) => block.type === 'database');
      const schema = (db?.data as { schema?: Array<{ id: string; date?: { dateFormat?: string } }> } | undefined)?.schema;

      return schema?.find((property) => property.id === 'p-due')?.date?.dateFormat;
    });

    expect(saved).toBe('day_month_year');
    // The picked day shows in the new format once the picker closes.
    await page.locator('[data-blok-database-date-today]').click();
    await close(page);
    const today = await page.evaluate(() => {
      const now = new Date();
      const pad = (n: number): string => String(n).padStart(2, '0');

      return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
    });

    await expect(cell(page, 'p-due')).toHaveText(today);
  });

  test('Include time adds Time format and Time zone, and nothing scrolls inside', async ({ page }) => {
    const { box: before } = await open(page, 'p-due');

    await page.locator('[data-blok-database-date-time-toggle]').click();
    expect(await rows(page)).toEqual(['End date', 'Date formatFull date', 'Include time', 'Time format12 hour', 'Time zoneYour time zone', 'RemindNone', 'Clear']);
    const after = await measure(page);
    const clear = await page.locator('[data-blok-database-date-clear]').boundingBox();

    expect(after.height).toBeGreaterThan(before.height);
    expect((clear?.y ?? Infinity) + (clear?.height ?? 0)).toBeLessThanOrEqual(after.y + after.height);
  });
});

// research/23 §1: the submenus, the checked look, "Now", and the time zone menu.
test.describe('date picker submenus', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await mount(page);
  });

  const picker = (page: Page): Locator => page.locator('[data-blok-database-date-editor]');
  const zoneMenu = (page: Page): Locator => page.locator('[data-blok-database-date-setting-menu="timeZone"]');
  const zoneSearch = (page: Page): Locator => zoneMenu(page).locator('[data-blok-database-date-zone-search]');
  const openZones = async (page: Page): Promise<void> => {
    await open(page, 'p-due');
    await page.locator('[data-blok-database-date-time-toggle]').click();
    await page.locator('[data-blok-database-date-setting="timeZone"]').click();
    await expect(zoneMenu(page)).toBeVisible();
  };

  test('Time format lists Hidden, 12 hour, 24 hour, in that order', async ({ page }) => {
    await open(page, 'p-due');
    await page.locator('[data-blok-database-date-time-toggle]').click();
    await page.locator('[data-blok-database-date-setting="timeFormat"]').click();

    await expect(page.getByRole('menuitemradio')).toHaveText(['Hidden', '12 hour', '24 hour']);
  });

  test('the checked option: a 16px check in primary ink at the end, and no fill', async ({ page }) => {
    await open(page, 'p-due');
    await page.locator('[data-blok-database-date-setting="dateFormat"]').click();
    await page.mouse.move(0, 0);
    const checked = page.getByRole('menuitemradio', { name: 'Full date' });
    const other = page.getByRole('menuitemradio', { name: 'Short date' });
    const look = await checked.evaluate((row) => {
      const svg = row.querySelector('svg');
      const rowBox = row.getBoundingClientRect();
      const svgBox = svg?.getBoundingClientRect();

      return {
        size: [svgBox?.width, svgBox?.height],
        endGap: rowBox.right - (svgBox?.right ?? 0),
        ink: svg === null ? '' : getComputedStyle(svg).color,
        bg: getComputedStyle(row).backgroundColor,
      };
    });
    const plain = await other.evaluate((row) => ({ ink: getComputedStyle(row).color, bg: getComputedStyle(row).backgroundColor }));

    expect(look.size).toEqual([16, 16]);
    expect(look.endGap).toBeLessThanOrEqual(12);
    expect(look.ink).toBe(plain.ink);
    expect(look.bg).toBe(plain.bg);
  });

  test('with Include time on, Today reads Now', async ({ page }) => {
    await open(page, 'p-due');
    await expect(page.locator('[data-blok-database-date-today]')).toHaveText('Today');
    await page.locator('[data-blok-database-date-time-toggle]').click();
    await expect(page.locator('[data-blok-database-date-today]')).toHaveText('Now');
  });

  test('Time zone: a 342px menu left of the picker, a focused search, the current zone pinned on top', async ({ page }) => {
    await openZones(page);
    const menuBox = await zoneMenu(page).boundingBox();
    const pickerBox = await picker(page).boundingBox();

    expect(menuBox?.width).toBe(342);
    expect((menuBox?.x ?? Infinity) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(pickerBox?.x ?? 0);
    await expect(zoneSearch(page)).toBeFocused();
    await expect(zoneSearch(page)).toHaveAttribute('placeholder', 'Search cities, timezones…');
    await expect(zoneMenu(page).locator('[data-blok-database-date-zone-heading]')).toHaveText(['Current timezone', 'Select a timezone']);
    const current = zoneMenu(page).locator('[data-blok-database-date-setting-option="local"]');

    await expect(current).toHaveAttribute('aria-selected', 'true');
    await expect(current.locator('[data-blok-database-date-zone-offset]')).toHaveText(/^GMT/);
    expect((await current.boundingBox())?.height).toBe(45);
    // The list scrolls; the search stays put.
    await zoneMenu(page).locator('[data-blok-database-date-zone-list]').evaluate((el) => el.scrollTo({ top: 400 }));
    await expect(zoneSearch(page)).toBeInViewport();
  });

  test('Time zone: typing filters, "No results" when nothing matches, arrows and Enter pick', async ({ page }) => {
    await openZones(page);
    await page.keyboard.type('zzqx');
    await expect(zoneMenu(page).locator('[data-blok-database-date-zone-empty]')).toHaveText('No results');
    // research/23 §1: a zero offset reads "GMT" (Chromium's longOffset says "GMT+00:00").
    await zoneSearch(page).fill('abidjan');
    await expect(zoneMenu(page).locator('[data-blok-database-date-setting-option="Africa/Abidjan"] [data-blok-database-date-zone-offset]')).toHaveText('GMT');
    await zoneSearch(page).fill('');
    await page.keyboard.type('tokyo');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(zoneMenu(page).locator('[data-active]')).toHaveAttribute('data-blok-database-date-setting-option', 'Asia/Tokyo');
    await page.keyboard.press('Enter');

    await expect(zoneMenu(page)).toHaveCount(0);
    await expect(picker(page)).toHaveCount(1);
    await expect(page.locator('[data-blok-database-date-setting="timeZone"]')).toHaveText(/Asia\/Tokyo/);
  });

  test('Time zone in RTL opens on the right of the picker', async ({ page }) => {
    await mount(page, ORDER, 'rtl');
    await openZones(page);
    const menuBox = await zoneMenu(page).boundingBox();
    const pickerBox = await picker(page).boundingBox();

    expect(menuBox?.x ?? 0).toBeGreaterThanOrEqual((pickerBox?.x ?? Infinity) + (pickerBox?.width ?? 0));
  });

  test('Escape closes only the time zone menu', async ({ page }) => {
    await openZones(page);
    await page.keyboard.press('Escape');

    await expect(zoneMenu(page)).toHaveCount(0);
    await expect(picker(page)).toHaveCount(1);
  });
});

test('near the right edge the box slides left to stay on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 717 });
  await mount(page, ['p-title', 'p-amount', 'p-link', 'p-stage', 'p-notes']);
  const { box: measured } = await open(page, 'p-notes');

  expect(measured.width).toBe(240);
  expect(measured.x + measured.width).toBeLessThanOrEqual(1000);
});
