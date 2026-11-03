// spec: open a table in a full-screen modal and edit it there
import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const OPEN_LABEL = 'Open in full screen';
const CLOSE_LABEL = 'Close full screen';

declare global {
  interface Window {
    blokInstance?: Blok;
    fullscreenChanges?: number;
  }
}

const tableData: OutputData = {
  blocks: [
    {
      id: 'tbl',
      type: 'table',
      data: {
        withHeadings: true,
        content: [['Feature', 'Status'], ['Grid rendering', 'Complete']],
      },
    },
    { id: 'after', type: 'paragraph', data: { text: 'After the table' } },
  ],
};

const headedData: OutputData = {
  blocks: [
    { id: 'title', type: 'header', data: { text: 'Feature status', level: 3 } },
    ...tableData.blocks,
  ],
};

/** How far the button sits in from the table's inline-end edge. */
const CORNER_INSET = 6;

const narrowData: OutputData = {
  blocks: [
    {
      id: 'tbl',
      type: 'table',
      data: {
        withHeadings: true,
        colWidths: [180, 180],
        content: [['Feature', 'Status'], ['Grid rendering', 'Complete'], ['Paste', 'Complete']],
      },
    },
  ],
};

const wideData: OutputData = {
  blocks: [
    {
      id: 'tbl',
      type: 'table',
      data: {
        withHeadings: true,
        colWidths: Array.from({ length: 8 }, () => 300),
        content: [Array.from({ length: 8 }, (_, c) => `H${c}`), Array.from({ length: 8 }, (_, c) => `C${c}`)],
      },
    },
  ],
};

const createBlok = async (page: Page, readOnly = false, data: OutputData = tableData): Promise<void> => {
  await page.evaluate(async ({ holder, data: blocks, readOnly: isReadOnly }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    window.fullscreenChanges = 0;

    const classes = (window as unknown as Record<string, Record<string, unknown>>).Blok;
    const blok = new window.Blok({
      holder,
      readOnly: isReadOnly,
      data: blocks,
      tools: { table: { class: classes.Table }, header: { class: classes.Header } },
      onChange: () => {
        window.fullscreenChanges = (window.fullscreenChanges ?? 0) + 1;
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data, readOnly });

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
};

/** A 40×30 table; returns how many elements the table box holds. */
const createLargeTable = async (page: Page): Promise<number> => {
  const rows = 40;
  const cols = 30;

  await page.setViewportSize({ width: 1400, height: 800 });
  await createBlok(page, false, {
    blocks: [{
      id: 'tbl',
      type: 'table',
      data: { withHeadings: true, content: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')) },
    }],
  });

  return page.locator(TABLE_SELECTOR).evaluate(el => el.closest('[data-blok-element-content]')?.querySelectorAll('*').length ?? 0);
};

/**
 * How many element styles Chrome computes while `action` runs, read from a
 * trace. Chromium only, which is all this spec runs in.
 */
const countStyled = async (page: Page, action: () => Promise<void>): Promise<number> => {
  const cdp = await page.context().newCDPSession(page);
  const events: unknown[] = [];

  cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
  const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve));

  await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
  await action();
  await cdp.send('Tracing.end');
  await done;
  await cdp.detach();

  return events.reduce<number>((sum, event) => sum + styledIn(event), 0);
};

/** The element count of a style recalc trace event, 0 for any other event. */
const styledIn = (event: unknown): number => {
  if (typeof event !== 'object' || event === null || !('name' in event) || event.name !== 'UpdateLayoutTree' || !('args' in event)) {
    return 0;
  }
  const { args } = event;

  return typeof args === 'object' && args !== null && 'elementCount' in args && typeof args.elementCount === 'number'
    ? args.elementCount
    : 0;
};

const openWithButton = async (page: Page): Promise<void> => {
  await page.locator(TABLE_SELECTOR).hover();
  await page.getByRole('button', { name: OPEN_LABEL }).click();
  await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
};

/** The button's opacity once its fade has finished. */
const settledOpacity = async (locator: Locator): Promise<string> =>
  locator.evaluate(el => (el.getAnimations().length > 0 ? 'fading' : getComputedStyle(el).opacity));

/** The element painted at the centre of `selector`'s box, inside it or not. */
const paintsOnTop = async (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);

    if (!(el instanceof HTMLElement)) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);

    return hit !== null && el.contains(hit);
  }, selector);

