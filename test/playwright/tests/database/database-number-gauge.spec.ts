/**
 * A Number shown as Bar or Ring draws its gauge after the value in every
 * place the value shows: table cell, row page, board, gallery and list cards.
 * Sizes and colours: notion-spec-2 §7.
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
  { id: 'p-bar', name: 'Done', type: 'number', position: 'a1', number: { showAs: 'bar', color: 'green', divideBy: 100 } },
  { id: 'p-ring', name: 'Score', type: 'number', position: 'a2', number: { showAs: 'ring', color: 'red', divideBy: 100 } },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a3',
    config: { options: [ { id: 'o-plan', label: 'Plan', color: 'blue', position: 'a0' } ] },
  },
  { id: 'p-plain', name: 'Plain', type: 'number', position: 'a4', number: { showAs: 'ring', divideBy: 100 } },
  { id: 'p-formula', name: 'Twice', type: 'formula', position: 'a5', formula: { expression: '{{property:p-bar}} * 2' }, number: { showAs: 'ring', color: 'green', divideBy: 100 } },
  { id: 'p-num', name: 'Amount', type: 'number', position: 'a8' },
  { id: 'p-calc', name: 'Calc', type: 'formula', position: 'a9', formula: { expression: '{{property:p-bar}} + 2429' } },
  { id: 'p-link', name: 'Link', type: 'relation', position: 'a6', relation: { targetDatabaseId: 'db-1' } },
  { id: 'p-sum', name: 'Sum', type: 'rollup', position: 'a7', rollup: { relationPropertyId: 'p-link', targetPropertyId: 'p-bar', function: 'sum' }, number: { showAs: 'bar', color: 'green', divideBy: 100 } },
  { id: 'p-quiet-bar', name: 'Quiet bar', type: 'number', position: 'b0', number: { showAs: 'bar', color: 'yellow', divideBy: 100, showNumber: false } },
  { id: 'p-quiet-ring', name: 'Quiet ring', type: 'number', position: 'b1', number: { showAs: 'ring', color: 'yellow', divideBy: 100, showNumber: false } },
  { id: 'p-quiet-fx', name: 'Quiet formula', type: 'formula', position: 'b2', formula: { expression: '{{property:p-bar}} * 2' }, number: { showAs: 'ring', divideBy: 100, showNumber: false } },
  { id: 'p-quiet-sum', name: 'Quiet sum', type: 'rollup', position: 'b3', rollup: { relationPropertyId: 'p-link', targetPropertyId: 'p-bar', function: 'sum' }, number: { showAs: 'bar', divideBy: 100, showNumber: false } },
  { id: 'p-total', name: 'Total', type: 'rollup', position: 'b4', rollup: { relationPropertyId: 'p-link', targetPropertyId: 'p-num', function: 'sum' }, number: { format: 'euro' } },
  { id: 'p-filled', name: 'Filled', type: 'rollup', position: 'b5', rollup: { relationPropertyId: 'p-link', targetPropertyId: 'p-num', function: 'percent_not_empty' } },
  { id: 'p-list', name: 'List', type: 'rollup', position: 'b6', rollup: { relationPropertyId: 'p-link', targetPropertyId: 'p-bar', function: 'show_original' }, number: { showAs: 'bar', color: 'green' } },
];

const QUIET = [ 'p-quiet-bar', 'p-quiet-ring', 'p-quiet-fx', 'p-quiet-sum' ];

const blocks = (view: Record<string, unknown>, visible = [ 'p-bar', 'p-ring' ]): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [ { id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: visible, ...view } ],
      activeViewId: 'v1',
    },
    content: [ 'r1' ],
  },
  {
    id: 'r1',
    type: 'database-row',
    parent: 'db-1',
    data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-bar': 40, 'p-ring': 40, 'p-plain': 40, 'p-quiet-bar': 40, 'p-quiet-ring': 40, 'p-num': 2469, 'p-stage': 'o-plan', 'p-link': [ { id: 'r1' } ] } },
  },
];

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ input }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { input: data });
};

interface GaugeBox {
  width: number;
  height: number;
  /** Space between the number's end and the gauge's start. */
  gap: number;
  /** The gauge's end to its container's content end. */
  toEnd: number;
  /** The number's start to its container's content start. */
  fromStart: number;
}

