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
];

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
    data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-bar': 40, 'p-ring': 40, 'p-plain': 40, 'p-num': 2469, 'p-stage': 'o-plan', 'p-link': [ { id: 'r1' } ] } },
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

    test('a number formula and a number rollup draw their gauge in the table and the row page', async ({ page }) => {
      await mount(page, blocks({ type: 'table' }, [ 'p-formula', 'p-sum' ]));
      const row = page.locator('[data-blok-database-table-row][data-row-id="r1"]');

      await expect(row.locator(`[data-blok-database-table-cell][data-property-id="p-formula"] ${RING}`)).toBeVisible();
      await expect(row.locator(`[data-blok-database-table-cell][data-property-id="p-sum"] ${BAR}`)).toBeVisible();
      const drawer = await openPeek(page);

      expect(await measure(peekValue(drawer, 'p-formula').locator(RING), '[data-blok-database-drawer-prop-value]')).toMatchObject({ width: 21, height: 21, gap: 8 });
      expect(await measure(peekValue(drawer, 'p-sum').locator(BAR), '[data-blok-database-drawer-prop-value]')).toMatchObject({ width: 160, height: 4, gap: 8 });
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
      test(`a ${view.type} card draws the gauge as the row page does`, async ({ page }) => {
        await mount(page, blocks(view));
        const scope = page.locator('[data-blok-id="db-1"]');
        const bar = await measure(scope.locator(BAR).first(), '[data-blok-database-cell]');
        const ring = await measure(scope.locator(RING).first(), '[data-blok-database-cell]');

        expect(bar).toMatchObject({ height: 4, gap: 8 });
        expect(bar.width).toBeGreaterThanOrEqual(48);
        expect(bar.width).toBeLessThanOrEqual(160);
        expect(ring).toMatchObject({ width: 21, height: 21, gap: 8 });
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
