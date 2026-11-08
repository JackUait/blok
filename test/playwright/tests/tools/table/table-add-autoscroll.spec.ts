// spec: adding rows and columns scrolls whatever holds the table so the new ones stay in view
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

const HOLDER_ID = 'blok';
const ROW_SELECTOR = '[data-blok-table-row]';
const MODAL_SELECTOR = '[data-blok-table-fullscreen]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const tableOf = (rows: number, cols: number): OutputData => ({
  blocks: [
    {
      id: 'tbl',
      type: 'table',
      data: {
        withHeadings: true,
        content: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (__, c) => `R${r}C${c}`)),
      },
    },
    { id: 'after', type: 'paragraph', data: { text: 'After the table' } },
  ],
});

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await page.evaluate(async ({ holder, blocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const classes = (window as unknown as Record<string, Record<string, unknown>>).Blok;
    const blok = new window.Blok({ holder, data: blocks, tools: { table: { class: classes.Table } } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks: data });
};

const openFullscreen = async (page: Page): Promise<Locator> => {
  await page.evaluate(() => document.querySelector<HTMLElement>('[data-blok-table-fullscreen-toggle]')?.click());
  const modal = page.locator(MODAL_SELECTOR);

  await expect(page.getByRole('dialog')).toBeVisible();
  // Let the open motion finish so boxes are where they stay.
  await expect.poll(() => modal.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);

  return modal;
};

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const b = await locator.boundingBox();

  if (b === null) {
    throw new Error('element is not laid out');
  }

  return b;
};

/** The last row's bottom edge, against the bottom of the box that scrolls it. */
const lastRowBottom = async (page: Page): Promise<number> =>
  page.locator(ROW_SELECTOR).last().evaluate(el => el.getBoundingClientRect().bottom);

/** Records, in page time, when the first row's cell count changes and when the pointer last moved. */
const watchColumns = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const w = window as unknown as { colChanges: number[]; lastMove: number; colCount: number; colWatching?: boolean };
    const cells = (): number => document.querySelector('[data-blok-table-row]')?.querySelectorAll('[data-blok-table-cell]').length ?? 0;

    w.colChanges = [];
    w.lastMove = 0;
    w.colCount = cells();

    // The page is shared between tests: a second loop would record every change twice.
    if (w.colWatching === true) {
      return;
    }
    w.colWatching = true;
    document.addEventListener('pointermove', e => { w.lastMove = e.timeStamp; }, true);
    const loop = (t: number): void => {
      if (cells() !== w.colCount) {
        w.colCount = cells();
        w.colChanges.push(t);
      }
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  });
};

/** Page time from the last pointer move to the first column change after it. */
const msToNextColumn = async (page: Page): Promise<number> => {
  await expect.poll(() => page.evaluate(() => {
    const w = window as unknown as { colChanges: number[]; lastMove: number };

    return w.colChanges.some(t => t > w.lastMove);
  }), { timeout: 5_000 }).toBe(true);

  return page.evaluate(() => {
    const w = window as unknown as { colChanges: number[]; lastMove: number };

    return (w.colChanges.find(t => t > w.lastMove) ?? Infinity) - w.lastMove;
  });
};

/** Gaps between column changes since the last pointer move, skipping the first (the drag's own). */
const heldIntervals = async (page: Page): Promise<number[]> => page.evaluate(() => {
  const w = window as unknown as { colChanges: number[]; lastMove: number };
  const held = w.colChanges.filter(t => t > w.lastMove);

  return held.slice(2).map((t, i) => t - held[i + 1]);
});

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? Infinity;
};