/** `container` names the ancestor whose content box the gauge lines up with. */
const measure = async (gauge: Locator, container: string): Promise<GaugeBox> => {
  await expect(gauge).toBeVisible();

  return gauge.evaluate((el, selector) => {
    const rect = el.getBoundingClientRect();
    const text = el.parentElement?.querySelector('[data-blok-database-number-text]')?.getBoundingClientRect();
    const box = el.closest(selector);

    if (text === undefined || box === null) throw new Error('no number or container');
    const style = getComputedStyle(box);
    const outer = box.getBoundingClientRect();
    const round = (n: number): number => Math.round(n * 10) / 10;

    return {
      width: round(rect.width),
      height: round(rect.height),
      gap: round(rect.left - text.right),
      toEnd: round(outer.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth) - rect.right),
      fromStart: round(text.left - outer.left - parseFloat(style.paddingLeft) - parseFloat(style.borderLeftWidth)),
    };
  }, container);
};

/** The bar's fill and track, and the ring's arc and track. */
const colours = async (gauge: Locator): Promise<{ fill: string; track: string }> => gauge.evaluate((el) => {
  const arc = el.querySelector('[data-blok-database-number-ring-arc]');
  const track = el.querySelector('[data-blok-database-number-ring-track]');

  if (arc !== null && track !== null) return { fill: getComputedStyle(arc).stroke, track: getComputedStyle(track).stroke };

  return { fill: getComputedStyle(el, '::before').backgroundColor, track: getComputedStyle(el).backgroundColor };
});

const BAR = '[data-blok-database-number-bar]';
const RING = '[data-blok-database-number-ring]';
const GREEN = 'rgb(70, 161, 113)';
/** Notion's yellow, rgb(216, 163, 47), is 2.28:1 on white; light takes the first 3:1 step of its hue. */
const YELLOW = { light: 'rgb(189, 141, 35)', dark: 'rgb(216, 163, 47)' };
const RED = 'rgb(229, 100, 88)';

const THEMES = [
  { name: 'light' as const, track: 'rgba(42, 28, 0, 0.07)', defaultFill: 'rgb(56, 56, 54)' },
  { name: 'dark' as const, track: 'rgba(255, 255, 235, 0.1)', defaultFill: 'rgb(230, 229, 227)' },
];

const openPeek = async (page: Page): Promise<Locator> => {
  const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
  const drawer = page.locator('[data-blok-database-drawer]');

  await expect(drawer).toHaveCSS('transform', 'none');

  return drawer;
};