test.describe('Table full screen', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('the hover button opens the table in a modal that fills the viewport and Escape closes it', async ({ page }) => {
    await createBlok(page);
    const parentBefore = await page.locator(TABLE_SELECTOR).evaluate(el => el.parentElement?.getAttribute('data-blok-element-content') !== null);

    await openWithButton(page);

    const dialog = page.getByRole('dialog', { name: 'Table' });
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };

    expect(box?.width ?? 0).toBeGreaterThan(viewport.width * 0.9);
    expect(box?.height ?? 0).toBeGreaterThan(viewport.height * 0.9);
    // The live table is shown, not a copy.
    await expect(dialog.locator('[data-blok-tool="table"]')).toHaveCount(1);
    await expect(page.locator(TABLE_SELECTOR)).toHaveCount(1);
    expect(parentBefore).toBe(true);
    // While the box grows its clip is still the table's inline rect, so poll past the motion.
    await expect.poll(() => paintsOnTop(page, '[data-blok-table-fullscreen]')).toBe(true);

    await page.locator(CELL_SELECTOR).first().click();
    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-blok-table-fullscreen-backdrop]')).toHaveCount(0);
  });

  test('opening and closing does not change the document', async ({ page }) => {
    await createBlok(page);
    const before = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks);
    const changesBefore = await page.evaluate(() => window.fullscreenChanges);

    await openWithButton(page);
    await page.getByRole('button', { name: CLOSE_LABEL }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // onChange is debounced, so "nothing fired" needs a quiet window.
    const changesAfter = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));

      return window.fullscreenChanges;
    });

    expect(changesAfter).toBe(changesBefore);
    expect(await page.evaluate(async () => (await window.blokInstance?.save())?.blocks)).toEqual(before);
    await expect(page.getByRole('button', { name: OPEN_LABEL })).toBeFocused();
  });

  test('a cell edited in full screen is saved', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    const cell = page.getByRole('dialog').locator('[contenteditable="true"]').filter({ hasText: 'Complete' });

    await cell.click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');

    await expect.poll(async () => JSON.stringify(await page.evaluate(async () => window.blokInstance?.save()))).toContain('Complete!');
  });

  test('the inline toolbar paints above the full-screen table', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    const cell = page.getByRole('dialog').locator('[contenteditable="true"]').filter({ hasText: 'Complete' });

    await cell.selectText();
    await expect(page.getByTestId('inline-toolbar')).toBeVisible();

    await expect.poll(() => paintsOnTop(page, '[data-blok-testid="inline-toolbar"] [data-blok-popover-container], [data-blok-testid="inline-toolbar"] > *')).toBe(true);
  });

  test('Escape closes a menu opened from the table before the modal', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.locator('[data-blok-table-cell-row="1"][data-blok-table-cell-col="0"]').click();
    const rowGrip = page.locator('[data-blok-table-grip-row="1"]');

    await expect(rowGrip).toBeVisible();
    await rowGrip.click();
    await expect(page.getByText('Duplicate', { exact: true })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByText('Duplicate', { exact: true })).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
  });

  test('clicking the backdrop closes the modal', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.mouse.click(4, 4);

    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the block menu opens the table in full screen', async ({ page }) => {
    await createBlok(page);
    await page.locator(CELL_SELECTOR).first().click();
    await page.locator(SETTINGS_BUTTON_SELECTOR).click();
    await page.locator('[data-blok-item-name="table-open-fullscreen"]').click();

    await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
  });

  test('a read-only table opens in full screen too', async ({ page }) => {
    await createBlok(page, true);
    await openWithButton(page);

    await expect(page.getByRole('button', { name: CLOSE_LABEL })).toBeVisible();
  });

  test('deleting the table while it is open removes the backdrop', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.evaluate(async () => {
      await window.blokInstance?.blocks.delete(0);
    });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-blok-table-fullscreen-backdrop]')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.hasAttribute('data-blok-scroll-locked'))).toBe(false);
  });

  test('the modal header names the table after the heading above it and shows its size', async ({ page }) => {
    await createBlok(page, false, headedData);
    await page.locator(TABLE_SELECTOR).hover();
    await page.getByRole('button', { name: OPEN_LABEL }).click();

    const dialog = page.getByRole('dialog', { name: 'Feature status' });

    await expect(dialog).toBeVisible();
    const header = dialog.locator('[data-blok-table-fullscreen-header]');

    await expect(header).toBeVisible();
    await expect(header).toContainText('Feature status');
    await expect(header).toContainText('2 × 2');
  });

  test('a table with no heading above it is titled Table', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await expect(page.locator('[data-blok-table-fullscreen-header]')).toContainText('Table');
  });

  test('the header stays hidden while the table is inline', async ({ page }) => {
    await createBlok(page, false, headedData);

    await expect(page.locator('[data-blok-table-fullscreen-header]')).toBeHidden();
  });

  test('the modal grows out of the table and shrinks back into it', async ({ page }) => {
    await createBlok(page);
    await page.locator(TABLE_SELECTOR).hover();

    const clipAnimations = async (): Promise<number> => page.evaluate(() => {
      const box = document.querySelector('[data-blok-tool="table"]')?.closest('[data-blok-element-content]');

      return box?.getAnimations().filter(a => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)
        && JSON.stringify((a.effect as KeyframeEffect | null)?.getKeyframes()).includes('clip')).length ?? 0;
    });

    await page.getByRole('button', { name: OPEN_LABEL }).click();
    expect(await clipAnimations()).toBeGreaterThan(0);
    await expect.poll(clipAnimations).toBe(0);

    await page.getByRole('button', { name: CLOSE_LABEL }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // It shrinks while still above the page, then lands back inline.
    expect(await clipAnimations()).toBeGreaterThan(0);
    await expect(page.locator('[data-blok-table-fullscreen-backdrop]')).toHaveCount(0);
    expect(await page.locator('[data-blok-tool="table"]').evaluate(el => el.closest('[data-blok-element-content]')?.matches(':popover-open'))).toBe(false);
  });

  test('a narrow table grows from and shrinks back into its own shape', async ({ page }) => {
    await createBlok(page, false, narrowData);
    const grid = await page.getByRole('table').evaluate((el) => {
      const r = el.getBoundingClientRect();

      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    });

    /** The box the clip animation shows at its open (first) or closed (last) keyframe. */
    const clipBox = async (end: 'first' | 'last'): Promise<{ left: number; top: number; right: number; bottom: number } | null> =>
      page.evaluate((which) => {
        const host = document.querySelector('[data-blok-tool="table"]')?.closest('[data-blok-element-content]');
        const clip = host?.getAnimations()
          .map(a => (a.effect as KeyframeEffect | null)?.getKeyframes() ?? [])
          .find(frames => frames.some(f => typeof f.clipPath === 'string'));

        if (host === undefined || host === null || clip === undefined) {
          return null;
        }
        const frame = which === 'first' ? clip[0] : clip[clip.length - 1];
        const [t, r, b, l] = String(frame.clipPath).match(/-?[\d.]+px/g)?.map(parseFloat) ?? [];
        const box = host.getBoundingClientRect();

        return { left: box.left + l, top: box.top + t, right: box.right - r, bottom: box.bottom - b };
      }, end);

    await page.getByRole('table').hover();
    await page.getByRole('button', { name: OPEN_LABEL }).click();
    const opened = await clipBox('first');

    expect(opened).not.toBeNull();
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      expect(Math.abs((opened?.[side] ?? 0) - grid[side])).toBeLessThanOrEqual(1);
    }

    await expect.poll(() => clipBox('first')).toBeNull();
    await page.getByRole('button', { name: CLOSE_LABEL }).click();
    const closed = await clipBox('last');

    expect(closed).not.toBeNull();
    for (const side of ['left', 'top', 'right', 'bottom'] as const) {
      expect(Math.abs((closed?.[side] ?? 0) - grid[side])).toBeLessThanOrEqual(1);
    }
  });

  test('a fluid table does not shift as it shrinks back or when it lands', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await createBlok(page);
    const cell = page.locator(`[data-blok-table-row]:first-child ${CELL_SELECTOR}`).nth(1);
    const boxOf = async (): Promise<{ x: number; y: number; width: number }> => cell.evaluate((el) => {
      const r = el.getBoundingClientRect();

      return { x: r.x, y: r.y, width: r.width };
    });
    const inline = await boxOf();

    await openWithButton(page);
    const modal = page.locator('[data-blok-table-fullscreen]');

    await expect.poll(() => modal.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
    expect((await boxOf()).width).toBeGreaterThan(inline.width + 50);

    await page.getByRole('button', { name: CLOSE_LABEL }).click();
    // The last frame of the close motion.
    await page.evaluate(() => document.getAnimations().forEach((animation) => {
      animation.pause();
      Object.assign(animation, { currentTime: 419 });
    }));
    const landing = await boxOf();

    for (const key of ['x', 'y', 'width'] as const) {
      expect(Math.abs(landing[key] - inline[key])).toBeLessThanOrEqual(1);
    }

    await page.evaluate(() => document.getAnimations().forEach(a => a.play()));
    await expect(page.locator('[data-blok-table-fullscreen-backdrop]')).toHaveCount(0);
    const landed = await boxOf();

    for (const key of ['x', 'y', 'width'] as const) {
      expect(Math.abs(landed[key] - inline[key])).toBeLessThanOrEqual(1);
    }
  });

  test('opening restyles only the table box, not every cell', async ({ page }) => {
    const tableElements = await createLargeTable(page);
    const styled = await countStyled(page, async () => {
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-blok-table-fullscreen-toggle]')?.click());
    });

    // A restyle of every cell styles each element several times over (its
    // pseudo-elements and highlights) and freezes a large table for seconds.
    expect(styled).toBeLessThan(tableElements);
  });

  test('closing restyles only the table box, not every cell, through the landing', async ({ page }) => {
    const tableElements = await createLargeTable(page);

    await openWithButton(page);
    await expect.poll(() => page.locator('[data-blok-table-fullscreen]').evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);

    const styled = await countStyled(page, async () => {
      await page.evaluate(() => document.querySelector<HTMLElement>('[data-blok-table-fullscreen-toggle]')?.click());
      await expect(page.locator('[data-blok-table-fullscreen]')).toHaveCount(0);
    });

    // The grips and heading cells restyle as the dialog role goes and as the
    // table relays out; that scales with rows and columns, not with cells.
    expect(styled).toBeLessThan(tableElements);
  });

  test('the table sits close to the header and to the modal sides', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);
    const modal = page.locator('[data-blok-table-fullscreen]');

    await expect.poll(() => modal.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
    const gaps = await modal.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const header = el.querySelector('[data-blok-table-fullscreen-header]')?.getBoundingClientRect();
      const scroller = el.querySelector('[data-blok-table-scroll]')?.getBoundingClientRect();

      return header === undefined || scroller === undefined
        ? null
        : { top: scroller.top - header.bottom, start: scroller.left - box.left, end: box.right - scroller.right };
    });

    expect(gaps).not.toBeNull();
    expect(gaps?.top).toBeLessThanOrEqual(12);
    expect(gaps?.start).toBeLessThanOrEqual(16);
    // The end also holds the add-column strip (the tool root's pe-5).
    expect(gaps?.end).toBeLessThanOrEqual(16 + 20);
  });

  test('with reduced motion the modal opens and closes at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createBlok(page);

    const animationsAfterClick = async (): Promise<number> => page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-blok-table-fullscreen-toggle]')?.click();
      const box = document.querySelector('[data-blok-tool="table"]')?.closest('[data-blok-element-content]');

      return box?.getAnimations().filter(a => !(a instanceof CSSTransition) && !(a instanceof CSSAnimation)).length ?? -1;
    });

    expect(await animationsAfterClick()).toBe(0);
    await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
    expect(await animationsAfterClick()).toBe(0);
    await expect(page.locator('[data-blok-table-fullscreen-backdrop]')).toHaveCount(0);
  });

  test('opening starts no CSS transitions and the motion animates no layout properties', async ({ page }) => {
    await createBlok(page);

    const motion = await page.evaluate(() => {
      document.querySelector<HTMLElement>('[data-blok-table-fullscreen-toggle]')?.click();

      return document.getAnimations().map(a => ({
        transition: a instanceof CSSTransition ? a.transitionProperty : null,
        properties: [...new Set(((a.effect as KeyframeEffect | null)?.getKeyframes() ?? [])
          .flatMap(k => Object.keys(k))
          .filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)))],
      }));
    });

    // An inherited `color` transition restyles every cell each frame; a layout property relays the table out.
    expect(motion.filter(m => m.transition !== null && m.transition !== 'opacity')).toEqual([]);
    expect(motion.flatMap(m => m.properties).filter(p => !['transform', 'clipPath', 'opacity'].includes(p))).toEqual([]);
  });

  test('the backdrop has no backdrop filter', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    // A blur re-renders under the growing sheet on every frame.
    const filter = await page.locator('[data-blok-table-fullscreen-backdrop]').evaluate(el => getComputedStyle(el).backdropFilter);

    expect(filter).toBe('none');
  });

  test('the page under the modal keeps its layout', async ({ page }) => {
    await createBlok(page);
    const after = page.getByText('After the table');
    const before = await after.boundingBox();

    await openWithButton(page);

    expect(await after.boundingBox()).toEqual(before);
  });

  test('a scrolled page stays where it was when the modal opens and closes', async ({ page }) => {
    const rows = Array.from({ length: 30 }, (_, i) => [`Row ${i}`, 'Complete']);

    await createBlok(page, false, {
      blocks: [
        { id: 'tbl', type: 'table', data: { withHeadings: true, content: [['Feature', 'Status'], ...rows] } },
        { id: 'after', type: 'paragraph', data: { text: 'After the table' } },
      ],
    });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const scrolled = await page.evaluate(() => window.scrollY);

    expect(scrolled).toBeGreaterThan(0);
    await page.evaluate(() => document.querySelector<HTMLElement>('[data-blok-table-fullscreen-toggle]')?.click());
    await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-blok-table-fullscreen]')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  });

  test('the size in the header follows rows and columns added in the modal', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    const size = page.locator('[data-blok-table-fullscreen-size]');

    await expect(size).toHaveText('2 × 2');

    const grid = page.getByRole('dialog').getByRole('table');
    const box = await grid.boundingBox();

    if (box === null) {
      throw new Error('table not laid out');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 10);
    await page.locator('[data-blok-table-add-row]').click();
    // Columns first, like the readout while dragging the add bars.
    await expect(size).toHaveText('2 × 3');

    await page.mouse.move(box.x + box.width - 10, box.y + box.height / 2);
    await page.locator('[data-blok-table-add-col]').click();
    await expect(size).toHaveText('3 × 3');
  });

  test('column resize handles sit on the column borders in the modal and back on the page', async ({ page }) => {
    await createBlok(page, false, {
      blocks: [{ id: 'tbl', type: 'table', data: { withHeadings: true, content: [['A', 'B', 'C'], ['1', '2', '3']] } }],
    });

    // How far each handle's middle is from the border it resizes.
    const handleDrift = async (): Promise<number[]> => page.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>('[data-blok-table-cell-row="0"]')];
      const handles = [...document.querySelectorAll<HTMLElement>('[data-blok-table-resize]')];

      return handles.slice(0, cells.length - 1).map((handle, i) => {
        const box = handle.getBoundingClientRect();

        return Math.round(Math.abs(box.left + box.width / 2 - cells[i].getBoundingClientRect().right));
      });
    });

    expect(Math.max(...await handleDrift())).toBeLessThanOrEqual(2);

    await openWithButton(page);
    await expect.poll(async () => Math.max(...await handleDrift())).toBeLessThanOrEqual(2);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-blok-table-fullscreen]')).toHaveCount(0);
    await expect.poll(async () => Math.max(...await handleDrift())).toBeLessThanOrEqual(2);
  });

  test('clicking the size opens a card where you type columns and rows', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    const size = page.getByRole('button', { name: 'Change table size' });

    await size.click();
    await expect(size).toHaveAttribute('aria-expanded', 'true');
    const card = page.getByRole('group', { name: 'Change table size' });
    const columns = card.getByRole('spinbutton', { name: 'Columns' });
    const rows = card.getByRole('spinbutton', { name: 'Rows' });

    await expect(columns).toHaveValue('2');
    await expect(rows).toHaveValue('2');
    await expect(columns).toBeFocused();
    // The size text stays where it was while the card is open.
    await expect(size).toBeVisible();

    await columns.fill('4');
    await rows.fill('5');
    await card.getByRole('button', { name: 'Done' }).click();

    await expect(card).toBeHidden();
    await expect(size).toHaveText('4 × 5');
    await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
    const content = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks[0]?.data.content as unknown[][]);

    expect(content).toHaveLength(5);
    expect(content.every(row => row.length === 4)).toBe(true);
  });

  test('the steppers add and remove, and stop at the filled cells', async ({ page }) => {
    await createBlok(page, false, {
      blocks: [{ id: 'tbl', type: 'table', data: { withHeadings: false, content: [['A', 'B', ''], ['C', 'D', ''], ['', '', '']] } }],
    });
    await openWithButton(page);

    await page.getByRole('button', { name: 'Change table size' }).click();
    const card = page.getByRole('group', { name: 'Change table size' });
    const rows = card.getByRole('spinbutton', { name: 'Rows' });
    const columns = card.getByRole('spinbutton', { name: 'Columns' });
    const steppers = card.locator('[data-blok-table-fullscreen-step]');
    const fewerRows = steppers.nth(2);
    const moreRows = steppers.nth(3);

    await moreRows.click();
    await moreRows.click();
    await expect(rows).toHaveValue('5');
    await expect(card.getByText('Rows and columns with content stay')).toBeHidden();

    await fewerRows.click();
    await fewerRows.click();
    await fewerRows.click();
    // Two rows hold content: minus stops there and says why.
    await expect(rows).toHaveValue('2');
    await expect(fewerRows).toBeDisabled();
    await expect(card.getByText('Rows and columns with content stay')).toBeVisible();

    // Typed below the floor, the field rises to it on leaving.
    await columns.fill('1');
    await rows.focus();
    await expect(columns).toHaveValue('2');

    await rows.press('Enter');
    await expect(page.getByRole('button', { name: 'Change table size' })).toHaveText('2 × 2');
    const saved = JSON.stringify(await page.evaluate(async () => window.blokInstance?.save()));

    for (const text of ['A', 'B', 'C', 'D']) {
      expect(saved).toContain(`"${text}"`);
    }
  });

  test('holding plus keeps adding', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.getByRole('button', { name: 'Change table size' }).click();
    const card = page.getByRole('group', { name: 'Change table size' });
    const plus = await card.locator('[data-blok-table-fullscreen-step]').nth(3).boundingBox();

    expect(plus).not.toBeNull();
    await page.mouse.move((plus?.x ?? 0) + 4, (plus?.y ?? 0) + 4);
    await page.mouse.down();
    await expect.poll(async () => Number(await card.getByRole('spinbutton', { name: 'Rows' }).inputValue())).toBeGreaterThan(5);
    await page.mouse.up();
  });

  test('the size fields take digits only and step with the arrow keys', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.getByRole('button', { name: 'Change table size' }).click();
    const card = page.getByRole('group', { name: 'Change table size' });
    const columns = card.getByRole('spinbutton', { name: 'Columns' });

    await columns.pressSequentially('3x');
    await expect(columns).toHaveValue('3');
    await columns.press('ArrowUp');
    await expect(columns).toHaveValue('4');
    await columns.press('Shift+ArrowUp');
    await expect(columns).toHaveValue('14');
    await expect(columns).toHaveAttribute('aria-valuenow', '14');
  });

  test('Escape cancels a size edit and keeps the modal open', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.getByRole('button', { name: 'Change table size' }).click();
    await page.getByRole('spinbutton', { name: 'Rows' }).fill('9');
    await page.keyboard.press('Escape');

    await expect(page.getByRole('group', { name: 'Change table size' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Change table size' })).toHaveText('2 × 2');
    await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
    await expect(page.locator(CELL_SELECTOR)).toHaveCount(4);
  });

  test('clicking the size again closes the card and applies it', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);
    const size = page.getByRole('button', { name: 'Change table size' });

    await size.click();
    await page.getByRole('spinbutton', { name: 'Rows' }).fill('3');
    await size.click();

    await expect(page.getByRole('group', { name: 'Change table size' })).toBeHidden();
    await expect(size).toHaveText('2 × 3');
  });

  test('a size change is one undo step', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.getByRole('button', { name: 'Change table size' }).click();
    await page.getByRole('spinbutton', { name: 'Columns' }).fill('4');
    await page.getByRole('spinbutton', { name: 'Rows' }).fill('4');
    await page.keyboard.press('Enter');
    await expect(page.locator(CELL_SELECTOR)).toHaveCount(16);

    await page.keyboard.press('ControlOrMeta+z');

    await expect(page.locator(CELL_SELECTOR)).toHaveCount(4);
  });

  test('the button sits in the top corner of a table narrower than the page, centred on the first row', async ({ page }) => {
    await createBlok(page, false, narrowData);
    await page.getByRole('table').hover();
    const grid = await page.getByRole('table').boundingBox();
    const row = await page.locator('[data-blok-table-row]').first().boundingBox();
    const button = await page.getByRole('button', { name: OPEN_LABEL }).boundingBox();

    expect(grid).not.toBeNull();
    expect(row).not.toBeNull();
    expect(button).not.toBeNull();
    if (grid === null || row === null || button === null) {
      return;
    }
    expect(Math.abs(grid.x + grid.width - (button.x + button.width) - CORNER_INSET)).toBeLessThanOrEqual(1);
    expect(Math.abs(button.y + button.height / 2 - (row.y + row.height / 2))).toBeLessThanOrEqual(0.5);
  });

  test('the button of a table wider than the page sits at the visible end', async ({ page }) => {
    await createBlok(page, false, wideData);
    await page.getByRole('table').hover();
    const scroller = await page.locator('[data-blok-table-scroll]').boundingBox();
    const button = await page.getByRole('button', { name: OPEN_LABEL }).boundingBox();

    expect(scroller).not.toBeNull();
    expect(button).not.toBeNull();
    if (scroller === null || button === null) {
      return;
    }
    expect(button.x + button.width).toBeLessThanOrEqual(scroller.x + scroller.width);
    expect(button.x).toBeGreaterThan(scroller.x + scroller.width / 2);
  });

  test('the button shows only while the pointer is near it', async ({ page }) => {
    await createBlok(page, false, narrowData);
    const button = page.getByRole('button', { name: OPEN_LABEL });
    const cell = await page.locator(CELL_SELECTOR).first().boundingBox();

    expect(cell).not.toBeNull();
    if (cell === null) {
      return;
    }

    await page.mouse.move(cell.x + 10, cell.y + cell.height / 2);
    await expect.poll(() => settledOpacity(button)).toBe('0');
    const box = await button.boundingBox();

    expect(box).not.toBeNull();
    if (box === null) {
      return;
    }

    await page.mouse.move(box.x - 20, box.y + box.height + 10);
    await expect.poll(() => settledOpacity(button)).toBe('1');

    await page.mouse.move(cell.x + 10, cell.y + cell.height / 2);
    await expect.poll(() => settledOpacity(button)).toBe('0');
  });
});
