/**
 * Layout checks read from the browser, not from the CSS source:
 * - the page beside the side peek narrows to the part the peek leaves uncovered;
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
  backgroundImage: string;
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
    backgroundImage: style.backgroundImage,
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
  test('narrows the page beside it, keeping the toolbar in view 24px clear of the peek', async ({ page }) => {
    await mount(page, blocks());
    const database = page.locator('[data-blok-database-wrapper]');
    const wrapper = page.locator('[data-blok-interface=blok]').first();
    const newButton = database.locator('[data-blok-database-new]');
    const drawer = page.locator('[data-blok-database-drawer]');
    const before = await wrapper.boundingBox();
    // The 756px peek's inner edge at a 1400px window (research/22 §10).
    const edge = 1400 - 756;

    expect((before?.x ?? 0) + (before?.width ?? 0)).toBeGreaterThan(edge);

    await tableRow(page, 'r1').hover();
    await tableRow(page, 'r1').locator('[data-blok-database-table-open]').click();
    await expect(drawer).toHaveAttribute('data-peek-mode', 'side');
    expect(Math.round((await drawer.boundingBox())?.width ?? 0)).toBe(756);

    // The database ends at the peek, and New ends 24px before it, as in Notion (731 against 756).
    await expect.poll(async () => {
      const box = await database.boundingBox();

      return Math.round((box?.x ?? 0) + (box?.width ?? 0));
    }).toBe(edge);
    await expect.poll(async () => {
      const box = await newButton.boundingBox();

      return Math.round((box?.x ?? 0) + (box?.width ?? 0));
    }).toBe(edge - 24);
    // Nothing moves sideways: the page keeps its place and the window never scrolls.
    expect(Math.round((await wrapper.boundingBox())?.x ?? 0)).toBe(Math.round(before?.x ?? 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1400);

    await page.keyboard.press('Escape');
    await expect.poll(async () => {
      const box = await database.boundingBox();

      return Math.round((box?.x ?? 0) + (box?.width ?? 0));
    }).toBe(Math.round((before?.x ?? 0) + (before?.width ?? 0)));
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

  // notion-live/carddrag-mid.png: the ghost is the card's own 40px, in the drag fill (no white), with ✎⋯ riding along.
  test('a card ghost is the card at its own height, in the drag fill, with its buttons', async ({ page }) => {
    await mount(page, blocks(), 'v2');
    const card = page.locator('[data-blok-database-card][data-row-id="r3"]');
    const source = await card.boundingBox();

    if (source === null) throw new Error('no card box');
    await dragBy(page, card, -300, 0);
    const ghost = page.locator('[data-blok-database-ghost]');

    await expect(ghost).toBeVisible();
    expect((await ghost.boundingBox())?.height).toBeCloseTo(source.height, 1);
    await expect(ghost.locator('[data-blok-database-card]')).toHaveCSS('background-color', 'rgba(55, 53, 47, 0.06)');
    await expect(ghost.locator('[data-blok-database-card-actions]')).toHaveCSS('opacity', '1');
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

  // notion-motion.md "Board column (group) drag": only the header strip moves, opaque, on the column tint.
  test('a board column ghost is the header strip, and the passed header slides into the freed slot', async ({ page }) => {
    await mount(page, blocks(), 'v2');
    const column = '[data-blok-database-column][data-option-id="o-idea"]';
    const header = page.locator(`${column} [data-blok-database-column-header]`);
    const source = await boxOf(page, column);
    const sourceHeader = await boxOf(page, `${column} [data-blok-database-column-header]`);

    await dragBy(page, header, 300, 0);
    const ghost = await boxOf(page, '[data-blok-database-column-ghost]');
    const clone = await boxOf(page, '[data-blok-database-column-ghost]', '[data-blok-database-column-header]');

    expect(ghost?.opacity).toBe('1');
    expect(ghost?.transform).toBe('none');
    expect(ghost?.width).toBe(source?.width);
    expect(ghost?.height).toBe(sourceHeader?.height);
    expect(ghost?.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(clone?.fontFamily).toBe(sourceHeader?.fontFamily);
    await expect(page.locator('[data-blok-database-column-ghost] [data-blok-database-card]')).toHaveCount(0);
    expect(await page.locator('[data-blok-database-drop-line]').evaluateAll((els) => els.filter((el) => getComputedStyle(el).opacity !== '0').length)).toBe(0);
    await expect(header).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('[data-blok-database-column-header][data-blok-database-column-sliding]').first()).toHaveCSS('transform', /matrix\(1, 0, 0, 1, -\d+/);
    await page.mouse.up();
    await expect(page.locator('[data-blok-database-column-header][data-blok-database-column-sliding]')).toHaveCount(0);
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

    // Notion's row ghost has no fill (notion-motion.md "Table row drag").
    expect(ghost?.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(ghost?.opacity).toBe('0.4');
    expect(ghost?.transform).toBe('none');
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

    // Notion's column ghost is the header's see-through pressed fill: the next header shows through (coldrag-mid.png).
    expect(ghost?.opacity).toBe('1');
    expect(ghost?.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(ghost?.backgroundImage).toMatch(/^linear-gradient\(/);
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
  // With tabs the bar sat at the view bar's edge, 316px left of the table (sweep9a motion-rowdrag.json).
  test('starts at the table content with tabs, as it does with one view', async ({ page }) => {
    await mount(page, blocks());
    // A wide holder gives the content a centring offset, so a bar at the view bar's edge shows.
    await page.evaluate(() => document.getElementById('blok')?.style.setProperty('max-width', 'none'));
    await tableRow(page, 'r1').hover();
    await tableRow(page, 'r1').locator('[data-blok-database-table-row-checkbox]').click();

    const bar = await page.locator('[data-blok-database-table-selection-bar]').boundingBox();
    const firstHeader = await page.getByRole('columnheader', { name: 'Name' }).boundingBox();

    if (bar === null || firstHeader === null) throw new Error('no layout');
    expect(firstHeader.x).toBeGreaterThan(100);
    expect(Math.abs(bar.x - firstHeader.x)).toBeLessThanOrEqual(1);
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

// Notion shows no text selection during a drag (rowdrag-mid). A caret left in a
// paragraph below must not become the anchor of a text drag into the database.
test.describe('a drag with the caret in a paragraph below', () => {
  const withParagraph = (): OutputBlockData[] => [...blocks(), { id: 'p-after', type: 'paragraph', data: { text: 'After the database' } }];

  const cases: Array<{ name: string; viewId: string; handle: (page: Page) => Locator; hover?: (page: Page) => Locator; ghost: string; dx: number; dy: number }> = [
    { name: 'table row', viewId: 'v1', handle: (page) => tableRow(page, 'r1').locator('[data-blok-database-table-row-handle]'), hover: (page) => tableRow(page, 'r1'), ghost: '[data-blok-database-table-row-ghost]', dx: 0, dy: 60 },
    { name: 'table column', viewId: 'v1', handle: (page) => page.getByRole('columnheader', { name: 'Notes' }), ghost: '[data-blok-database-table-column-ghost]', dx: 200, dy: 0 },
    { name: 'board card', viewId: 'v2', handle: (page) => page.locator('[data-blok-database-card][data-row-id="r1"]'), ghost: '[data-blok-database-ghost]', dx: 300, dy: 0 },
    { name: 'list row', viewId: 'v3', handle: (page) => page.locator('[data-blok-database-list-row][data-row-id="r1"]'), ghost: '[data-blok-database-ghost]', dx: 0, dy: 50 },
  ];

  for (const item of cases) {
    test(`a ${item.name} drag selects no text`, async ({ page }) => {
      await mount(page, withParagraph(), item.viewId);
      await page.getByText('After the database').click();
      expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);

      await item.hover?.(page).hover();
      await dragBy(page, item.handle(page), item.dx, item.dy);
      await expect(page.locator(item.ghost)).toBeVisible();

      expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
      await page.mouse.up();
    });
  }
});

test.describe('a press on a row handle', () => {
  test('closes the open add-property menu, as a press anywhere outside it does', async ({ page }) => {
    await mount(page, blocks());
    await page.locator('[data-blok-database-table-add-property]').click();
    const menu = page.locator('[data-blok-database-property-type-popover]');

    await expect(menu).toBeVisible();

    // The menu covers the row's middle, so hover its left edge with the mouse.
    const row = await tableRow(page, 'r1').boundingBox();

    if (row === null) throw new Error('no row');
    await page.mouse.move(row.x + 20, row.y + row.height / 2);
    const handle = await tableRow(page, 'r1').locator('[data-blok-database-table-row-handle]').boundingBox();

    if (handle === null) throw new Error('no handle');
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();

    await expect(menu).toHaveCount(0);
    await page.mouse.up();
  });
});