const peekValue = (drawer: Locator, id: string): Locator => drawer.locator(`[data-blok-database-drawer-prop-value][data-property-id="${id}"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    await window.blokInstance?.destroy?.();
    window.blokInstance = undefined;
  });
  await page.emulateMedia({ colorScheme: null });
});

/** Where the cell's text sits in its container's content box, and its numeral style. */
const textPlace = async (value: Locator, container: string): Promise<{ fromStart: number; toEnd: number; numeric: string }> => {
  await expect(value).toBeVisible();

  return value.evaluate((el, selector) => {
    const range = document.createRange();

    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const box = el.closest(selector);

    if (box === null) throw new Error('no container');
    const style = getComputedStyle(box);
    const outer = box.getBoundingClientRect();
    const round = (n: number): number => Math.round(n * 10) / 10;

    return {
      fromStart: round(text.left - outer.left - parseFloat(style.paddingLeft) - parseFloat(style.borderLeftWidth)),
      toEnd: round(outer.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth) - text.right),
      numeric: getComputedStyle(el).fontVariantNumeric,
    };
  }, container);
};

// notion-spec-2 §14.9: a numeric rollup sits at the table cell's end in tabular figures, and at the start of the side peek in plain ones.
test('a numeric rollup is right aligned with tabular figures in the table, left aligned in the side peek', async ({ page }) => {
  await mount(page, blocks({ type: 'table' }, [ 'p-total', 'p-filled' ]));
  const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

  for (const id of [ 'p-total', 'p-filled' ]) {
    const cell = row.locator(`[data-blok-database-table-cell][data-property-id="${id}"]`).locator('[data-blok-database-cell]').first();
    const place = await textPlace(cell, '[data-blok-database-table-cell]');

    expect(Math.abs(place.toEnd)).toBeLessThanOrEqual(0.5);
    expect(place.numeric).toBe('lining-nums tabular-nums');
  }
  await expect(row.locator('[data-blok-database-table-cell][data-property-id="p-total"]')).toHaveText('€2,469.00');
  await expect(row.locator('[data-blok-database-table-cell][data-property-id="p-filled"]')).toHaveText('100%');
  const drawer = await openPeek(page);

  for (const id of [ 'p-total', 'p-filled' ]) {
    const place = await textPlace(peekValue(drawer, id).locator('[data-blok-database-cell]'), '[data-blok-database-drawer-prop-value]');

    expect(Math.abs(place.fromStart)).toBeLessThanOrEqual(0.5);
    expect(place.numeric).toBe('normal');
  }
});

for (const theme of THEMES) {
  test.describe(`number gauge, ${theme.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme.name });
    });

    test('a table cell draws the number, then the gauge 8px after it, at Notion\'s size', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');
      const bar = await measure(row.locator(BAR), '[data-blok-database-table-cell]');
      const ring = await measure(row.locator(RING), '[data-blok-database-table-cell]');

      expect(bar.gap).toBe(8);
      expect(bar.height).toBe(4);
      // The bar fills the cell up to 160, never under 48.
      expect(bar.width).toBeGreaterThanOrEqual(48);
      expect(bar.width).toBeLessThanOrEqual(160);
      expect(bar.width === 160 || Math.abs(bar.toEnd) <= 0.5).toBe(true);
      expect(ring).toMatchObject({ width: 21, height: 21, gap: 8 });
      // The ring sits at the cell's end.
      expect(Math.abs(ring.toEnd)).toBeLessThanOrEqual(0.5);
      // The gauge must not grow the 37px row.
      expect(Math.round((await row.boundingBox())?.height ?? 0)).toBe(37);
    });

    test('the gauges use Notion\'s fill and track colours', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }, [ 'p-bar', 'p-ring', 'p-plain' ]));
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

      expect(await colours(row.locator(`[data-blok-database-table-cell][data-property-id="p-bar"] ${BAR}`))).toEqual({ fill: GREEN, track: theme.track });
      expect(await colours(row.locator(`[data-blok-database-table-cell][data-property-id="p-ring"] ${RING}`))).toEqual({ fill: RED, track: theme.track });
      expect(await colours(row.locator(`[data-blok-database-table-cell][data-property-id="p-plain"] ${RING}`))).toEqual({ fill: theme.defaultFill, track: theme.track });
    });

    test('the row page draws the number, then the gauge, from the start of the value', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      const drawer = await openPeek(page);
      const bar = await measure(peekValue(drawer, 'p-bar').locator(BAR), '[data-blok-database-drawer-prop-value]');
      const ring = await measure(peekValue(drawer, 'p-ring').locator(RING), '[data-blok-database-drawer-prop-value]');

      expect(bar).toMatchObject({ width: 160, height: 4, gap: 8 });
      expect(ring).toMatchObject({ width: 21, height: 21, gap: 8 });
      expect(Math.abs(bar.fromStart)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(ring.fromStart)).toBeLessThanOrEqual(0.5);
    });

    // notion-spec-2 §15.4: a rollup list's bars keep the Number track, rgba(255,255,235,0.1) in dark.
    test('a rollup list draws its bars on the Number track', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }, [ 'p-list' ]));
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

      expect(await colours(row.locator(`[data-blok-database-table-cell][data-property-id="p-list"] ${BAR}`))).toEqual({ fill: GREEN, track: theme.track });
    });

    test('a number formula and a number rollup draw their gauge in the table and the row page', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }, [ 'p-formula', 'p-sum' ]));
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

      await expect(row.locator(`[data-blok-database-table-cell][data-property-id="p-formula"] ${RING}`)).toBeVisible();
      await expect(row.locator(`[data-blok-database-table-cell][data-property-id="p-sum"] ${BAR}`)).toBeVisible();
      const drawer = await openPeek(page);

      expect(await measure(peekValue(drawer, 'p-formula').locator(RING), '[data-blok-database-drawer-prop-value]')).toMatchObject({ width: 21, height: 21, gap: 8 });
      expect(await measure(peekValue(drawer, 'p-sum').locator(BAR), '[data-blok-database-drawer-prop-value]')).toMatchObject({ width: 160, height: 4, gap: 8 });
    });

    // notion-spec-2 §10: Show number off draws the gauge alone. Notion keeps a table Ring at the cell's end.
    test('Show number off draws only the gauge, in the table, the row page and a formula or rollup', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }, QUIET));
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');
      const drawer = await openPeek(page);

      for (const scope of [ row.locator('[data-blok-database-table-cell]'), drawer.locator('[data-blok-database-drawer-prop-value]') ]) {
        for (const id of QUIET) {
          const value = scope.and(page.locator(`[data-property-id="${id}"]`));

          await expect(value.locator(`${id.endsWith('ring') || id.endsWith('fx') ? RING : BAR}`)).toBeVisible();
          await expect(value.locator('[data-blok-database-number-text]')).toHaveCount(0);
        }
      }
      // With no text beside it, the gauge carries the value.
      await expect(row.locator('[data-blok-database-table-cell][data-property-id="p-quiet-ring"]').getByRole('img', { name: '40' })).toBeVisible();

      const edges = await row.locator(`[data-blok-database-table-cell][data-property-id="p-quiet-ring"] ${RING}`).evaluate((el) => {
        const cell = el.closest('[data-blok-database-table-cell]');

        if (cell === null) throw new Error('no cell');
        const style = getComputedStyle(cell);

        return Math.round((cell.getBoundingClientRect().right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth) - el.getBoundingClientRect().right) * 10) / 10;
      });

      expect(Math.abs(edges)).toBeLessThanOrEqual(0.5);
      const peekStart = await peekValue(drawer, 'p-quiet-bar').locator(BAR).evaluate((el) => {
        const value = el.closest('[data-blok-database-drawer-prop-value]');

        if (value === null) throw new Error('no value');
        const style = getComputedStyle(value);

        return Math.round((el.getBoundingClientRect().left - value.getBoundingClientRect().left - parseFloat(style.paddingLeft) - parseFloat(style.borderLeftWidth)) * 10) / 10;
      });

      expect(Math.abs(peekStart)).toBeLessThanOrEqual(0.5);
    });

    test('a yellow gauge is drawn in the 3:1 yellow', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }, [ 'p-quiet-bar', 'p-quiet-ring' ]));
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

      expect((await colours(row.locator(BAR))).fill).toBe(YELLOW[theme.name]);
      expect((await colours(row.locator(RING))).fill).toBe(YELLOW[theme.name]);
    });

    test('Show number on the row page panel takes the number away and brings it back', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      const drawer = await openPeek(page);
      const cell = page.locator('[data-blok-database-table-cell][data-property-id="p-bar"]');

      await drawer.locator('[data-blok-database-drawer-prop-label][data-property-id="p-bar"]').click();
      await page.locator('[data-blok-popover-opened="true"]').getByRole('menuitem', { name: 'Edit property' }).click();
      const toggle = page.locator('[data-blok-popover-opened="true"]').getByRole('switch', { name: 'Show number' });

      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      // notion-spec-2 §2: the box is 234 wide, 12 + three 28px rows 8px apart + 12 tall.
      // The panel opens with a scale; measure after it settles.
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
      const box = await page.locator('[data-blok-popover-opened="true"]').evaluate((menu) => {
        const color = menu.querySelector('[data-blok-item-name="color"]')?.getBoundingClientRect();
        const show = menu.querySelector('[data-blok-item-name="showNumber"]')?.getBoundingClientRect();
        const row = menu.querySelector('[role="switch"]')?.getBoundingClientRect();

        if (color === undefined || show === undefined || row === undefined) throw new Error('no gauge box');

        return { width: Math.round(show.width), height: Math.round(show.bottom - (color.top - 12)), row: Math.round(row.height), colorWidth: Math.round(color.width) };
      });

      expect(box).toEqual({ width: 234, height: 124, row: 28, colorWidth: 234 });

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(cell.locator('[data-blok-database-number-text]')).toHaveCount(0);
      await expect(peekValue(drawer, 'p-bar').locator('[data-blok-database-number-text]')).toHaveCount(0);
      await expect(peekValue(drawer, 'p-bar').locator(BAR)).toBeVisible();

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(cell.locator('[data-blok-database-number-text]')).toHaveText('40');
      await expect(peekValue(drawer, 'p-bar').locator('[data-blok-database-number-text]')).toHaveText('40');
    });

    test('Show number in the column header\'s Edit property submenu toggles by click and by Space', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }));
      const cell = page.locator('[data-blok-database-table-cell][data-property-id="p-bar"]');

      await page.getByRole('columnheader', { name: 'Done' }).click();
      await page.locator('[data-blok-popover-opened="true"]').getByRole('menuitem', { name: 'Edit property' }).click();
      const toggle = page.getByRole('switch', { name: 'Show number' });

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(toggle).toBeVisible();
      await expect(cell.locator('[data-blok-database-number-text]')).toHaveCount(0);

      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(cell.locator('[data-blok-database-number-text]')).toHaveText('40');
    });

    for (const id of [ 'p-num', 'p-calc' ]) {
      test(`choosing Ring for a ${id === 'p-num' ? 'number' : 'number formula'} on the row page draws it there`, async ({ page }) => {
        await mount(page, blocks({ type: 'table' }, [ 'p-num', 'p-calc' ]));
        const drawer = await openPeek(page);

        await drawer.locator(`[data-blok-database-drawer-prop-label][data-property-id="${id}"]`).click();
        await page.locator('[data-blok-popover-opened="true"]').getByRole('menuitem', { name: 'Edit property' }).click();
        await page.locator('[data-blok-popover-opened="true"]').getByRole('radio', { name: 'Ring' }).click();
        await expect(page.locator(`[data-blok-database-table-cell][data-property-id="${id}"] ${RING}`)).toBeVisible();
        await expect(peekValue(drawer, id).locator(RING)).toBeVisible();
      });
    }

    for (const view of [ { type: 'board', groupBy: 'p-stage' }, { type: 'gallery' }, { type: 'list' } ]) {
      test(`a ${view.type} card draws only the gauge when Show number is off`, async ({ page }) => {
        await mount(page, blocks(view, [ 'p-quiet-bar', 'p-quiet-ring' ]));
        const scope = page.locator('[data-blok-id="db-1"]');

        await expect(scope.locator(BAR).first()).toBeVisible();
        await expect(scope.locator(RING).first()).toBeVisible();
        await expect(scope.locator('[data-blok-database-number-text]')).toHaveCount(0);
      });
    }

    // notion-spec-2 §16.3: on a board or gallery card the bar fills the line and the ring is 18px. A list row was not measured.
    for (const { ring: ringSize, barMax, ...view } of [
      { type: 'board', groupBy: 'p-stage', ring: 18, barMax: Infinity },
      { type: 'gallery', ring: 18, barMax: Infinity },
      { type: 'list', ring: 21, barMax: 160 },
    ]) {
      test(`a ${view.type} card draws the gauge as the row page does`, async ({ page }) => {
        await mount(page, blocks(view));
        const scope = page.locator('[data-blok-id="db-1"]');
        const bar = await measure(scope.locator(BAR).first(), '[data-blok-database-cell]');
        const ring = await measure(scope.locator(RING).first(), '[data-blok-database-cell]');

        expect(bar).toMatchObject({ height: 4, gap: 8 });
        expect(bar.width).toBeGreaterThanOrEqual(48);
        expect(bar.width).toBeLessThanOrEqual(barMax);
        expect(ring).toMatchObject({ width: ringSize, height: ringSize, gap: 8 });
        // Nothing of the number or its gauge is clipped by the card's slot.
        for (const gauge of [ BAR, RING ]) {
          const clipped = await scope.locator(gauge).first().evaluate((el) => {
            const text = el.parentElement?.querySelector('[data-blok-database-number-text]');
            let clip = el.parentElement;

            while (clip !== null && getComputedStyle(clip).overflowX === 'visible') clip = clip.parentElement;
            if (text === null || text === undefined || clip === null) return null;
            const box = clip.getBoundingClientRect();

            return text.getBoundingClientRect().left < box.left - 0.5 || el.getBoundingClientRect().right > box.right + 0.5;
          });

          expect(clipped).toBe(false);
        }
      });
    }
  });
}

