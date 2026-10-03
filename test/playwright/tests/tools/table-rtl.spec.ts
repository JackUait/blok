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
    readOnlyTableChanges?: { count: number };
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

    // The frame line is 1px wide and starts at the grid edge, so its centre is
    // 0.5px INSIDE the grid. A grip centred 0.5px outside sits 1px off the line.
    test(`${direction}: column and row grips are centred on the frame line`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B'], ['C', 'D']]), direction);

      const target = await box(page, cell(1, 0));

      await page.mouse.move(center(target).x, center(target).y);
      await expect(page.locator('[data-blok-table-grip-col="0"]')).toBeVisible();
      await expect(page.locator('[data-blok-table-grip-row="1"]')).toBeVisible();

      const grid = await box(page, GRID);
      const colGrip = center(await box(page, '[data-blok-table-grip-col="0"]'));
      const rowGrip = center(await box(page, '[data-blok-table-grip-row="1"]'));
      const startLine = direction === 'rtl' ? grid.x + grid.width - 0.5 : grid.x + 0.5;

      expect(Math.abs(colGrip.y - (grid.y + 0.5))).toBeLessThan(0.25);
      expect(Math.abs(rowGrip.x - startLine)).toBeLessThan(0.25);
    });

    test(`${direction}: grips fade in at pill size when the pointer comes back`, async ({ page }) => {
      await createBlok(page, tableData([['A', 'B'], ['C', 'D']]), direction);

      const target = center(await box(page, cell(1, 0)));
      const colGrip = page.locator('[data-blok-table-grip-col="0"]');

      await page.mouse.move(target.x, target.y);
      await expect(colGrip).toHaveAttribute('data-blok-table-grip-visible', '');
      await page.mouse.move(target.x, target.y + 400);
      await expect(colGrip).not.toHaveAttribute('data-blok-table-grip-visible', '');

      // Sample every frame of the fade: a size change would show up mid-way.
      await page.evaluate(() => {
        const grip = document.querySelector('[data-blok-table-grip-col="0"]');
        const heights: number[] = [];
        const until = performance.now() + 400;
        const sample = (): void => {
          heights.push(grip?.getBoundingClientRect().height ?? 0);

          if (performance.now() < until) {
            requestAnimationFrame(sample);
          } else {
            Object.assign(window, { gripSamplingDone: true });
          }
        };

        Object.assign(window, { gripHeights: heights, gripSamplingDone: false });
        requestAnimationFrame(sample);
      });
      await page.mouse.move(target.x, target.y);
      await expect(colGrip).toHaveAttribute('data-blok-table-grip-visible', '');
      await expect.poll(() => page.evaluate(() => (window as unknown as { gripSamplingDone: boolean }).gripSamplingDone)).toBe(true);

      const heights = await page.evaluate(() => (window as unknown as { gripHeights: number[] }).gripHeights);

      expect(Math.max(...heights)).toBeLessThanOrEqual(4.5);
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

      const changes = { count: 0 };

      window.readOnlyTableChanges = changes;

      const blok = new window.Blok({
        holder,
        data,
        readOnly: true,
        i18n: { direction: 'ltr' },
        onChange: () => {
          changes.count += 1;
        },
      });

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
    // Re-placing chrome is not an edit.
    expect(await page.evaluate(() => window.readOnlyTableChanges?.count)).toBe(0);
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

  /** Caret x and the x range of the text it sits in. */
  const caretInText = async (page: Page): Promise<{ x: number; left: number; right: number }> =>
    page.evaluate(() => {
      const selection = window.getSelection();
      const node = selection?.anchorNode ?? null;
      const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
      const field = el?.closest('[contenteditable="true"]');

      if (!selection || selection.rangeCount === 0 || !field) {
        throw new Error('no caret');
      }

      const text = document.createRange();

      text.selectNodeContents(field);
      const textRect = text.getBoundingClientRect();

      return { x: selection.getRangeAt(0).getBoundingClientRect().x, left: textRect.left, right: textRect.right };
    });

  const caretLanding = [
    { table: 'ltr', text: 'ltr', content: [['Alpha', 'Bravo', 'Charlie']] },
    { table: 'rtl', text: 'rtl', content: [['مرحبا', 'عالم', 'جميل']] },
    { table: 'rtl', text: 'ltr', content: [['Alpha', 'Bravo', 'Charlie']] },
    { table: 'ltr', text: 'rtl', content: [['مرحبا', 'عالم', 'جميل']] },
  ] as const;

  for (const { table, text, content } of caretLanding) {
    test(`${table} table with ${text} text: an arrow into a cell lands on the edge it came from`, async ({ page }) => {
      await createBlok(page, tableData(content.map(row => [...row])), table);

      const towardEnd = text === 'ltr' ? 'ArrowRight' : 'ArrowLeft';

      for (const key of ['ArrowLeft', 'ArrowRight'] as const) {
        // Put the caret on the middle cell's visual edge on the key's side.
        await page.locator(`${cell(0, 1)} [contenteditable="true"]`).first().click();
        await page.keyboard.press(key === towardEnd ? 'End' : 'Home');
        await page.keyboard.press(key);
        await expect.poll(() => caretCol(page)).not.toBe('1');

        const caret = await caretInText(page);
        // Moving left enters the neighbour from its right edge, and vice versa.
        const edge = key === 'ArrowLeft' ? caret.right : caret.left;

        expect(Math.abs(caret.x - edge), `${key}: caret ${caret.x} in ${caret.left}..${caret.right}`).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  }

  const ROWS = ['top', 'middle', 'bottom'] as const;
  const COLUMNS = ['left', 'center', 'right'] as const;
  const LONG_TEXT: Record<Direction, string> = {
    ltr: 'a paragraph long enough to wrap across several lines in this cell',
    rtl: 'هذه فقرة طويلة بما يكفي لتلتف عبر عدة أسطر داخل هذه الخلية',
  };

  /**
   * Rows top/middle/bottom, columns left/center/right, plus a tall last
   * column so every row has room to move its text vertically.
   */
  const placementTable = (text: string): OutputData => {
    const children: OutputData['blocks'] = [];
    const content = ROWS.map((row, r) => [
      ...COLUMNS.map((column, c) => {
        const id = `p${r}${c}`;

        children.push({ id, type: 'paragraph', data: { text }, parent: 't' });

        return { blocks: [id], placement: `${row}-${column}` };
      }),
      (() => {
        const id = `tall${r}`;

        children.push({ id, type: 'paragraph', data: { text: Array(9).fill('x').join('<br>') }, parent: 't' });

        return { blocks: [id] };
      })(),
    ]);

    return {
      blocks: [
        { id: 't', type: 'table', data: { withHeadings: false, content }, content: children.map(child => child.id ?? '') },
        ...children,
      ],
    };
  };

  /** A cell's text line offsets from its content box. */
  const placementGeometry = async (page: Page, row: number, col: number): Promise<{
    left: number[];
    right: number[];
    middle: number[];
    top: number;
    bottom: number;
  }> =>
    page.evaluate(({ r, c }) => {
      const cellEl = document.querySelector(`[data-blok-table-cell][data-blok-table-cell-row="${r}"][data-blok-table-cell-col="${c}"]`);
      const container = cellEl?.querySelector('[data-blok-table-cell-blocks]');
      const editable = cellEl?.querySelector<HTMLElement>('[contenteditable="true"]');

      if (!container || !editable) {
        throw new Error('no cell');
      }

      const range = document.createRange();

      range.selectNodeContents(editable);
      const box = container.getBoundingClientRect();
      const text = range.getBoundingClientRect();
      const lines = Array.from(range.getClientRects()).filter(rect => rect.width > 0);

      return {
        left: lines.map(line => line.left - box.left),
        right: lines.map(line => box.right - line.right),
        middle: lines.map(line => (line.left + line.right) / 2 - (box.left + box.right) / 2),
        top: text.top - box.top,
        bottom: box.bottom - text.bottom,
      };
    }, { r: row, c: col });

  /** left = inline start, right = inline end, both read in the TABLE's direction. */
  const physicalSide = (column: typeof COLUMNS[number], table: Direction): 'left' | 'center' | 'right' => {
    if (column === 'center') {
      return 'center';
    }

    return (column === 'left') === (table === 'ltr') ? 'left' : 'right';
  };

  const VERTICAL_LEAN = { top: -1, middle: 0, bottom: 1 } as const;

  const placementCases = [
    { table: 'ltr', text: 'ltr' },
    { table: 'rtl', text: 'rtl' },
    { table: 'rtl', text: 'ltr' },
    { table: 'ltr', text: 'rtl' },
  ] as const;

  for (const { table, text } of placementCases) {
    test(`${table} table with ${text} text: left/right placement means the grid's start/end`, async ({ page }) => {
      await createBlok(page, placementTable(LONG_TEXT[text]), table);

      const cells = ROWS.flatMap((row, r) => COLUMNS.map((column, c) => ({ row, column, r, c })));

      for (const { row, column, r, c } of cells) {
        const label = `${row}-${column}`;
        const geometry = await placementGeometry(page, r, c);
        const physical = physicalSide(column, table);
        const offsets = { left: geometry.left, right: geometry.right, center: geometry.middle }[physical];

        expect(geometry.left.length, `${label} wraps`).toBeGreaterThan(1);
        expect(Math.max(...offsets.map(Math.abs)), `${label}: every line on the ${physical}`).toBeLessThanOrEqual(1.5);
        // -1 sits high, 1 sits low, 0 is centred within 10px.
        expect(Math.sign(Math.trunc((geometry.top - geometry.bottom) / 10)), `${label} vertical`).toBe(VERTICAL_LEAN[row]);
      }
    });
  }

  const openPlacementPicker = async (page: Page): Promise<void> => {
    const target = await box(page, cell(0, 0));

    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);

    const pill = page.locator('[data-blok-table-selection-pill]');

    await expect(pill).toBeAttached();
    const pillBox = await box(page, '[data-blok-table-selection-pill]');

    await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
    await pill.click();

    const item = page.locator('[data-blok-testid="popover-item"][data-blok-item-name="cellPlacement"]');
    const itemBox = await box(page, '[data-blok-testid="popover-item"][data-blok-item-name="cellPlacement"]');

    await expect(item).toBeVisible();
    await page.mouse.move(itemBox.x + itemBox.width / 2, itemBox.y + itemBox.height / 2);
    await expect(page.locator('[data-placement="bottom-right"]')).toBeVisible();
  };

  /** Where the picker draws one option: its button, its glyph lines, the thumb and the preview lines. */
  const pickerGeometry = async (page: Page, placement: string): Promise<{
    thumbInside: boolean;
    buttonX: Record<string, number>;
    glyphLinesFrom: { left: number; right: number };
    previewLinesFrom: { left: number[]; right: number[] };
  }> =>
    page.evaluate((selected) => {
      const thumb = document.querySelector('[data-blok-placement-thumb]');
      const button = document.querySelector(`[data-placement="${selected}"]`);
      const glyph = button?.querySelector('[data-blok-placement-glyph]');
      const preview = document.querySelector('[data-blok-placement-preview]');

      if (!thumb || !button || !glyph || !preview) {
        throw new Error('no picker');
      }

      const t = thumb.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      const g = glyph.getBoundingClientRect();
      const p = preview.getBoundingClientRect();
      const glyphLines = Array.from(glyph.children).map(line => line.getBoundingClientRect());
      const previewLines = Array.from(document.querySelectorAll('[data-blok-placement-preview-line]')).map(line => line.getBoundingClientRect());
      const cx = t.left + t.width / 2;
      const cy = t.top + t.height / 2;

      return {
        thumbInside: cx > b.left && cx < b.right && cy > b.top && cy < b.bottom,
        buttonX: Object.fromEntries(['top-left', 'top-center', 'top-right'].map(name => [
          name,
          document.querySelector(`[data-placement="${name}"]`)?.getBoundingClientRect().x ?? Number.NaN,
        ])),
        glyphLinesFrom: {
          left: Math.min(...glyphLines.map(line => line.left)) - g.left,
          right: g.right - Math.max(...glyphLines.map(line => line.right)),
        },
        previewLinesFrom: {
          left: previewLines.map(line => line.left - p.left),
          right: previewLines.map(line => p.right - line.right),
        },
      };
    }, placement);

  /**
   * Per cell: its text-align and the side every line is flush with. Line
   * widths are not compared: the ghost inherits the host page's font stack.
   */
  const cellTextLayout = async (page: Page, rootSelector: string): Promise<Array<{ align: string; flush: string; wraps: boolean }>> =>
    page.evaluate(selector => {
      const root = document.querySelector(selector);

      if (root === null) {
        throw new Error(`no ${selector}`);
      }

      return Array.from(root.querySelectorAll('[data-blok-table-cell-blocks]')).map(blocks => {
        const editable = blocks.querySelector('[data-blok-element-content] > *');
        const range = document.createRange();
        const box = blocks.getBoundingClientRect();

        range.selectNodeContents(editable ?? blocks);

        const lines = Array.from(range.getClientRects()).filter(line => line.width > 0);
        const flushLeft = lines.every(line => line.left - box.left <= 1.5);
        const flushRight = lines.every(line => box.right - line.right <= 1.5);

        return {
          align: getComputedStyle(blocks).textAlign,
          flush: `${flushLeft ? 'left' : ''}${flushRight ? 'right' : ''}`,
          wraps: lines.length > 1,
        };
      });
    }, rootSelector);

  for (const direction of ['ltr', 'rtl'] as const) {
    test(`${direction}: a dragged row's ghost lines its text up like the row`, async ({ page }) => {
      const children: OutputData['blocks'] = [];
      const placements = [undefined, 'top-center', 'top-right'];
      const content = [0, 1].map(r => placements.map((placement, c) => {
        const id = `g${r}${c}`;

        children.push({ id, type: 'paragraph', data: { text: LONG_TEXT[direction] }, parent: 't' });

        return placement === undefined ? { blocks: [id] } : { blocks: [id], placement };
      }));

      await createBlok(page, {
        blocks: [
          { id: 't', type: 'table', data: { withHeadings: false, content, colWidths: [200, 200, 200] }, content: children.map(child => child.id ?? '') },
          ...children,
        ],
      }, direction);

      const source = await box(page, cell(0, 0));

      await page.mouse.move(center(source).x, center(source).y);

      const grip = center(await box(page, '[data-blok-table-grip-row="0"]'));

      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      await page.mouse.move(grip.x, grip.y + 20, { steps: 5 });
      await expect(page.locator('[data-blok-table-drag-ghost]')).toBeAttached();

      const ghost = await cellTextLayout(page, '[data-blok-table-drag-ghost]');
      const row = await cellTextLayout(page, `${GRID} tr`);

      await page.mouse.up();

      expect(row.map(one => one.wraps), 'row text wraps').toEqual([true, true, true]);
      expect(ghost).toEqual(row);
    });
  }

  for (const direction of ['ltr', 'rtl'] as const) {
    test(`${direction}: the placement picker lays out its options where the content goes`, async ({ page }) => {
      await createBlok(page, tableData(cellText(direction)), direction);
      await openPlacementPicker(page);
      await page.locator('[data-placement="middle-right"]').click({ force: true });
      await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);

      const geometry = await pickerGeometry(page, 'middle-right');
      // "right" is the inline end: physically left in RTL.
      const endIsLeft = direction === 'rtl';

      expect(geometry.thumbInside, 'thumb sits on the picked option').toBe(true);
      expect(geometry.buttonX['top-right'] < geometry.buttonX['top-left'], 'end column on the end side').toBe(endIsLeft);
      expect(geometry.glyphLinesFrom.left < geometry.glyphLinesFrom.right, 'glyph lines at the end side').toBe(endIsLeft);

      const nearSide = endIsLeft ? geometry.previewLinesFrom.left : geometry.previewLinesFrom.right;
      const farSide = endIsLeft ? geometry.previewLinesFrom.right : geometry.previewLinesFrom.left;

      for (const [index, near] of nearSide.entries()) {
        expect(near, 'preview lines flush with the end side').toBeLessThan(farSide[index]);
        expect(near).toBeGreaterThanOrEqual(0);
      }
      expect(new Set(nearSide.map(Math.round)).size, 'preview lines share one edge').toBe(1);

      const named = async (name: string): Promise<number> => (await box(page, `[role="radio"][aria-label="${name}"]`)).x;

      expect(await named('Top right'), 'the option named right sits on the right').toBeGreaterThan(await named('Top left'));

      const saved = await savedTable(page);

      expect((saved.content[0][0] as { placement?: string }).placement).toBe('middle-right');
    });
  }
});

// A table takes the direction of the block it sits in. Inside an English
// toggle in an RTL editor it lays out LTR, so its placement must too.
test('a table inside an LTR toggle in an RTL editor aligns cells by the table, not the editor', async ({ page }) => {
  const text = 'Alpha';

  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await createBlok(page, {
    blocks: [
      { id: 'tog', type: 'toggle', data: { text: 'English toggle', isOpen: true }, content: [ 't' ] },
      {
        id: 't',
        type: 'table',
        parent: 'tog',
        data: { withHeadings: false, content: [ [ { blocks: [ 'c0' ] }, { blocks: [ 'c1' ], placement: 'top-right' } ] ] },
        content: [ 'c0', 'c1' ],
      },
      { id: 'c0', type: 'paragraph', data: { text }, parent: 't' },
      { id: 'c1', type: 'paragraph', data: { text }, parent: 't' },
    ],
  }, 'rtl');

  const sides = await page.evaluate(() => Array.from(document.querySelectorAll('[data-blok-table-cell-blocks]')).map((container) => {
    const editable = container.querySelector('[contenteditable="true"]');

    if (editable === null) {
      return null;
    }
    const range = document.createRange();

    range.selectNodeContents(editable);
    const box = container.getBoundingClientRect();
    const textBox = range.getBoundingClientRect();

    return { left: Math.round(textBox.left - box.left), right: Math.round(box.right - textBox.right) };
  }));

  // LTR grid: the default cell hugs the left, the "right" cell hugs the right.
  expect(sides[0]?.left).toBeLessThanOrEqual(2);
  expect(sides[1]?.right).toBeLessThanOrEqual(2);
});

