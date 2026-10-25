/**
 * Layout checks read from the browser, not from the CSS source:
 * - the side peek keeps the page beside it, moves it into the free space, and pans the rest with a bar beside the peek;
 * - drag ghosts look like their source, at opacity 0.4 with no rotation
 *   (research/08 "Card drag start", "Row drag");
 * - a drop in a sorted table asks "Would you like to remove sorting?" (D7);
 * - the selection bar takes the place of the view toolbar row (research/08).
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
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a2',
    config: { options: [
      { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' },
      { id: 'o-build', label: 'Build', color: 'blue', position: 'a1' },
    ] },
  },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Charlie', 'p-stage': 'o-idea' } },
  { id: 'r2', properties: { 'p-title': 'Alpha', 'p-stage': 'o-idea' } },
  { id: 'r3', properties: { 'p-title': 'Bravo', 'p-stage': 'o-build' } },
];

const blocks = (view: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [
        { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view },
        { id: 'v2', name: 'Board', type: 'board', position: 'a1', sorts: [], filters: [], visibleProperties: [], groupBy: 'p-stage' },
        { id: 'v3', name: 'List', type: 'list', position: 'a2', sorts: [], filters: [], visibleProperties: [] },
      ],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  // Valid fractional keys: 'a000' makes positionBetween throw and the drop fails silently.
  ...ROWS.map((row, i) => ({ id: row.id, type: 'database-row', data: { position: `a${i}`, properties: row.properties } })),
];

const imageBoard = (cardSize: 'small' | 'large'): OutputBlockData[] => blocks().map((block) => {
  if (block.type === 'database') {
    return {
      ...block,
      data: {
        ...block.data,
        schema: [...SCHEMA, { id: 'p-image', name: 'Image', type: 'url', position: 'a3' }],
        views: [{
          id: 'v2', name: 'Board', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [],
          groupBy: 'p-stage', cardSize, cardPreview: 'property:p-image', fitImage: true, colorColumns: true,
        }],
        activeViewId: 'v2',
      },
    };
  }
  if (block.id === 'r1') {
    return {
      ...block,
      data: {
        ...block.data,
        properties: {
          'p-title': 'Charlie',
          'p-stage': 'o-idea',
          'p-image': 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        },
      },
    };
  }

  return block;
});

const mount = async (page: Page, data: OutputBlockData[], activeViewId = 'v1'): Promise<void> => {
  await page.evaluate(async ({ data: input, viewId }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    const withView = input.map((block) => (block.type === 'database' ? { ...block, data: { ...block.data, activeViewId: viewId } } : block));

    window.blokInstance = new window.Blok({ holder, data: { blocks: withView } });
    await window.blokInstance.isReady;
  }, { data, viewId: activeViewId });
  await expect(page.locator('[data-blok-database-wrapper]')).toBeVisible();
};

const tableRow = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);

const titles = async (page: Page): Promise<string[]> => page.locator('[data-blok-database-table-row] [role="gridcell"][data-property-id="p-title"]').allInnerTexts();

const savedSorts = async (page: Page): Promise<unknown> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const db = output?.blocks.find((block) => block.id === 'db-1');

  return (db?.data as { views: Array<{ sorts: unknown }> }).views[0].sorts;
});

interface Box {
  fontFamily: string;
  backgroundColor: string;
  borderRadius: string;
  opacity: string;
  transform: string;
  height: number;
  width: number;
  paddingInlineStart: string;
}

/** Computed box of `selector`'s first match, and of the first descendant matching `inner` when given. */
const boxOf = async (page: Page, selector: string, inner?: string): Promise<Box | null> => page.evaluate(({ sel, sub }) => {
  const outer = document.querySelector<HTMLElement>(sel);
  const el = sub === undefined ? outer : outer?.querySelector<HTMLElement>(sub) ?? null;

  if (el === null || el === undefined) return null;
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  return {
    fontFamily: style.fontFamily,
    backgroundColor: style.backgroundColor,
    borderRadius: style.borderTopLeftRadius,
    opacity: style.opacity,
    transform: style.transform,
    height: Math.round(rect.height),
    width: Math.round(rect.width),
    paddingInlineStart: style.paddingInlineStart,
  };
}, { sel: selector, sub: inner });