/** notion-spec-2 §14.3 and §14.11: a card with Show number off, and two rollup items on a card. */
const CARD_SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-stage', name: 'Stage', type: 'select', position: 'a1', config: { options: [ { id: 'o-plan', label: 'Plan', color: 'blue', position: 'a0' } ] } },
  { id: 'p-link', name: 'Link', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db-1' } },
  { id: 'p-num', name: 'Num', type: 'number', position: 'a3' },
  { id: 'p-list', name: 'List', type: 'rollup', position: 'a4', rollup: { relationPropertyId: 'p-link', targetPropertyId: 'p-num', function: 'show_original' }, number: { showAs: 'ring', color: 'green', divideBy: 100 } },
  { id: 'p-quiet-bar', name: 'Quiet bar', type: 'number', position: 'b0', number: { showAs: 'bar', color: 'green', divideBy: 100, showNumber: false } },
  { id: 'p-quiet-ring', name: 'Quiet ring', type: 'number', position: 'b1', number: { showAs: 'ring', color: 'green', divideBy: 100, showNumber: false } },
];

const cardBlocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: CARD_SCHEMA,
      views: [ { id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [ 'p-quiet-bar', 'p-quiet-ring', 'p-list' ], ...view } ],
      activeViewId: 'v1',
    },
    content: [ 'r1', 'r2' ],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'A', 'p-num': 50, 'p-quiet-bar': 50, 'p-quiet-ring': 50, 'p-stage': 'o-plan', 'p-link': [ { id: 'r1' }, { id: 'r2' } ] } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'B', 'p-num': 1234.5, 'p-quiet-bar': 1234.5, 'p-quiet-ring': 1234.5, 'p-stage': 'o-plan' } } },
];