test.describe('Adding rows and columns keeps them in view', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('holding the add-row bar at the bottom of the full-screen table keeps adding rows and scrolls to them', async ({ page }) => {
    await createBlok(page, tableOf(6, 3));
    const modal = await openFullscreen(page);
    const rows = page.locator(ROW_SELECTOR);
    const modalBox = await box(modal);
    const grid = await box(modal.getByRole('table'));

    await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height - 10);
    const bar = page.locator('[data-blok-table-add-row]');
    const barBox = await box(bar);

    await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(barBox.x + barBox.width / 2, modalBox.y + modalBox.height - 2, { steps: 8 });
    const parked = await rows.count();

    await expect.poll(() => rows.count(), { timeout: 5_000 }).toBeGreaterThan(parked + 3);
    expect(await modal.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await lastRowBottom(page)).toBeLessThanOrEqual(modalBox.y + modalBox.height);
    await page.mouse.up();
  });

  test('holding the corner at the bottom of the full-screen table keeps adding rows and scrolls to them', async ({ page }) => {
    await createBlok(page, tableOf(6, 3));
    const modal = await openFullscreen(page);
    const rows = page.locator(ROW_SELECTOR);
    const modalBox = await box(modal);
    const grid = await box(modal.getByRole('table'));

    await page.mouse.move(grid.x + grid.width - 4, grid.y + grid.height - 4);
    const corner = await box(page.locator('[data-blok-table-corner-drag]'));

    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
    await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2, modalBox.y + modalBox.height - 2, { steps: 8 });
    const parked = await rows.count();

    await expect.poll(() => rows.count(), { timeout: 5_000 }).toBeGreaterThan(parked + 3);
    expect(await modal.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    expect(await lastRowBottom(page)).toBeLessThanOrEqual(modalBox.y + modalBox.height);
    await page.mouse.up();
  });

  test('holding the add-column bar past the end keeps adding columns and scrolls to them', async ({ page }) => {
    await createBlok(page, tableOf(3, 6));
    const modal = await openFullscreen(page);
    const columns = page.locator(ROW_SELECTOR).first().locator('[data-blok-table-cell]');
    const modalBox = await box(modal);
    const grid = await box(modal.getByRole('table'));

    await page.mouse.move(grid.x + grid.width - 10, grid.y + grid.height / 2);
    const bar = await box(page.locator('[data-blok-table-add-col]'));

    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.mouse.down();
    // Past the modal, to the window edge: the drag must first outgrow the modal to clip the grid.
    await page.mouse.move((page.viewportSize()?.width ?? modalBox.x + modalBox.width) - 2, bar.y + bar.height / 2, { steps: 8 });
    const parked = await columns.count();

    await expect.poll(() => columns.count(), { timeout: 5_000 }).toBeGreaterThan(parked + 3);
    const scroller = modal.locator('[data-blok-table-scroll]');

    expect(await scroller.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
    const lastCell = await box(columns.last());
    const scrollerBox = await box(scroller);

    expect(lastCell.x + lastCell.width).toBeLessThanOrEqual(scrollerBox.x + scrollerBox.width + 1);
    await page.mouse.up();
  });

  test('holding the add-column bar of a full-screen table that fits keeps adding columns', async ({ page }) => {
    await createBlok(page, tableOf(5, 3));
    const modal = await openFullscreen(page);
    const columns = page.locator(ROW_SELECTOR).first().locator('[data-blok-table-cell]');
    const grid = await box(modal.getByRole('table'));

    await page.mouse.move(grid.x + grid.width - 10, grid.y + grid.height / 2);
    const bar = await box(page.locator('[data-blok-table-add-col]'));

    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.mouse.down();
    // The bar sits by the window edge: there is no room left to drag a column out.
    await page.mouse.move((page.viewportSize()?.width ?? 1280) - 2, bar.y + bar.height / 2, { steps: 8 });

    await expect.poll(() => columns.count(), { timeout: 5_000 }).toBeGreaterThan(5);
    await page.mouse.up();
    expect(await columns.count()).toBeGreaterThan(5);
  });

  test('holding the corner of a full-screen table at the window edge keeps adding columns and rows', async ({ page }) => {
    await createBlok(page, tableOf(5, 3));
    const modal = await openFullscreen(page);
    const columns = page.locator(ROW_SELECTOR).first().locator('[data-blok-table-cell]');
    const grid = await box(modal.getByRole('table'));

    await page.mouse.move(grid.x + grid.width - 4, grid.y + grid.height - 4);
    const corner = await box(page.locator('[data-blok-table-corner-drag]'));
    const start = { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move((page.viewportSize()?.width ?? 1280) - 2, start.y + 120, { steps: 12 });

    await expect.poll(() => columns.count(), { timeout: 5_000 }).toBeGreaterThan(6);
    expect(await page.locator(ROW_SELECTOR).count()).toBeGreaterThan(5);
    await page.mouse.up();
    expect(await columns.count()).toBeGreaterThan(6);
  });

  // More columns than a screen of pull-back can remove: holding at the start edge keeps removing.
  test('pulling the add-column bar back to the window start removes every column the drag added', async ({ page }) => {
    // Growing past a screen and back is held auto-scroll in both directions.
    test.setTimeout(60_000);
    await createBlok(page, tableOf(5, 3));
    const modal = await openFullscreen(page);
    const columns = page.locator(ROW_SELECTOR).first().locator('[data-blok-table-cell]');
    const grid = await box(modal.getByRole('table'));

    await page.mouse.move(grid.x + grid.width - 10, grid.y + grid.height / 2);
    const bar = await box(page.locator('[data-blok-table-add-col]'));
    const y = bar.y + bar.height / 2;

    await page.mouse.move(bar.x + bar.width / 2, y);
    await page.mouse.down();
    await page.mouse.move((page.viewportSize()?.width ?? 1280) - 2, y, { steps: 8 });
    await expect.poll(() => columns.count(), { timeout: 20_000 }).toBeGreaterThan(20);
    await page.mouse.move(2, y, { steps: 20 });

    await expect.poll(() => columns.count(), { timeout: 15_000 }).toBe(3);
    await page.mouse.up();
  });

  test('pulling the corner back to the window start removes every column the drag added', async ({ page }) => {
    // Growing past a screen and back is held auto-scroll in both directions.
    test.setTimeout(60_000);
    await createBlok(page, tableOf(5, 3));
    const modal = await openFullscreen(page);
    const columns = page.locator(ROW_SELECTOR).first().locator('[data-blok-table-cell]');
    const grid = await box(modal.getByRole('table'));

    await page.mouse.move(grid.x + grid.width - 4, grid.y + grid.height - 4);
    const corner = await box(page.locator('[data-blok-table-corner-drag]'));
    const y = corner.y + corner.height / 2;

    await page.mouse.move(corner.x + corner.width / 2, y);
    await page.mouse.down();
    await page.mouse.move((page.viewportSize()?.width ?? 1280) - 2, y, { steps: 8 });
    await expect.poll(() => columns.count(), { timeout: 20_000 }).toBeGreaterThan(15);
    await page.mouse.move(2, y, { steps: 20 });

    await expect.poll(() => columns.count(), { timeout: 15_000 }).toBe(3);
    await page.mouse.up();
  });

  test('holding the add-column bar at the window edge adds the first column right away', async ({ page }) => {
    await createBlok(page, tableOf(5, 3));
    const modal = await openFullscreen(page);
    const grid = await box(modal.getByRole('table'));

    await page.mouse.move(grid.x + grid.width - 10, grid.y + grid.height / 2);
    const bar = await box(page.locator('[data-blok-table-add-col]'));
    const y = bar.y + bar.height / 2;

    await page.mouse.move(bar.x + bar.width / 2, y);
    await page.mouse.down();
    await watchColumns(page);
    await page.mouse.move((page.viewportSize()?.width ?? 1280) - 2, y, { steps: 2 });

    expect(await msToNextColumn(page)).toBeLessThan(250);
    await page.mouse.up();
  });

  test('holding the corner at the window edge adds the next column right away', async ({ page }) => {
    await createBlok(page, tableOf(5, 3));
    const modal = await openFullscreen(page);
    const columns = page.locator(ROW_SELECTOR).first().locator('[data-blok-table-cell]');
    const grid = await box(modal.getByRole('table'));

    await page.mouse.move(grid.x + grid.width - 4, grid.y + grid.height - 4);
    const corner = await box(page.locator('[data-blok-table-corner-drag]'));
    const y = corner.y + corner.height / 2;

    await page.mouse.move(corner.x + corner.width / 2, y);
    await page.mouse.down();
    // The drag itself lays down the first column; the hold must add the next.
    await page.mouse.move((page.viewportSize()?.width ?? 1280) - 40, y, { steps: 4 });
    await expect.poll(() => columns.count()).toBe(4);
    await watchColumns(page);
    await page.mouse.move((page.viewportSize()?.width ?? 1280) - 2, y, { steps: 2 });

    expect(await msToNextColumn(page)).toBeLessThan(250);
    await page.mouse.up();
  });

  for (const handle of ['add-column bar', 'corner'] as const) {
    test(`holding the ${handle} at either window edge adds and removes columns at one steady pace`, async ({ page }) => {
      test.setTimeout(60_000);
      await createBlok(page, tableOf(5, 3));
      const modal = await openFullscreen(page);
      const columns = page.locator(ROW_SELECTOR).first().locator('[data-blok-table-cell]');
      const grid = await box(modal.getByRole('table'));
      const target = handle === 'corner' ? '[data-blok-table-corner-drag]' : '[data-blok-table-add-col]';

      await page.mouse.move(grid.x + grid.width - 4, grid.y + grid.height - 4);
      const grip = await box(page.locator(target));
      const y = grip.y + grip.height / 2;

      await page.mouse.move(grip.x + grip.width / 2, y);
      await page.mouse.down();
      await watchColumns(page);
      await page.mouse.move((page.viewportSize()?.width ?? 1280) - 2, y, { steps: 2 });
      // The trip back across the window removes about 11 columns on its own; the
      // the hold needs enough left over to show its pace.
      await expect.poll(() => columns.count(), { timeout: 10_000 }).toBeGreaterThan(20);
      const adding = await heldIntervals(page);

      await page.mouse.move(2, y, { steps: 2 });
      await expect.poll(() => columns.count(), { timeout: 10_000 }).toBe(3);
      const removing = await heldIntervals(page);

      // About six columns a second both ways, whatever their width.
      expect(median(adding)).toBeGreaterThan(120);
      expect(median(adding)).toBeLessThan(230);
      expect(median(removing)).toBeGreaterThan(120);
      expect(median(removing)).toBeLessThan(230);
      await page.mouse.up();
    });
  }

  test('clicking add row with the table at the bottom of the window scrolls the new row into view', async ({ page }) => {
    await createBlok(page, tableOf(30, 3));
    const rows = page.locator(ROW_SELECTOR);
    const viewport = page.viewportSize();

    if (viewport === null) {
      throw new Error('viewport size unavailable');
    }
    // Park the add bar at the very bottom of the window, where one more row cannot fit.
    await page.evaluate((height) => {
      const grid = document.querySelector('table');

      if (grid !== null) {
        window.scrollBy(0, grid.getBoundingClientRect().bottom + 30 - height);
      }
    }, viewport.height);
    const grid = await box(page.getByRole('table'));

    await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height - 10);
    const bar = await box(page.locator('[data-blok-table-add-row]'));
    const before = await rows.count();

    await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await expect(rows).toHaveCount(before + 1);
    expect(await lastRowBottom(page)).toBeLessThanOrEqual(viewport.height);
  });

  test('holding the add-row bar at the bottom of the window keeps adding rows and scrolls the page', async ({ page }) => {
    await createBlok(page, tableOf(6, 3));
    const rows = page.locator(ROW_SELECTOR);
    const viewport = page.viewportSize();

    if (viewport === null) {
      throw new Error('viewport size unavailable');
    }
    const grid = await box(page.getByRole('table'));

    await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height - 10);
    const bar = await box(page.locator('[data-blok-table-add-row]'));

    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width / 2, viewport.height - 2, { steps: 8 });
    const parked = await rows.count();

    await expect.poll(() => rows.count(), { timeout: 5_000 }).toBeGreaterThan(parked + 3);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    expect(await lastRowBottom(page)).toBeLessThanOrEqual(viewport.height);
    await page.mouse.up();
  });
});