/** Presses on `from`, moves `dx`/`dy` in steps and keeps the button down. */
const dragBy = async (page: Page, from: Locator, dx: number, dy: number): Promise<void> => {
  const box = await from.boundingBox();

  if (box === null) throw new Error('nothing to drag');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('side peek', () => {
  test('keeps the page beside it, moves it into the free space and pans the rest with a bar beside the peek', async ({ page }) => {
    await mount(page, blocks());
    const database = page.locator('[data-blok-database-wrapper]');
    const wrapper = page.locator('[data-blok-interface=blok]').first();
    const bar = page.locator('[data-blok-database-peek-scrollbar]');
    const drawer = page.locator('[data-blok-database-drawer]');
    const before = await database.boundingBox();
    // The 756px peek's inner edge at a 1400px window (research/22 §10).
    const edge = 1400 - 756;

    expect(before?.x).toBeLessThan(edge);
    expect((before?.x ?? 0) + (before?.width ?? 0)).toBeGreaterThan(edge);

    await tableRow(page, 'r1').hover();
    await tableRow(page, 'r1').locator('[data-blok-database-table-open]').click();
    await expect(drawer).toHaveAttribute('data-peek-mode', 'side');
    await expect(bar).toBeVisible();

    // The page moves left but keeps its width, and the window itself never scrolls sideways.
    await expect.poll(async () => Math.round((await database.boundingBox())?.x ?? 0)).toBeLessThan(Math.round(before?.x ?? 0));
    expect(Math.round((await database.boundingBox())?.width ?? 0)).toBe(Math.round(before?.width ?? 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1400);
    expect(Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(756);

    // The bar runs only under the uncovered part.
    const barBox = await bar.boundingBox();

    expect(Math.round(barBox?.x ?? -1)).toBe(0);
    expect(Math.round((barBox?.x ?? 0) + (barBox?.width ?? 0))).toBeLessThanOrEqual(edge + 1);

    // A sideways wheel over the page pans it.
    const resting = (await wrapper.boundingBox())?.x ?? 0;

    await page.mouse.move(100, 450);
    await page.mouse.wheel(120, 0);
    await expect.poll(async () => (await wrapper.boundingBox())?.x ?? 0).toBeLessThan(resting);

    // With the bar at its end, the page's end meets the peek's inner edge.
    await bar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect.poll(async () => {
      const box = await wrapper.boundingBox();

      return Math.round((box?.x ?? 0) + (box?.width ?? 0));
    }).toBe(edge);

    await page.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);
    await expect.poll(async () => Math.round((await database.boundingBox())?.x ?? 0)).toBe(Math.round(before?.x ?? 0));
  });
});

test.describe('side peek properties (research/08)', () => {
  test('rows are 34px with a 4px gap, labels 14/20 in rgb(114, 111, 106)', async ({ page }) => {
    await mount(page, blocks());
    await tableRow(page, 'r1').hover();
    await tableRow(page, 'r1').locator('[data-blok-database-table-open]').click();
    const rows = page.locator('[data-blok-database-drawer] [data-blok-database-drawer-prop-row]');

    await expect(rows.first()).toBeVisible();
    const look = await rows.evaluateAll((els) => els.slice(0, 2).map((el) => {
      const label = el.querySelector<HTMLElement>('[data-blok-database-drawer-prop-label]');
      const style = label === null ? null : getComputedStyle(label);

      return { top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height, color: style?.color, size: style?.fontSize, line: style?.lineHeight };
    }));

    expect(look[0].height).toBe(34);
    expect(look[1].top - look[0].top).toBe(38);
    expect(look[0].color).toBe('rgb(114, 111, 106)');
    expect(look[0].size).toBe('14px');
    expect(look[0].line).toBe('20px');
  });
});

test.describe('drag ghosts look like their source', () => {
  for (const size of ['small', 'large'] as const) {
    test(`a ${size} card ghost keeps the image preview box`, async ({ page }) => {
      await mount(page, imageBoard(size), 'v2');
      const card = page.locator('[data-blok-database-card][data-row-id="r1"]');
      const preview = card.locator('[data-blok-database-card-preview]');

      await expect(preview).toBeVisible();
      const source = await preview.boundingBox();

      if (source === null) throw new Error('no preview box');
      await dragBy(page, card, 300, 0);
      const ghost = page.locator('[data-blok-database-ghost]');
      const clone = ghost.locator('[data-blok-database-card-preview]');

      await expect(ghost).toBeVisible();
      const drawing = await clone.boundingBox();

      expect(drawing?.height).toBeCloseTo(source.height, 1);
      expect(drawing?.width).toBeCloseTo(source.width, 1);
      await expect(ghost).toHaveCSS('opacity', '0.4');
      await expect(ghost).toHaveCSS('transform', 'none');
      expect(await ghost.evaluate((el) => el.closest('[data-blok-interface="blok"]') !== null)).toBe(true);
      await page.mouse.up();
    });
  }

  test('a fitted card image stays fitted in the drag ghost', async ({ page }) => {
    await mount(page, imageBoard('small'), 'v2');
    const card = page.locator('[data-blok-database-card][data-row-id="r1"]');
    const image = card.locator('[data-blok-database-card-image]');
    const source = await image.evaluate((el) => getComputedStyle(el).objectFit);

    await dragBy(page, card, 300, 0);
    const clone = page.locator('[data-blok-database-ghost] [data-blok-database-card-image]');

    await expect(clone).toHaveCSS('object-fit', source);
    expect(source).toBe('contain');
    await page.mouse.up();
  });

  test('a colored card keeps its group ring in the drag ghost', async ({ page }) => {
    await mount(page, imageBoard('large'), 'v2');
    const card = page.locator('[data-blok-database-card][data-row-id="r1"]');
    const source = await card.evaluate((el) => getComputedStyle(el).boxShadow);

    await dragBy(page, card, 300, 0);
    const clone = page.locator('[data-blok-database-ghost] [data-blok-database-card]');

    await expect(clone).toHaveCSS('box-shadow', source);
    await page.mouse.up();
  });

  for (const showVerticalLines of [true, false]) {
    test(`a table row ghost preserves vertical lines set to ${showVerticalLines}`, async ({ page }) => {
      await mount(page, blocks({ showVerticalLines }));
      const row = tableRow(page, 'r1');
      const sourceCell = row.locator('[role="gridcell"][data-property-id="p-title"]');
      const source = await sourceCell.evaluate((el) => {
        const style = getComputedStyle(el);

        return { width: style.borderInlineEndWidth, style: style.borderInlineEndStyle, color: style.borderInlineEndColor };
      });

      await row.hover();
      await dragBy(page, row.locator('[data-blok-database-table-row-handle]'), 0, 60);
      const clone = page.locator('[data-blok-database-table-row-ghost] [role="gridcell"][data-property-id="p-title"]');

      await expect(clone).toHaveCSS('border-inline-end-width', source.width);
      await expect(clone).toHaveCSS('border-inline-end-style', source.style);
      await expect(clone).toHaveCSS('border-inline-end-color', source.color);
      expect(source.width).toBe(showVerticalLines ? '1px' : '0px');
      await page.mouse.up();
    });
  }

  for (const size of ['small', 'large'] as const) {
    test(`a ${size} board column ghost keeps the card preview box and image fit`, async ({ page }) => {
      await mount(page, imageBoard(size), 'v2');
      const column = '[data-blok-database-column][data-option-id="o-idea"]';
      const preview = page.locator(`${column} [data-blok-database-card][data-row-id="r1"] [data-blok-database-card-preview]`);

      await expect(preview).toBeVisible();
      const source = await preview.boundingBox();
      const sourceFit = await preview.locator('[data-blok-database-card-image]').evaluate((el) => getComputedStyle(el).objectFit);

      if (source === null) throw new Error('no preview box');
      await dragBy(page, page.locator(`${column} [data-blok-database-column-header]`), 200, 0);
      const ghost = page.locator('[data-blok-database-column-ghost]');
      const clone = ghost.locator('[data-blok-database-card][data-row-id="r1"] [data-blok-database-card-preview]');

      await expect(ghost).toBeVisible();
      expect((await clone.boundingBox())?.height).toBeCloseTo(source.height, 1);
      await expect(clone.locator('[data-blok-database-card-image]')).toHaveCSS('object-fit', sourceFit);
      expect(sourceFit).toBe('contain');
      await page.mouse.up();
    });
  }

  for (const showVerticalLines of [true, false]) {
    test(`a table column ghost preserves vertical lines set to ${showVerticalLines}`, async ({ page }) => {
      await mount(page, blocks({ showVerticalLines }));
      const header = page.getByRole('columnheader', { name: 'Notes' });
      // The header has no divider (Notion); a body cell carries the column's line.
      const notesCell = page.getByRole('gridcell').and(page.locator('[data-property-id="p-notes"]')).first();
      const source = await notesCell.evaluate((el) => {
        const style = getComputedStyle(el);

        return { width: style.borderInlineEndWidth, style: style.borderInlineEndStyle, color: style.borderInlineEndColor };
      });

      await dragBy(page, header, 120, 0);
      const ghost = page.locator('[data-blok-database-table-column-ghost]');

      await expect(ghost).toHaveCSS('border-inline-end-width', source.width);
      await expect(ghost).toHaveCSS('border-inline-end-style', source.style);
      await expect(ghost).toHaveCSS('border-inline-end-color', source.color);
      expect(source.width).toBe(showVerticalLines ? '1px' : '0px');
      await page.mouse.up();
    });
  }

  test('a board card ghost keeps the card box', async ({ page }) => {
    await mount(page, blocks(), 'v2');
    const card = page.locator('[data-blok-database-card][data-row-id="r1"]');
    const source = await boxOf(page, '[data-blok-database-card][data-row-id="r1"]');

    await dragBy(page, card, 300, 0);
    const ghost = await boxOf(page, '[data-blok-database-ghost]');
    const clone = await boxOf(page, '[data-blok-database-ghost]', '[data-blok-database-card]');

    expect(ghost?.opacity).toBe('0.4');
    expect(ghost?.transform).toBe('none');
    expect(ghost?.borderRadius).toBe(source?.borderRadius);
    expect(clone?.fontFamily).toBe(source?.fontFamily);
    expect(clone?.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(clone?.height).toBe(source?.height);
    await page.mouse.up();
  });

  test('a board column ghost keeps the column box', async ({ page }) => {
    await mount(page, blocks(), 'v2');
    const header = page.locator('[data-blok-database-column][data-option-id="o-idea"] [data-blok-database-column-header]');
    const source = await boxOf(page, '[data-blok-database-column][data-option-id="o-idea"]');

    await dragBy(page, header, 200, 0);
    const ghost = await boxOf(page, '[data-blok-database-column-ghost]');
    const clone = await boxOf(page, '[data-blok-database-column-ghost]', '[data-blok-database-column]');

    expect(ghost?.opacity).toBe('0.4');
    expect(ghost?.transform).toBe('none');
    expect(clone?.fontFamily).toBe(source?.fontFamily);
    expect(clone?.backgroundColor).toBe(source?.backgroundColor);
    expect(clone?.width).toBe(source?.width);
    await page.mouse.up();
  });

  test('a list row ghost keeps the row font and height', async ({ page }) => {
    await mount(page, blocks(), 'v3');
    const row = page.locator('[data-blok-database-list-row][data-row-id="r1"]');
    const source = await boxOf(page, '[data-blok-database-list-row][data-row-id="r1"]');

    await dragBy(page, row, 0, 50);
    const ghost = await boxOf(page, '[data-blok-database-ghost]');
    const clone = await boxOf(page, '[data-blok-database-ghost]', '[data-blok-database-list-row]');

    expect(ghost?.opacity).toBe('0.4');
    expect(ghost?.transform).toBe('none');
    expect(clone?.fontFamily).toBe(source?.fontFamily);
    expect(clone?.height).toBe(source?.height);
    await page.mouse.up();
  });

  test('a table row ghost keeps the row font and cell padding', async ({ page }) => {
    await mount(page, blocks());
    const handle = tableRow(page, 'r1').locator('[data-blok-database-table-row-handle]');
    const source = await boxOf(page, '[data-blok-database-table-row][data-row-id="r1"] [role="gridcell"][data-property-id="p-title"]');

    await tableRow(page, 'r1').hover();
    await dragBy(page, handle, 0, 60);
    const ghost = await boxOf(page, '[data-blok-database-table-row-ghost]');
    const ghostCell = await boxOf(page, '[data-blok-database-table-row-ghost]', '[role="gridcell"][data-property-id="p-title"]');

    expect(ghost?.opacity).toBe('0.4');
    expect(ghost?.transform).toBe('none');
    expect(ghost?.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(ghostCell?.fontFamily).toBe(source?.fontFamily);
    expect(ghostCell?.paddingInlineStart).toBe(source?.paddingInlineStart);
    expect(ghostCell?.width).toBe(source?.width);
    await page.mouse.up();
  });

  test('a table column ghost keeps the header font', async ({ page }) => {
    await mount(page, blocks());
    const header = page.getByRole('columnheader', { name: 'Notes' });
    const source = await boxOf(page, '[role="columnheader"][data-property-id="p-notes"]');

    await dragBy(page, header, 120, 0);
    const ghost = await boxOf(page, '[data-blok-database-table-column-ghost]');

    expect(ghost?.opacity).toBe('0.4');
    expect(ghost?.fontFamily).toBe(source?.fontFamily);
    expect(ghost?.height).toBe(source?.height);
    await page.mouse.up();
  });
});

test.describe('D7 in a sorted table', () => {
  test('asks to remove sorting; Remove keeps the sorted order and lands the row', async ({ page }) => {
    await mount(page, blocks({ sorts: [{ id: 's1', propertyId: 'p-title', direction: 'asc' }] }));
    await expect.poll(() => titles(page)).toEqual(['Alpha', 'Bravo', 'Charlie']);

    const handle = tableRow(page, 'r1').locator('[data-blok-database-table-row-handle]');
    const top = await tableRow(page, 'r2').boundingBox();

    await tableRow(page, 'r1').hover();
    const from = await handle.boundingBox();

    if (from === null || top === null) throw new Error('no row');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, top.y + 4, { steps: 10 });
    await page.mouse.up();

    const dialog = page.getByRole('alertdialog', { name: 'Would you like to remove sorting?' });

    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();

    await expect.poll(() => savedSorts(page)).toEqual([]);
    await expect.poll(() => titles(page)).toEqual(['Charlie', 'Alpha', 'Bravo']);
  });
});

test.describe('selection bar', () => {
  test('takes the place of the view toolbar row, and "1 selected" stays on one line', async ({ page }) => {
    await mount(page, blocks());
    await tableRow(page, 'r1').hover();
    await tableRow(page, 'r1').locator('[data-blok-database-table-row-checkbox]').click();

    const bar = page.locator('[data-blok-database-table-selection-bar]');

    await expect(bar).toBeVisible();
    const barBox = await bar.boundingBox();
    const viewBar = await page.locator('[data-blok-database-view-bar]').boundingBox();
    const header = await page.locator('[data-blok-database-table-header]').boundingBox();
    const count = await boxOf(page, '[data-blok-database-table-selection-count]');

    if (barBox === null || viewBar === null || header === null) throw new Error('no layout');
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(header.y);
    expect(barBox.y).toBeGreaterThanOrEqual(viewBar.y);
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(viewBar.y + viewBar.height);
    expect(count?.height).toBe(21);
    await expect(page.locator('[data-blok-database-tab-bar]')).toBeHidden();

    await tableRow(page, 'r1').locator('[data-blok-database-table-row-checkbox]').click();
    await expect(bar).toHaveCount(0);
    await expect(page.locator('[data-blok-database-tab-bar]')).toBeVisible();
  });
});

test.describe('fill handle', () => {
  test('its ring is the gray of the selected cell ring, not blue (D3)', async ({ page }) => {
    await mount(page, blocks());
    await tableRow(page, 'r1').getByRole('gridcell').and(page.locator('[data-property-id="p-notes"]')).click();
    await page.keyboard.press('Escape');
    const handle = page.locator('[data-blok-database-table-fill-handle]');

    await expect(handle).toBeVisible();
    const ring = await handle.evaluate((el) => getComputedStyle(el).borderTopColor);
    const cellRing = await page.locator('[data-blok-database-table-cell-anchor]').evaluate((el) => getComputedStyle(el).boxShadow);

    expect(cellRing.startsWith(ring)).toBe(true);
  });
});