interface CardGeometry {
  /** Each line's start from the card's start, and its height. */
  lineStart: number;
  lineHeight: number;
  bar: { start: number; width: number; trackFromLine: number };
  ring: { start: number; size: number; fromLine: number };
  /** The card's width less 11px each side. */
  content: number;
  /** Space between the two rollup items. */
  listGap: number;
}

const cardGeometry = async (page: Page, card: string, line: string): Promise<CardGeometry> => {
  const first = page.locator(card).filter({ hasText: 'A' }).first();

  await expect(first.locator(BAR)).toBeVisible();

  return first.evaluate((el, lineSelector) => {
    const round = (n: number): number => Math.round(n * 10) / 10;
    const box = el.getBoundingClientRect();
    const lineOf = (id: string): DOMRect => {
      const found = el.querySelector(`${lineSelector}[data-property-id="${id}"]`);

      if (found === null) throw new Error(`no line ${id}`);

      return found.getBoundingClientRect();
    };
    const rect = (selector: string): DOMRect => {
      const found = el.querySelector(selector);

      if (found === null) throw new Error(`no ${selector}`);

      return found.getBoundingClientRect();
    };
    const barLine = lineOf('p-quiet-bar');
    const ringLine = lineOf('p-quiet-ring');
    const bar = rect('[data-property-id="p-quiet-bar"] [data-blok-database-number-bar]');
    const ring = rect('[data-property-id="p-quiet-ring"] [data-blok-database-number-ring]');
    const items = [ ...el.querySelectorAll('[data-property-id="p-list"] [data-blok-database-number-item]') ].map((item) => item.getBoundingClientRect());

    if (items.length !== 2) throw new Error('expected two rollup items');

    return {
      lineStart: round(barLine.left - box.left),
      lineHeight: round(ringLine.height),
      bar: { start: round(bar.left - box.left), width: round(bar.width), trackFromLine: round(bar.top - barLine.top) },
      ring: { start: round(ring.left - box.left), size: round(ring.width), fromLine: round(ring.top - ringLine.top) },
      content: round(box.width - 22),
      listGap: round(items[1].left - items[0].right),
    };
  }, line);
};

