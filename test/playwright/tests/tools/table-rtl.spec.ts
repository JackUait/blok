/**
 * Table geometry in a right-to-left editor.
 *
 * In RTL column 0 renders on the right and the scroll offset runs 0…-max, so
 * every control that is placed or hit-tested from the physical left lands on
 * the wrong column. These tests drive real pointer gestures and keys.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
    tableChanges?: string[];
  }
}

type Direction = 'ltr' | 'rtl';

interface Box { x: number; y: number; width: number; height: number }

const HOLDER_ID = 'blok';
const TOLERANCE = 3;

const createBlok = async (page: Page, data: OutputData, direction: Direction): Promise<void> => {
  await page.evaluate(async ({ holder, initialData, dir }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.width = '760px';
    container.style.margin = '0 auto';
    document.body.appendChild(container);

    window.tableChanges = [];

    const blok = new window.Blok({
      holder,
      data: initialData,
      i18n: { direction: dir },
      onChange: (_api: unknown, event: CustomEvent | CustomEvent[]) => {
        for (const one of Array.isArray(event) ? event : [event]) {
          const target = (one.detail as { target?: { name?: string } } | undefined)?.target;

          window.tableChanges?.push(`${one.type}:${target?.name ?? ''}`);
        }
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initialData: data, dir: direction });
};

const tableData = (content: string[][], colWidths?: number[]): OutputData => ({
  blocks: [
    { type: 'table', data: { withHeadings: false, content, ...(colWidths ? { colWidths } : {}) } },
    { type: 'paragraph', data: { text: 'after' } },
  ],
});

const box = async (page: Page, selector: string): Promise<Box> => {
  const found = await page.locator(selector).first().boundingBox();

  if (found === null) {
    throw new Error(`${selector} has no box`);
  }

  return found;
};

const cell = (row: number, col: number): string =>
  `[data-blok-table-cell][data-blok-table-cell-row="${row}"][data-blok-table-cell-col="${col}"]`;

const GRID = '[data-blok-table-scroll] > table';

const savedTable = async (page: Page): Promise<{ content: unknown[][]; colWidths?: number[] }> =>
  page.evaluate(async () => {
    const saved = await window.blokInstance?.save();
    const table = saved?.blocks.find(block => block.type === 'table');

    return table?.data as { content: unknown[][]; colWidths?: number[] };
  });

const firstRowTexts = async (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-blok-table-cell][data-blok-table-cell-row="0"]'));

    return cells
      .sort((a, b) => Number(a.dataset.blokTableCellCol) - Number(b.dataset.blokTableCellCol))
      .map(el => (el.textContent ?? '').trim());
  });

const caretCol = async (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const node = window.getSelection()?.anchorNode ?? null;
    const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;

    return el?.closest('[data-blok-table-cell]')?.getAttribute('data-blok-table-cell-col') ?? null;
  });

const selectedCols = async (page: Page): Promise<number[]> =>
  page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-table-cell-selected]'))
    .map(el => Number(el.getAttribute('data-blok-table-cell-col')))
    .sort((a, b) => a - b));

/** Physical x of the border between column `col` and the next one (its inline end). */
const inlineEndX = (cellBox: Box, direction: Direction): number =>
  direction === 'rtl' ? cellBox.x : cellBox.x + cellBox.width;

/** Longer than the 400ms onChange batch window: absence needs a fixed wait. */
const outlastChangeBatch = (page: Page): Promise<void> =>
  page.evaluate(() => new Promise<void>(resolve => {
    setTimeout(resolve, 600);
  }));

/** Waits out the onChange batch window, then reads what it reported. */
const changesAfterSettle = async (page: Page): Promise<string[]> => {
  await outlastChangeBatch(page);

  return page.evaluate(() => window.tableChanges ?? []);
};

const clearChanges = async (page: Page): Promise<void> => {
  await outlastChangeBatch(page);
  await page.evaluate(() => {
    window.tableChanges = [];
  });
};