for (const theme of THEMES) {
  for (const view of [
    { name: 'gallery', data: { type: 'gallery' }, card: '[data-blok-database-gallery-card]', line: '[data-blok-database-gallery-property]' },
    { name: 'board', data: { type: 'board', groupBy: 'p-stage' }, card: '[data-blok-database-card]', line: '[data-blok-database-card-property]' },
  ]) {
    test(`a ${view.name} card with Show number off: a full-width bar, an 18px ring, 11px in, ${theme.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme.name });
      await mount(page, cardBlocks(view.data));
      const geometry = await cardGeometry(page, view.card, view.line);

      // The bar has no 160 cap on a card: it fills the content width.
      expect(geometry.bar.width).toBe(geometry.content);
      expect(geometry.bar.start).toBe(11);
      // An 18px box with the 4px track centred: 5 + 7 below the line top.
      expect(geometry.bar.trackFromLine).toBe(12);
      expect(geometry.ring).toEqual({ start: 11, size: 18, fromLine: 5 });
      expect(geometry.lineStart).toBe(6);
      expect(geometry.lineHeight).toBe(28);
      // §14.11: the card's rollup list wrapper is `gap: 4px 6px`.
      expect(geometry.listGap).toBe(6);
    });
  }
}

/** notion-spec-2 §16.2: a side peek rollup list of five related rows, as Bar and as Ring. */
const PEEK_LIST_SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-link', name: 'Link', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db-1' } },
  { id: 'p-num', name: 'Num', type: 'number', position: 'a2' },
  { id: 'p-bars', name: 'Bars', type: 'rollup', position: 'a3', rollup: { relationPropertyId: 'p-link', targetPropertyId: 'p-num', function: 'show_original' }, number: { showAs: 'bar', color: 'green', divideBy: 5000 } },
  { id: 'p-rings', name: 'Rings', type: 'rollup', position: 'a4', rollup: { relationPropertyId: 'p-link', targetPropertyId: 'p-num', function: 'show_original' }, number: { showAs: 'ring', color: 'green', divideBy: 5000, format: 'dollar' } },
];

const peekListBlocks = (values: number[]): OutputBlockData[] => {
  const ids = values.map((_, i) => `r${i + 1}`);

  return [
    {
      id: 'db-1',
      type: 'database',
      data: {
        schema: PEEK_LIST_SCHEMA,
        views: [ { id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [ 'p-num' ], type: 'table' } ],
        activeViewId: 'v1',
      },
      content: ids,
    },
    ...values.map((value, i): OutputBlockData => ({
      id: ids[i],
      type: 'database-row',
      parent: 'db-1',
      data: { position: `a${i}`, properties: { 'p-title': ids[i], 'p-num': value, ...(i === 0 ? { 'p-link': ids.map((id) => ({ id })) } : {}) } },
    })),
  ];
};

interface PeekItem { left: number; right: number; top: number; bottom: number; text: { left: number; right: number }; gauge: { left: number; top: number; width: number; height: number } }

const peekItems = async (value: Locator): Promise<{ rowLeft: number; rowRight: number; boxHeight: number; items: PeekItem[] }> => {
  await expect(value.locator('[data-blok-database-number-item]').first()).toBeVisible();

  return value.evaluate((el) => {
    const round = (n: number): number => Math.round(n * 10) / 10;
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const items = [ ...el.querySelectorAll('[data-blok-database-number-item]') ].map((item) => {
      const rect = item.getBoundingClientRect();
      const text = item.querySelector('[data-blok-database-number-text]')?.getBoundingClientRect();
      const gauge = item.querySelector('[data-blok-database-number-bar], [data-blok-database-number-ring]')?.getBoundingClientRect();

      if (text === undefined || gauge === undefined) throw new Error('no text or gauge');

      return {
        left: round(rect.left), right: round(rect.right), top: round(rect.top), bottom: round(rect.bottom),
        text: { left: round(text.left), right: round(text.right) },
        gauge: { left: round(gauge.left), top: round(gauge.top), width: round(gauge.width), height: round(gauge.height) },
      };
    });

    return { rowLeft: round(box.left + parseFloat(style.paddingLeft)), rowRight: round(box.right - parseFloat(style.paddingRight)), boxHeight: round(box.height), items };
  });
};

const linesOf = (items: PeekItem[]): PeekItem[][] => items.reduce<PeekItem[][]>((lines, item) => {
  const last = lines[lines.length - 1];

  if (last !== undefined && Math.abs(last[0].top - item.top) < 1) last.push(item);
  else lines.push([ item ]);

  return lines;
}, []);

const openPeekOf = async (page: Page, rowId: string): Promise<Locator> => {
  const row = page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);

  await row.hover();
  await row.locator('[data-blok-database-table-open]').click();
  const drawer = page.locator('[data-blok-database-drawer]');

  await expect(drawer).toHaveCSS('transform', 'none');

  return drawer;
};

for (const theme of THEMES) {
  test.describe(`side peek rollup list, ${theme.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme.name });
    });

    test('three bars share one line and shrink to the same width', async ({ page }) => {
      await mount(page, peekListBlocks([ 100, 2469, 1554 ]));
      const { rowLeft, rowRight, items } = await peekItems(peekValue(await openPeekOf(page, 'r1'), 'p-bars'));

      expect(linesOf(items)).toHaveLength(1);
      const widths = items.map((item) => item.gauge.width);

      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5);
      expect(widths[0]).toBeGreaterThanOrEqual(48);
      expect(widths[0]).toBeLessThan(160);
      // The items fill the line, 8px apart, each bar 8px after its text.
      expect(Math.abs(items[0].left - rowLeft)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(items[2].right - rowRight)).toBeLessThanOrEqual(0.5);
      expect(items.map((item) => Math.round(item.gauge.left - item.text.right))).toEqual([ 8, 8, 8 ]);
      expect(items.slice(1).map((item, i) => Math.round(item.left - items[i].right))).toEqual([ 8, 8 ]);
    });

    test('five bars wrap: 6px between lines, equal bars per line, a lone last item spans the line with its bar at 160', async ({ page }) => {
      await mount(page, peekListBlocks([ 100, 2469, 1554, 1776, 1998 ]));
      const { rowLeft, rowRight, boxHeight, items } = await peekItems(peekValue(await openPeekOf(page, 'r1'), 'p-bars'));
      const lines = linesOf(items);

      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        const widths = line.map((item) => item.gauge.width);

        expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(0.5);
        expect(Math.min(...widths)).toBeGreaterThanOrEqual(48);
        expect(Math.max(...widths)).toBeLessThanOrEqual(160);
        expect(Math.abs(line[0].left - rowLeft)).toBeLessThanOrEqual(0.5);
        line.slice(1).forEach((item, i) => expect(Math.round(item.left - line[i].right)).toBe(8));
      }
      for (let i = 1; i < lines.length; i++) {
        expect(Math.round(lines[i][0].top - lines[i - 1][0].bottom)).toBe(6);
      }
      // Each line is 21 tall, the 4px track 8.5 down.
      for (const item of items) {
        expect(item.bottom - item.top).toBe(21);
        expect(Math.round((item.gauge.top - item.top) * 10) / 10).toBe(8.5);
      }
      // Two lines in a value box with 6px above, between and below.
      expect(lines).toHaveLength(2);
      expect(boxHeight).toBe(60);
      const last = lines[lines.length - 1];

      expect(last).toHaveLength(1);
      expect(Math.abs(last[0].right - rowRight)).toBeLessThanOrEqual(0.5);
      expect(last[0].gauge.width).toBe(160);
    });

    test('rings stay 21px, 8px after the text, and wrap 6px apart', async ({ page }) => {
      await mount(page, peekListBlocks([ 50, 1234.5, 777, 888, 999 ]));
      const { items } = await peekItems(peekValue(await openPeekOf(page, 'r1'), 'p-rings'));

      for (const item of items) {
        expect(item.gauge).toMatchObject({ width: 21, height: 21 });
        expect(Math.round(item.gauge.left - item.text.right)).toBe(8);
      }
      const lines = linesOf(items);

      for (let i = 1; i < lines.length; i++) {
        expect(Math.round(lines[i][0].top - lines[i - 1][0].bottom)).toBe(6);
      }
    });
  });
}

/** notion-spec-2 §16.3: a card with Show number on. */
const CARD_ON_SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-stage', name: 'Stage', type: 'select', position: 'a1', config: { options: [ { id: 'o-plan', label: 'Plan', color: 'blue', position: 'a0' } ] } },
  { id: 'p-link', name: 'Link', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db-1' } },
  { id: 'p-num', name: 'Num', type: 'number', position: 'a3' },
  { id: 'p-bar-on', name: 'Bar on', type: 'number', position: 'a4', number: { showAs: 'bar', color: 'green', divideBy: 100 } },
  { id: 'p-ring-on', name: 'Ring on', type: 'number', position: 'a5', number: { showAs: 'ring', color: 'green', divideBy: 100 } },
  { id: 'p-list-bar', name: 'List bar', type: 'rollup', position: 'a6', rollup: { relationPropertyId: 'p-link', targetPropertyId: 'p-num', function: 'show_original' }, number: { showAs: 'bar', color: 'green', divideBy: 5000 } },
];

const cardOnBlocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: CARD_ON_SCHEMA,
      views: [ { id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [ 'p-bar-on', 'p-ring-on', 'p-list-bar' ], ...view } ],
      activeViewId: 'v1',
    },
    content: [ 'r1', 'r2' ],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'A', 'p-num': 100, 'p-bar-on': 50, 'p-ring-on': 50, 'p-stage': 'o-plan', 'p-link': [ { id: 'r1' }, { id: 'r2' } ] } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'B', 'p-num': 2469, 'p-bar-on': 1234.5, 'p-ring-on': 1234.5, 'p-stage': 'o-plan' } } },
];