const cellDirections = async (page: Page, row: number, col: number): Promise<{ grid: string; text: string | null }> =>
  page.evaluate(({ r, c }) => {
    const grid = document.querySelector('[data-blok-table-scroll] > table');
    const cellEl = document.querySelector(`[data-blok-table-cell][data-blok-table-cell-row="${r}"][data-blok-table-cell-col="${c}"]`);

    return {
      grid: grid === null ? '' : getComputedStyle(grid).direction,
      text: cellEl?.querySelector('[data-blok-element-content]')?.getAttribute('dir') ?? null,
    };
  }, { r: row, c: col });

const center = (b: Box): { x: number; y: number } => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/**
 * The edge check follows the caret text's direction and the neighbour cell
 * follows the grid's, so the pure cases use text matching the table.
 */
const cellText = (direction: 'ltr' | 'rtl'): string[][] => direction === 'rtl'
  ? [['أ', 'ب', 'ج'], ['د', 'ه', 'و']]
  : [['A', 'B', 'C'], ['D', 'E', 'F']];

test.describe('table in RTL', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  for (const direction of ['rtl', 'ltr'] as const) {
    test(`${direction}: resize handles sit on the column borders`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B', 'C'], ['D', 'E', 'F']]), direction);

      for (const col of [0, 1]) {
        const handle = await box(page, `[data-blok-table-resize][data-col="${col}"]`);
        const border = inlineEndX(await box(page, cell(0, col)), direction);

        expect(Math.abs(center(handle).x - border)).toBeLessThanOrEqual(TOLERANCE);
      }

      const grid = await box(page, GRID);
      const last = await box(page, '[data-blok-table-resize][data-col="2"]');

      expect(last.x).toBeGreaterThanOrEqual(grid.x - 1.5);
      expect(last.x + last.width).toBeLessThanOrEqual(grid.x + grid.width + 1.5);
    });

    test(`${direction}: dragging a handle toward the inline end widens its column`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B', 'C'], ['D', 'E', 'F']], [200, 200, 200]), direction);

      const handle = center(await box(page, '[data-blok-table-resize][data-col="0"]'));
      const outward = direction === 'rtl' ? -60 : 60;

      await page.mouse.move(handle.x, handle.y);
      await page.mouse.down();
      await page.mouse.move(handle.x + outward, handle.y, { steps: 6 });
      await page.mouse.up();

      const saved = await savedTable(page);

      expect(saved.colWidths?.[0]).toBeGreaterThanOrEqual(255);
      expect(saved.colWidths?.[0]).toBeLessThanOrEqual(265);

      const handleAfter = await box(page, '[data-blok-table-resize][data-col="0"]');
      const border = inlineEndX(await box(page, cell(0, 0)), direction);

      expect(Math.abs(center(handleAfter).x - border)).toBeLessThanOrEqual(TOLERANCE);
    });

    test(`${direction}: column and row grips land on the hovered cell`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B', 'C'], ['D', 'E', 'F']]), direction);

      for (const col of [0, 2]) {
        const target = await box(page, cell(1, col));

        await page.mouse.move(center(target).x, center(target).y);

        const grip = page.locator(`[data-blok-table-grip-col="${col}"]`);

        await expect(grip).toBeVisible();

        const gripBox = await box(page, `[data-blok-table-grip-col="${col}"]`);

        expect(center(gripBox).x).toBeGreaterThan(target.x);
        expect(center(gripBox).x).toBeLessThan(target.x + target.width);
      }

      const grid = await box(page, GRID);
      const rowGrip = await box(page, '[data-blok-table-grip-row="1"]');
      const startEdge = direction === 'rtl' ? grid.x + grid.width : grid.x;

      expect(Math.abs(center(rowGrip).x - startEdge)).toBeLessThanOrEqual(TOLERANCE);
    });

    test(`${direction}: dragging a column grip reorders toward the inline end`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B', 'C'], ['D', 'E', 'F']], [200, 200, 200]), direction);

      const source = await box(page, cell(0, 0));

      await page.mouse.move(center(source).x, center(source).y);

      const grip = center(await box(page, '[data-blok-table-grip-col="0"]'));
      const destination = center(await box(page, cell(0, 2)));
      const pastMiddle = destination.x + (direction === 'rtl' ? -40 : 40);

      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      await page.mouse.move(grip.x + (direction === 'rtl' ? -20 : 20), grip.y, { steps: 4 });
      await page.mouse.move(pastMiddle, grip.y, { steps: 10 });
      await page.mouse.up();

      await expect.poll(() => firstRowTexts(page)).toEqual(['B', 'C', 'A']);
    });

    test(`${direction}: a dragged cell range paints an overlay over exactly those cells`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B', 'C'], ['D', 'E', 'F']]), direction);

      const from = center(await box(page, cell(0, 0)));
      const to = center(await box(page, cell(1, 1)));

      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();

      await expect.poll(() => selectedCols(page)).toEqual([0, 0, 1, 1]);

      const overlay = await box(page, '[data-blok-table-selection-overlay]');
      const a = await box(page, cell(0, 0));
      const e = await box(page, cell(1, 1));
      const left = Math.min(a.x, e.x);
      const right = Math.max(a.x + a.width, e.x + e.width);

      expect(Math.abs(overlay.x - left)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(overlay.x + overlay.width - right)).toBeLessThanOrEqual(TOLERANCE);

      const pill = await box(page, '[data-blok-table-selection-pill]');
      const endEdge = direction === 'rtl' ? overlay.x : overlay.x + overlay.width;

      expect(Math.abs(center(pill).x - endEdge)).toBeLessThanOrEqual(TOLERANCE);
    });

    test(`${direction}: a range drag past the inline-end edge reaches the last column`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B', 'C'], ['D', 'E', 'F']]), direction);

      const from = center(await box(page, cell(0, 0)));
      const grid = await box(page, GRID);
      const beyond = direction === 'rtl' ? grid.x - 30 : grid.x + grid.width + 30;

      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(beyond, from.y, { steps: 10 });
      await page.mouse.up();

      await expect.poll(() => selectedCols(page)).toEqual([0, 1, 2]);
    });

    test(`${direction}: the forward arrow at a cell's end moves into the next column`, async ({ page }) => {
      await createBlok(page, tableData(cellText(direction)), direction);

      const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
      const backward = direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft';

      await page.locator(`${cell(0, 0)} [contenteditable="true"]`).first().click();
      await page.keyboard.press('End');
      await page.keyboard.press(forward);

      await expect.poll(() => caretCol(page)).toBe('1');

      await page.keyboard.press('Home');
      await page.keyboard.press(backward);

      await expect.poll(() => caretCol(page)).toBe('0');
    });

    test(`${direction}: Shift+forward arrow at a cell's end extends the selection into the next column`, async ({ page }) => {
      await createBlok(page, tableData(cellText(direction)), direction);

      const forward = direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';

      await page.locator(`${cell(0, 0)} [contenteditable="true"]`).first().click();
      await page.keyboard.press('End');
      await page.keyboard.press(`Shift+${forward}`);

      await expect.poll(() => selectedCols(page)).toEqual([0, 1]);
    });

    test(`${direction}: scroll haze marks the side with hidden columns`, async ({ page }) => {
      const wide = Array.from({ length: 8 }, (_, i) => `C${i}`);

      await createBlok(page, tableData([wide, wide], Array(8).fill(200)), direction);

      const startSide = direction === 'rtl' ? 'right' : 'left';
      const endSide = direction === 'rtl' ? 'left' : 'right';
      const haze = (side: string): string => `[data-blok-table-haze="${side}"]`;

      await expect(page.locator(haze(endSide))).toHaveAttribute('data-blok-table-haze-visible', '');
      await expect(page.locator(haze(startSide))).not.toHaveAttribute('data-blok-table-haze-visible', '');

      const scroller = await box(page, '[data-blok-table-scroll]');
      const endHaze = await box(page, haze(endSide));
      const scrollerEndEdge = direction === 'rtl' ? scroller.x : scroller.x + scroller.width;
      const hazeEndEdge = direction === 'rtl' ? endHaze.x : endHaze.x + endHaze.width;

      expect(Math.abs(hazeEndEdge - scrollerEndEdge)).toBeLessThanOrEqual(TOLERANCE);

      await page.evaluate(dir => {
        const sc = document.querySelector<HTMLElement>('[data-blok-table-scroll]');

        if (sc) {
          sc.scrollLeft = dir === 'rtl' ? -sc.scrollWidth : sc.scrollWidth;
        }
      }, direction);

      await expect(page.locator(haze(startSide))).toHaveAttribute('data-blok-table-haze-visible', '');
      await expect(page.locator(haze(endSide))).not.toHaveAttribute('data-blok-table-haze-visible', '');
    });

    test(`${direction}: the add-column button sits past the inline end and drags outward`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B'], ['C', 'D']], [150, 150]), direction);

      const grid = await box(page, GRID);
      const endEdge = direction === 'rtl' ? grid.x : grid.x + grid.width;

      await page.mouse.move(endEdge + (direction === 'rtl' ? -6 : 6), grid.y + grid.height / 2);

      const button = page.locator('[data-blok-table-add-col]');

      await expect(button).toHaveCSS('opacity', '1');

      const buttonBox = await box(page, '[data-blok-table-add-col]');

      const gapPastEnd = direction === 'rtl'
        ? grid.x - (buttonBox.x + buttonBox.width)
        : buttonBox.x - (grid.x + grid.width);

      expect(gapPastEnd).toBeGreaterThanOrEqual(-1);

      const start = center(buttonBox);
      const outward = direction === 'rtl' ? -1 : 1;

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + outward * 170, start.y, { steps: 12 });
      await page.mouse.up();

      await expect.poll(async () => (await firstRowTexts(page)).length).toBeGreaterThanOrEqual(3);
    });

    test(`${direction}: the corner handle sits at the inline-end corner and drags outward`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B'], ['C', 'D']], [150, 150]), direction);

      const grid = await box(page, GRID);
      const corner = await box(page, '[data-blok-table-corner-drag]');
      const endEdge = direction === 'rtl' ? grid.x : grid.x + grid.width;

      expect(Math.abs(center(corner).x - endEdge)).toBeLessThanOrEqual(20);

      const start = center(corner);
      const outward = direction === 'rtl' ? -1 : 1;

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + outward * 200, start.y, { steps: 12 });
      await page.mouse.up();

      await expect.poll(async () => (await firstRowTexts(page)).length).toBeGreaterThanOrEqual(3);
    });
  }

  test('rtl: adding a column to an overflowing table scrolls it into view', async ({ page }) => {
    const wide = Array.from({ length: 8 }, (_, i) => `C${i}`);

    await createBlok(page, tableData([wide, wide], Array(8).fill(200)), 'rtl');

    const grid = await box(page, GRID);
    const scroller = await box(page, '[data-blok-table-scroll]');

    await page.mouse.move(scroller.x - 6, grid.y + grid.height / 2);
    await expect(page.locator('[data-blok-table-add-col]')).toHaveCSS('opacity', '1');
    await page.locator('[data-blok-table-add-col]').click();

    await expect.poll(async () => (await firstRowTexts(page)).length).toBe(9);
    await expect.poll(() => page.evaluate(() => {
      const sc = document.querySelector<HTMLElement>('[data-blok-table-scroll]');

      return sc === null ? null : Math.abs(sc.scrollLeft) >= sc.scrollWidth - sc.clientWidth - 2;
    })).toBe(true);
  });

  test('rtl: a corner held past the scroller\'s left edge scrolls and keeps adding columns', async ({ page }) => {
    const wide = Array.from({ length: 20 }, (_, i) => `C${i}`);

    await createBlok(page, tableData([wide, wide]), 'rtl');

    const scroller = await box(page, '[data-blok-table-scroll]');
    const corner = center(await box(page, '[data-blok-table-corner-drag]'));
    const parked = (await firstRowTexts(page)).length;

    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(scroller.x - 160, corner.y, { steps: 5 });

    await expect.poll(async () => (await firstRowTexts(page)).length, { timeout: 5_000 }).toBeGreaterThan(parked);
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>('[data-blok-table-scroll]')?.scrollLeft ?? 0)).toBeLessThan(0);

    await page.mouse.up();
  });

  test('a live flip to rtl moves the handles and the corner', async ({ page }) => {
    await createBlok(page, tableData([['A', 'B', 'C'], ['D', 'E', 'F']]), 'ltr');

    await page.evaluate(async () => {
      await window.blokInstance?.i18n.update({ direction: 'rtl' });
    });

    await expect.poll(async () => {
      const handle = await box(page, '[data-blok-table-resize][data-col="0"]');
      const border = inlineEndX(await box(page, cell(0, 0)), 'rtl');

      return Math.abs(center(handle).x - border) <= TOLERANCE;
    }).toBe(true);

    const grid = await box(page, GRID);

    await expect.poll(async () => {
      const corner = await box(page, '[data-blok-table-corner-drag]');

      return Math.abs(center(corner).x - grid.x) <= 20;
    }).toBe(true);
  });
  test('a read-only table moves its scroll haze on a live flip to rtl', async ({ page }) => {
    const row = ['أ', 'ب', 'ج', 'د', 'ه', 'و', 'ز', 'ح'];

    await page.evaluate(async ({ holder, data }) => {
      document.getElementById(holder)?.remove();

      const container = document.createElement('div');

      container.id = holder;
      container.style.width = '760px';
      container.style.margin = '0 auto';
      document.body.appendChild(container);

      const blok = new window.Blok({ holder, data, readOnly: true, i18n: { direction: 'ltr' } });

      window.blokInstance = blok;
      await blok.isReady;
    }, { holder: HOLDER_ID, data: tableData([row, row], row.map(() => 200)) });

    const haze = (side: string): string => `[data-blok-table-haze="${side}"]`;

    await expect(page.locator(haze('right'))).toHaveAttribute('data-blok-table-haze-visible', '');

    await page.evaluate(async () => {
      await window.blokInstance?.i18n.update({ direction: 'rtl' });
    });

    // RTL starts scrolled to the right edge, so the hidden columns are on the left.
    await expect(page.locator(haze('left'))).toHaveAttribute('data-blok-table-haze-visible', '');
    await expect(page.locator(haze('right'))).not.toHaveAttribute('data-blok-table-haze-visible', '');

    const leftHaze = await box(page, haze('left'));
    const scroller = await box(page, '[data-blok-table-scroll]');

    expect(Math.abs(leftHaze.x - scroller.x)).toBeLessThanOrEqual(TOLERANCE);
  });

  for (const direction of ['rtl', 'ltr'] as const) {
    test(`${direction}: the heading switch thumb moves toward the inline end when on`, async ({ page }) => {
      await createBlok(page, tableData(cellText(direction)), direction);

      const target = await box(page, cell(0, 0));

      await page.mouse.move(center(target).x, center(target).y);
      await page.locator('[data-blok-table-grip-row="0"]').click();

      const toggle = page.getByRole('switch').first();

      await expect(toggle).toBeVisible();

      const thumbOffset = async (): Promise<number> => toggle.evaluate(async (row) => {
        const track = row.lastElementChild;
        const thumb = track?.firstElementChild;

        await Promise.all((thumb?.getAnimations() ?? []).map(a => a.finished.catch(() => undefined)));

        if (!(track instanceof HTMLElement) || !(thumb instanceof HTMLElement)) {
          return Number.NaN;
        }

        const t = track.getBoundingClientRect();
        const h = thumb.getBoundingClientRect();
        const isRtl = getComputedStyle(row).direction === 'rtl';

        // Distance of the thumb from the track's inline start.
        return isRtl ? t.right - h.right : h.left - t.left;
      });

      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(await thumbOffset()).toBeLessThanOrEqual(3);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect.poll(thumbOffset).toBeGreaterThanOrEqual(13);

      // The gap between icon and label sits on the icon's inline-end side.
      const gap = await toggle.evaluate((row, dir) => {
        const icon = row.children[0]?.getBoundingClientRect();
        const label = row.children[1]?.getBoundingClientRect();

        if (icon === undefined || label === undefined) {
          return Number.NaN;
        }

        return dir === 'rtl' ? icon.left - label.right : label.left - icon.right;
      }, direction);

      expect(gap).toBeGreaterThanOrEqual(6);
    });
  }
  test('a live direction flip is not an edit', async ({ page }) => {
    await createBlok(page, tableData([['A', 'B', 'C'], ['D', 'E', 'F']]), 'ltr');
    await clearChanges(page);

    const unguarded = await page.evaluate(async () => {
      const root = document.querySelector('[data-blok-tool="table"]');
      const seen = new Set<string>();
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          const el = record.target instanceof Element ? record.target : record.target.parentElement;

          if (el !== null && el.closest('[data-blok-mutation-free]') === null) {
            const attrs = Array.from(el.attributes).map(a => a.name).filter(n => n.startsWith('data-blok-table')).join(',');

            seen.add(`${el.tagName}[${attrs}] ${record.type}:${record.attributeName ?? ''}`);
          }
        }
      });

      if (root !== null) {
        observer.observe(root, { attributes: true, childList: true, subtree: true, characterData: true });
      }

      await window.blokInstance?.i18n.update({ direction: 'rtl' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      observer.disconnect();

      return Array.from(seen);
    });

    expect(await changesAfterSettle(page), unguarded.join('\n')).toEqual([]);
  });

  test('ltr: a horizontal scroll that toggles the haze is not an edit', async ({ page }) => {
    const wide = Array.from({ length: 8 }, (_, i) => `C${i}`);

    await createBlok(page, tableData([wide, wide], Array(8).fill(200)), 'ltr');
    await expect(page.locator('[data-blok-table-haze="right"]')).toHaveAttribute('data-blok-table-haze-visible', '');
    await clearChanges(page);

    await page.evaluate(() => {
      const sc = document.querySelector<HTMLElement>('[data-blok-table-scroll]');

      if (sc) {
        sc.scrollLeft = sc.scrollWidth;
      }
    });

    await expect(page.locator('[data-blok-table-haze="left"]')).toHaveAttribute('data-blok-table-haze-visible', '');
    expect(await changesAfterSettle(page)).toEqual([]);
  });

  /**
   * Mixed direction: the arrow must reach the cell that is visually on its
   * side, whatever direction the cell's text reads in.
   */
  const mixed = [
    { table: 'rtl', text: 'ltr', content: [['A', 'B', 'C'], ['D', 'E', 'F']] },
    { table: 'ltr', text: 'rtl', content: [['أ', 'ب', 'ج'], ['د', 'ه', 'و']] },
  ] as const;

  for (const { table, text, content } of mixed) {
    test(`${table} table with ${text} text: arrows at a cell edge move to the visually adjacent cell`, async ({ page }) => {
      await createBlok(page, tableData(content.map(row => [...row])), table);

      expect(await cellDirections(page, 0, 1)).toEqual({ grid: table, text });

      const middle = center(await box(page, cell(0, 1)));
      // The text's end is on the right for LTR text and on the left for RTL.
      const towardEnd = text === 'ltr' ? 'ArrowRight' : 'ArrowLeft';
      const towardStart = text === 'ltr' ? 'ArrowLeft' : 'ArrowRight';
      const sideOf = (key: string): 'left' | 'right' => key === 'ArrowRight' ? 'right' : 'left';

      for (const [edge, key] of [['End', towardEnd], ['Home', towardStart]] as const) {
        await page.locator(`${cell(0, 1)} [contenteditable="true"]`).first().click();
        await page.keyboard.press(edge);
        await page.keyboard.press(key);

        await expect.poll(() => caretCol(page)).not.toBe('1');

        const landed = center(await box(page, cell(0, Number(await caretCol(page)))));

        expect(landed.x > middle.x ? 'right' : 'left').toBe(sideOf(key));
      }
    });

    test(`${table} table with ${text} text: Shift+arrow at a cell edge extends toward the visually adjacent cell`, async ({ page }) => {
      await createBlok(page, tableData(content.map(row => [...row])), table);

      const towardEnd = text === 'ltr' ? 'ArrowRight' : 'ArrowLeft';
      // In both cases the visually adjacent cell on the text's end side is column 0.
      await page.locator(`${cell(0, 1)} [contenteditable="true"]`).first().click();
      await page.keyboard.press('End');
      await page.keyboard.press(`Shift+${towardEnd}`);

      await expect.poll(() => selectedCols(page)).toEqual([0, 1]);

      const zero = center(await box(page, cell(0, 0)));
      const one = center(await box(page, cell(0, 1)));

      expect(zero.x > one.x ? 'ArrowRight' : 'ArrowLeft').toBe(towardEnd);
    });
  }
});