for (const theme of THEMES) {
  for (const view of [
    { name: 'gallery', data: { type: 'gallery' }, card: '[data-blok-database-gallery-card]', line: '[data-blok-database-gallery-property]' },
    { name: 'board', data: { type: 'board', groupBy: 'p-stage' }, card: '[data-blok-database-card]', line: '[data-blok-database-card-property]' },
  ]) {
    test(`a ${view.name} card with Show number on: the bar fills the line, an 18px ring, list bars at 48, ${theme.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme.name });
      await mount(page, cardOnBlocks(view.data));
      const card = page.locator(view.card).filter({ hasText: 'A' }).first();

      await expect(card.locator(BAR).first()).toBeVisible();
      const geometry = await card.evaluate((el, lineSelector) => {
        const round = (n: number): number => Math.round(n * 10) / 10;
        const box = el.getBoundingClientRect();
        const within = (id: string, selector: string): DOMRect[] => [ ...el.querySelectorAll(`${lineSelector}[data-property-id="${id}"] ${selector}`) ].map((node) => node.getBoundingClientRect());
        const line = (id: string): DOMRect => {
          const found = el.querySelector(`${lineSelector}[data-property-id="${id}"]`);

          if (found === null) throw new Error(`no line ${id}`);

          return found.getBoundingClientRect();
        };
        const barText = within('p-bar-on', '[data-blok-database-number-text]')[0];
        const bar = within('p-bar-on', '[data-blok-database-number-bar]')[0];
        const ringText = within('p-ring-on', '[data-blok-database-number-text]')[0];
        const ring = within('p-ring-on', '[data-blok-database-number-ring]')[0];
        const ringLine = line('p-ring-on');
        const barLine = line('p-bar-on');
        const listBars = within('p-list-bar', '[data-blok-database-number-bar]');
        const listItems = within('p-list-bar', '[data-blok-database-number-item]');

        return {
          bar: { gap: round(bar.left - barText.right), toEnd: round(box.right - 11 - bar.right), fromLine: round(bar.top - barLine.top) },
          ring: { gap: round(ring.left - ringText.right), size: round(ring.width), fromLine: round(ring.top - ringLine.top), textFromLine: round(ringText.top - ringLine.top) },
          listBars: listBars.map((b) => round(b.width)),
          listGap: round(listItems[1].left - listItems[0].right),
        };
      }, view.line);

      expect(geometry.bar).toEqual({ gap: 8, toEnd: 0, fromLine: 12 });
      expect(geometry.ring).toEqual({ gap: 8, size: 18, fromLine: 5, textFromLine: 5 });
      expect(geometry.listBars).toEqual([ 48, 48 ]);
      expect(geometry.listGap).toBe(6);
    });
  }
}
