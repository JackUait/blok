/**
 * The Notion table view: cell keyboard model, editing each type, column
 * resize, reorder and freeze, calculations, load more, a grouped table and
 * read-only. Behaviour from research/08 "Cell keyboard model"; sizes from
 * research/07. Each case checks the saved JSON, not only the DOM.
 */

import type { Locator, Page } from '@playwright/test';

import { generateKeyBetween } from '../../../../src/shared/database/fractional-index';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

/** Valid fractional keys. `a000`-style keys are ones the library rejects. */
const rowKey = (i: number): string => Array.from({ length: i }).reduce<string>((key) => generateKeyBetween(key, null), 'a0');

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

interface ViewOverrides {
  [key: string]: unknown;
}

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a2' },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a3',
    config: { options: [
      { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' },
      { id: 'o-build', label: 'Build', color: 'blue', position: 'a1' },
    ] },
  },
  {
    id: 'p-tags',
    name: 'Tags',
    type: 'multiSelect',
    position: 'a4',
    config: { options: [{ id: 't-x', label: 'X', color: 'red', position: 'a0' }, { id: 't-y', label: 'Y', position: 'a1' }] },
  },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a5' },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a6' },
  { id: 'p-link', name: 'Link', type: 'url', position: 'a7' },
];

const ROWS: Array<{ id: string; properties: Record<string, unknown> }> = [
  { id: 'r1', properties: { 'p-title': 'Alpha', 'p-notes': 'short', 'p-amount': 1200, 'p-stage': 'o-idea' } },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-amount': 35.5, 'p-stage': 'o-build', 'p-done': true } },
  { id: 'r3', properties: { 'p-title': 'Charlie' } },
];

const blocks = (view: ViewOverrides = {}, rows = ROWS): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
      activeViewId: 'v1',
    },
    content: rows.map((row) => row.id),
  },
  ...rows.map((row, i) => ({
    id: row.id,
    type: 'database-row',
    data: { position: rowKey(i), properties: row.properties },
  })),
];

const mount = async (page: Page, data: OutputBlockData[], readOnly = false): Promise<void> => {
  await page.evaluate(async ({ data: input, readOnly: ro }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input }, readOnly: ro });
    await window.blokInstance.isReady;
  }, { data, readOnly });
  await expect(page.getByRole('grid').first()).toBeVisible();
};

const savedRow = async (page: Page, rowId: string): Promise<Record<string, unknown>> => page.evaluate(async (id) => {
  const output = await window.blokInstance?.save();
  const row = output?.blocks.find((block) => block.id === id);

  return (row?.data as { properties: Record<string, unknown> } | undefined)?.properties ?? {};
}, rowId);

const savedView = async (page: Page): Promise<Record<string, unknown>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const db = output?.blocks.find((block) => block.id === 'db-1');

  return (db?.data as { views: Array<Record<string, unknown>> }).views[0];
});

const row = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);
const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  row(page, rowId).locator(`[role="gridcell"][data-property-id="${propertyId}"]`);
const header = (page: Page, propertyId: string): Locator => page.locator(`[role="columnheader"][data-property-id="${propertyId}"]`);
const editor = (page: Page): Locator => page.locator('[data-blok-database-cell-editor]');
const anchor = (page: Page): Locator => page.locator('[data-blok-database-table-cell-anchor]');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('layout', () => {
  test('draws a 36px header and 37px rows, title first', async ({ page }) => {
    await mount(page, blocks());

    await expect(page.getByRole('columnheader')).toHaveCount(SCHEMA.length);
    await expect(page.getByRole('columnheader').first()).toHaveAttribute('data-property-id', 'p-title');
    expect((await page.locator('[data-blok-database-table-header]').boundingBox())?.height).toBe(36);
    expect((await row(page, 'r3').boundingBox())?.height).toBe(37);
    await expect(page.locator('[data-blok-database-table-grid]')).toHaveAttribute('data-blok-keyboard-owner', 'select-all');
  });
  // notion-motion.md Round 59 §8: Notion's row page glyph inks 14x18. The glyph grows to 23 inside the same 22 box, so the name stays put.
  test('draws the row page glyph at 23px in a 22px box, the name 3px after the box', async ({ page }) => {
    await mount(page, blocks());
    const glyph = cell(page, 'r3', 'p-title').locator('[data-blok-database-page-icon-placeholder]');
    const glyphBox = await glyph.boundingBox();
    const svgBox = await glyph.evaluate((el) => el.firstElementChild?.getBoundingClientRect().toJSON() as { width: number; height: number } | undefined);
    const textX = await cell(page, 'r3', 'p-title').getByText('Charlie').evaluate((el) => {
      const range = document.createRange();

      range.selectNodeContents(el);

      return range.getBoundingClientRect().x;
    });

    expect(glyphBox?.width).toBe(22);
    expect(svgBox?.width).toBe(23);
    expect(svgBox?.height).toBe(23);
    expect(textX).toBeCloseTo((glyphBox?.x ?? 0) + 22 + 3, 0);
  });
});

test.describe('cell keyboard model', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page, blocks());
  });

  test('click opens the editor; Escape selects the cell; Escape again selects the row', async ({ page }) => {
    await cell(page, 'r1', 'p-notes').click();
    await expect(editor(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);
    await expect(cell(page, 'r1', 'p-notes')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Escape');
    await expect(row(page, 'r1')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-blok-database-table-selection-bar]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(row(page, 'r1')).toHaveAttribute('aria-selected', 'false');
  });

  test('arrows, Tab and Shift+arrows move and extend the selection', async ({ page }) => {
    await cell(page, 'r1', 'p-amount').click();
    await page.keyboard.press('Escape');

    await page.keyboard.press('ArrowDown');
    await expect(anchor(page)).toHaveAttribute('data-property-id', 'p-amount');
    await expect(row(page, 'r2').locator('[data-blok-database-table-cell-anchor]')).toHaveCount(1);

    await page.keyboard.press('Tab');
    await expect(anchor(page)).toHaveAttribute('data-property-id', 'p-stage');

    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.locator('[role="gridcell"][aria-selected="true"]')).toHaveCount(2);
  });

  test('Enter edits, Enter commits and moves down; typing replaces; Backspace clears', async ({ page }) => {
    await cell(page, 'r1', 'p-notes').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('longer');
    await page.keyboard.press('Enter');

    await expect(row(page, 'r2').locator('[data-blok-database-table-cell-anchor]')).toHaveAttribute('data-property-id', 'p-notes');
    expect((await savedRow(page, 'r1'))['p-notes']).toBe('longer');

    await page.keyboard.press('Z');
    await page.keyboard.press('Enter');
    expect((await savedRow(page, 'r2'))['p-notes']).toBe('Z');

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Backspace');
    expect((await savedRow(page, 'r1'))['p-notes']).toBe('');
  });

  test('Mod+Enter on the selected title cell presses its hover-only Open button', async ({ page }) => {
    await cell(page, 'r2', 'p-title').click();
    await page.keyboard.press('Escape');
    await expect(editor(page)).toHaveCount(0);

    const title = cell(page, 'r2', 'p-title');

    await expect(title).toHaveAttribute('aria-keyshortcuts', 'Meta+Enter Control+Enter');
    await expect(title).toHaveAccessibleDescription('Open');

    await page.keyboard.press('ControlOrMeta+Enter');

    await expect(page.getByRole('complementary', { name: 'Card details' })).toBeVisible();
    await expect(editor(page)).toHaveCount(0);
  });

  test('clicking another cell while editing saves the first and opens the second', async ({ page }) => {
    await cell(page, 'r1', 'p-notes').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('first');
    await cell(page, 'r2', 'p-notes').click();

    await expect(editor(page).locator('[data-blok-database-cell-input]')).toBeFocused();
    await page.keyboard.type('second');
    await page.keyboard.press('Enter');

    expect((await savedRow(page, 'r1'))['p-notes']).toBe('first');
    expect((await savedRow(page, 'r2'))['p-notes']).toBe('second');
  });

  test('Enter in an editor on the last row stays on that row', async ({ page }) => {
    await cell(page, 'r3', 'p-notes').click();
    await page.keyboard.type('end');
    await page.keyboard.press('Enter');

    await expect(row(page, 'r3').locator('[data-blok-database-table-cell-anchor]')).toHaveAttribute('data-property-id', 'p-notes');
  });
});

test.describe('editing each type', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page, blocks());
  });

  test('title, number and url', async ({ page }) => {
    await cell(page, 'r3', 'p-title').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Charlie 2');
    await page.keyboard.press('Enter');

    await cell(page, 'r3', 'p-amount').click();
    await page.keyboard.type('42');
    await page.keyboard.press('Enter');

    await cell(page, 'r3', 'p-link').click();
    await page.keyboard.type('https://example.com');
    await page.keyboard.press('Enter');

    const saved = await savedRow(page, 'r3');

    expect(saved).toMatchObject({ 'p-title': 'Charlie 2', 'p-amount': 42, 'p-link': 'https://example.com' });
    await expect(cell(page, 'r3', 'p-title')).toContainText('Charlie 2');
  });

  test('select, multi-select and checkbox', async ({ page }) => {
    await cell(page, 'r3', 'p-stage').click();
    await editor(page).locator('[data-blok-database-select-option="o-build"]').click();
    await expect(cell(page, 'r3', 'p-stage')).toContainText('Build');

    await cell(page, 'r3', 'p-tags').click();
    await editor(page).locator('[data-blok-database-select-option="t-x"]').click();
    await editor(page).locator('[data-blok-database-select-option="t-y"]').click();
    await page.keyboard.press('Escape');

    await cell(page, 'r3', 'p-done').click();

    expect(await savedRow(page, 'r3')).toMatchObject({ 'p-stage': 'o-build', 'p-tags': ['t-x', 't-y'], 'p-done': true });
  });

  test('date', async ({ page }) => {
    await cell(page, 'r3', 'p-due').click();
    await editor(page).locator('[data-blok-database-date-input="start"]').fill('2026-10-12');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    expect(String((await savedRow(page, 'r3'))['p-due'])).toContain('2026-10-12');
  });

  test('+ New page adds a row and Escape on it while empty removes it', async ({ page }) => {
    await page.locator('[data-blok-database-table-add-row]').click();
    await expect(page.locator('[data-blok-database-table-row]')).toHaveCount(4);
    await expect(editor(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-blok-database-table-row]')).toHaveCount(3);
  });
});

test.describe('columns', () => {
  test('resize follows the pointer and saves the width', async ({ page }) => {
    await mount(page, blocks());
    const handle = header(page, 'p-notes').locator('[data-blok-database-table-resize]');
    const box = await handle.boundingBox();

    if (box === null) {
      throw new Error('no resize handle');
    }
    await page.mouse.move(box.x + 2, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 82, box.y + 10, { steps: 4 });
    await expect.poll(async () => (await header(page, 'p-notes').boundingBox())?.width).toBe(280);
    await page.mouse.up();

    const view = await savedView(page);
    const notes = (view.properties as Array<{ id: string; width?: number }>).find((p) => p.id === 'p-notes');

    expect(notes?.width).toBe(280);
  });

  test('double-click auto-fit shrinks a widened column to its content', async ({ page }) => {
    await mount(page, blocks({ properties: [{ id: 'p-title', visible: true }, { id: 'p-notes', visible: true, width: 500 }] }));
    const notes = header(page, 'p-notes');

    await expect(notes).toHaveCSS('width', '500px');
    await notes.locator('[data-blok-database-table-resize]').dblclick();
    await expect.poll(async () => (await notes.boundingBox())?.width ?? 500).toBeLessThan(250);
    expect((await savedView(page)).properties).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'p-notes', width: expect.any(Number) }),
    ]));
  });

  test('dragging a header reorders the columns', async ({ page }) => {
    await mount(page, blocks());
    const from = await header(page, 'p-stage').boundingBox();
    const to = await header(page, 'p-notes').boundingBox();

    if (from === null || to === null) {
      throw new Error('no header');
    }
    await page.mouse.move(from.x + 20, from.y + 18);
    await page.mouse.down();
    await page.mouse.move(to.x + 10, to.y + 18, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByRole('columnheader').nth(1)).toHaveAttribute('data-property-id', 'p-stage');
    await expect(page.getByRole('menu')).toHaveCount(0);
    const order = ((await savedView(page)).properties as Array<{ id: string }>).map((p) => p.id);

    expect(order.indexOf('p-stage')).toBeLessThan(order.indexOf('p-notes'));
  });

  test('dragging a row lands it, even on keys the fractional-index library rejects', async ({ page }) => {
    // `a000` keys: a drop used to throw inside positionBetween and was lost.
    const legacy = blocks().map((block) => (block.type === 'database-row'
      ? { ...block, data: { ...block.data, position: `a${String(ROWS.findIndex((r) => r.id === block.id)).padStart(3, '0')}` } }
      : block));
    const savedOrder = async (): Promise<string[]> => page.evaluate(async () => {
      const output = await window.blokInstance?.save();

      return (output?.blocks ?? [])
        .filter((block) => block.type === 'database-row')
        .sort((a, b) => {
          const [x, y] = [(a.data as { position: string }).position, (b.data as { position: string }).position];

          return x < y ? -1 : 1;
        })
        .map((block) => block.id ?? '');
    });
    const dragRow = async (rowId: string, targetId: string, edge: 'top' | 'bottom'): Promise<void> => {
      await row(page, rowId).hover();
      await row(page, rowId).locator('[data-blok-database-table-row-handle]').hover();
      const target = await row(page, targetId).boundingBox();

      if (target === null) {
        throw new Error('no row');
      }
      await page.mouse.down();
      await page.mouse.move(target.x + 40, edge === 'top' ? target.y + 4 : target.y + target.height - 4, { steps: 8 });
      await page.mouse.up();
    };

    await mount(page, legacy);

    await dragRow('r3', 'r2', 'top');
    await expect(page.locator('[data-blok-database-table-row]').nth(1)).toHaveAttribute('data-row-id', 'r3');
    expect(await savedOrder()).toEqual(['r1', 'r3', 'r2']);

    await dragRow('r2', 'r1', 'top');
    await expect(page.locator('[data-blok-database-table-row]').first()).toHaveAttribute('data-row-id', 'r2');
    expect(await savedOrder()).toEqual(['r2', 'r1', 'r3']);
  });

  test('Freeze up to this column keeps it in place on horizontal scroll', async ({ page }) => {
    await mount(page, blocks());
    await header(page, 'p-notes').click();
    await page.getByRole('menuitem', { name: 'Freeze' }).click();

    expect((await savedView(page)).frozenColumnCount).toBe(2);
    await expect(header(page, 'p-notes')).toHaveCSS('position', 'sticky');

    const before = await cell(page, 'r1', 'p-title').boundingBox();

    await page.locator('[data-blok-database-table-scroller]').evaluate((el) => el.scrollTo({ left: 300, behavior: 'instant' }));
    const after = await cell(page, 'r1', 'p-title').boundingBox();

    expect(after?.x).toBeGreaterThanOrEqual((before?.x ?? 0) - 300 + 1);
  });

  // notion-motion.md Round 46 §A: Notion's frozen block sticks 30px in from the scroller's edge, nothing scrolled
  // past it shows in that strip, and "+ New page" stays at the text column.
  test('a frozen column sticks 30px in from the table edge and "+ New page" stays put on a sideways scroll', async ({ page }) => {
    await mount(page, blocks({ frozenColumnCount: 1 }));
    const scroller = page.locator('[data-blok-database-table-scroller]');
    const addRow = page.locator('[data-blok-database-table-add-row]');
    const addBefore = await addRow.boundingBox();
    const { left, pad, max } = await scroller.evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      pad: parseFloat(getComputedStyle(el).paddingInlineStart),
      max: el.scrollWidth - el.clientWidth,
    }));
    const scrollLeft = Math.min(max, pad + 200);

    expect(scrollLeft).toBeGreaterThan(pad - 30 + 40);
    await scroller.evaluate((el, x) => el.scrollTo({ left: x, behavior: 'instant' }), scrollLeft);

    await expect.poll(async () => (await cell(page, 'r1', 'p-title').boundingBox())?.x).toBeCloseTo(left + 30, 0);
    expect((await addRow.boundingBox())?.x).toBeCloseTo(addBefore?.x ?? Number.NaN, 0);
    const box = await row(page, 'r1').boundingBox();
    const inStrip = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y)?.closest('[data-blok-database-table-grid]') ?? null) !== null, { x: left + 15, y: (box?.y ?? 0) + 10 });

    expect(inStrip).toBe(false);
  });

  // research/33 §1: Notion showed nothing on 4 undescribed headers within 3s.
  test('a header without a description shows no hint, and keeps its name', async ({ page }) => {
    await mount(page, blocks());
    await header(page, 'p-amount').hover();
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 3000)));
    await expect(page.getByTestId('tooltip').and(page.locator('[data-blok-shown="true"]'))).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Amount' })).toBeVisible();
  });

  test('pressing a header with its hint shown hides the hint and opens the menu', async ({ page }) => {
    const described = blocks();
    const db = described[0].data as { schema: Array<Record<string, unknown>> };

    db.schema = db.schema.map((p) => (p.id === 'p-notes' ? { ...p, description: 'What we know' } : p));
    await mount(page, described);

    const shownHint = page.getByTestId('tooltip').and(page.locator('[data-blok-shown="true"]'));
    const box = await header(page, 'p-notes').boundingBox();

    if (box === null) {
      throw new Error('no header');
    }
    // Raw mouse: locator.click retries around a covering element and would hide a shield.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(shownHint).toContainText('What we know');

    await page.mouse.down();
    await page.mouse.up();

    await expect(page.getByRole('menuitem', { name: 'Freeze' })).toBeVisible();
    await expect(shownHint).toHaveCount(0);
    // The pointer stays on the header past the hint delay: the hint must not come back over the menu.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1000)));
    await expect(shownHint).toHaveCount(0);
  });
});

test.describe('calculations', () => {
  // notion-motion.md Round 10: no footer until a calculation is set, so the first one comes from the header menu.
  test('Sum from the header menu writes the calculation and shows the value', async ({ page }) => {
    await mount(page, blocks());
    const footer = page.locator('[data-blok-database-table-calc][data-property-id="p-amount"]');

    await expect(page.locator('[data-blok-database-table-footer]')).toHaveCount(0);
    await header(page, 'p-amount').click();
    await page.getByRole('menuitem', { name: 'Calculate' }).click();
    // A calculation is a menuitemcheckbox; the group that holds it stays a plain menuitem (Round 64 §5).
    await page.getByRole('menuitem', { name: 'More options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Sum' }).click();

    await expect(footer.locator('[data-blok-database-table-calc-value]')).toHaveText('1235.5');
    await expect(footer.locator('[data-blok-database-table-calc-label]')).toHaveCSS('text-transform', 'none');
    expect((await savedView(page)).calculations).toEqual([{ id: 'p-amount', fn: 'sum' }]);
  });
});

test.describe('load more and groups', () => {
  test('shows the load limit, then Load more adds the next page', async ({ page }) => {
    const many = Array.from({ length: 14 }, (_, i) => ({ id: `m${i}`, properties: { 'p-title': `Row ${i}` } }));

    await mount(page, blocks({ loadLimit: 10 }, many));
    await expect(page.locator('[data-blok-database-table-row]')).toHaveCount(10);

    await page.locator('[data-blok-database-table-load-more]').click();
    await expect(page.locator('[data-blok-database-table-row]')).toHaveCount(14);
  });

  // notion-motion.md Round 29 §1: the ⋯ menu marks the current limit with a check only, no fill; keyboard users land in it.
  test('the Load more ⋯ sets the load limit, its current row has no fill, and the keyboard reaches its rows', async ({ page }) => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, properties: { 'p-title': `Row ${i}` } }));

    await mount(page, blocks({ loadLimit: 10 }, many));
    const dots = page.getByRole('button', { name: 'Load limit' });

    await dots.focus();
    await page.keyboard.press('Enter');
    const current = page.getByRole('menuitemcheckbox', { name: '10 pages' });
    const other = page.getByRole('menuitemcheckbox', { name: '25 pages' });

    await expect(current).toBeVisible();
    await expect(current).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(current.getByTestId('popover-item-trailing-icon')).toBeVisible();
    await expect(other.getByTestId('popover-item-trailing-icon')).toHaveCount(0);
    expect(await current.evaluate((el) => getComputedStyle(el).color)).toBe(await other.evaluate((el) => getComputedStyle(el).color));

    // The menu's keyboard cursor is data-blok-focused, not DOM focus.
    await page.keyboard.press('ArrowDown');
    await expect(current).toHaveAttribute('data-blok-focused', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(other).toHaveAttribute('data-blok-focused', 'true');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-blok-database-table-row]')).toHaveCount(25);
    expect((await savedView(page)).loadLimit).toBe(25);
  });

  test('a grouped table collapses a group with its caret', async ({ page }) => {
    await mount(page, blocks({ groupBy: 'p-stage' }));
    const groups = page.locator('[data-blok-database-table-group]');

    await expect(groups).toHaveCount(3);
    await expect(groups.last()).toHaveAttribute('data-group-key', /no-value/);

    const idea = page.locator('[data-blok-database-table-group][data-group-key="o-idea"]');

    await idea.locator('[data-blok-database-table-group-toggle]').click();
    await expect(idea.locator('[data-blok-database-table-row]')).toHaveCount(0);
    await expect(idea.locator('[data-blok-database-table-group-toggle]')).toHaveAttribute('aria-expanded', 'false');
  });

  const groupHeader = (page: Page, groupKey: string, propertyId: string): Locator =>
    page.locator(`[data-blok-database-table-group][data-group-key="${groupKey}"] [role="columnheader"][data-property-id="${propertyId}"]`);

  test('each group draws its own header row, like Notion', async ({ page }) => {
    await mount(page, blocks({ groupBy: 'p-stage' }));
    const groups = page.locator('[data-blok-database-table-group]');

    await expect(groups).toHaveCount(3);
    for (const index of [0, 1, 2]) {
      await expect(groups.nth(index).locator('[role="columnheader"][data-property-id="p-notes"]')).toHaveCount(1);
    }
  });

  test('resizing a column from the second group resizes it in every group and saves once', async ({ page }) => {
    await mount(page, blocks({ groupBy: 'p-stage' }));
    const handle = groupHeader(page, 'o-build', 'p-notes').locator('[data-blok-database-table-resize]');
    const box = await handle.boundingBox();

    if (box === null) {
      throw new Error('no resize handle');
    }
    await page.mouse.move(box.x + 2, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 82, box.y + 10, { steps: 4 });
    await expect.poll(async () => (await groupHeader(page, 'o-idea', 'p-notes').boundingBox())?.width).toBe(280);
    await page.mouse.up();

    await expect.poll(async () => (await page.locator('[data-row-id="r1"] [role="gridcell"][data-property-id="p-notes"]').boundingBox())?.width).toBe(280);
    const notes = ((await savedView(page)).properties as Array<{ id: string; width?: number }>).find((p) => p.id === 'p-notes');

    expect(notes?.width).toBe(280);
  });

  test('dragging a header in the second group reorders the columns of every group', async ({ page }) => {
    await mount(page, blocks({ groupBy: 'p-stage' }));
    const from = await groupHeader(page, 'o-build', 'p-stage').boundingBox();
    const to = await groupHeader(page, 'o-build', 'p-notes').boundingBox();

    if (from === null || to === null) {
      throw new Error('no header');
    }
    await page.mouse.move(from.x + 20, from.y + 18);
    await page.mouse.down();
    await page.mouse.move(to.x + 10, to.y + 18, { steps: 8 });
    // Only the dragged header's own row slides aside.
    const transform = (key: string): Promise<string> => groupHeader(page, key, 'p-notes').evaluate((el) => el.style.transform);

    await expect.poll(() => transform('o-build')).not.toBe('');
    expect(await transform('o-idea')).toBe('');
    await page.mouse.up();

    for (const key of ['o-idea', 'o-build']) {
      await expect(page.locator(`[data-blok-database-table-group][data-group-key="${key}"] [role="columnheader"]`).nth(1)).toHaveAttribute('data-property-id', 'p-stage');
    }
    const order = ((await savedView(page)).properties as Array<{ id: string }>).map((p) => p.id);

    expect(order.indexOf('p-stage')).toBe(order.indexOf('p-title') + 1);
  });

  test('a property menu opened from a later group stays on that group when the table redraws', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1600 });
    await mount(page, blocks({ groupBy: 'p-stage' }));
    const last = page.locator('[data-blok-database-table-group]').last();
    const notes = last.locator('[role="columnheader"][data-property-id="p-notes"]');

    await notes.click();
    const menu = page.locator('[data-blok-popover-opened="true"] [data-blok-popover-container]').first();

    await expect(menu).toBeVisible();
    const gap = async (): Promise<number> => ((await menu.boundingBox())?.y ?? 0) - ((await notes.boundingBox())?.y ?? 0);
    const before = await gap();

    // A new row in the first group pushes the later groups down and redraws the table.
    await page.evaluate(() => {
      window.blokInstance?.blocks.insert('database-row', { position: 'a9', properties: { 'p-title': 'Delta', 'p-stage': 'o-idea' } }, undefined, undefined, false, false, undefined, undefined, 'api', 'db-1');
    });
    await expect(page.locator('[data-row-id]').filter({ hasText: 'Delta' })).toHaveCount(1);
    await expect.poll(gap).toBeCloseTo(before, 0);
  });
});

test.describe('property and row menus', () => {
  interface SavedOption { id: string; label?: string; color?: string; position?: string }
  const savedSchema = async (page: Page, databaseId = 'db-1'): Promise<Array<{ id: string; config?: { options: SavedOption[] } }>> => page.evaluate(async (id) => {
    const output = await window.blokInstance?.save();
    const db = output?.blocks.find((block) => block.id === id);

    return (db?.data as { schema: Array<{ id: string; config?: { options: SavedOption[] } }> }).schema;
  }, databaseId);
  const openMenu = (page: Page): Locator => page.locator('[data-blok-popover-opened="true"]');
  // Click a menu item once its menu's entrance ends. While it plays the item is "not stable", and each
  // retry of a click scrolls the item to a new alignment (end, center, start): that scrolls this page,
  // the menu follows a frame later, and the still pointer lands on a sibling row that closes the submenu.
  const clickSettled = async (item: Locator): Promise<void> => {
    await item.evaluate((element) => Promise.all(element.closest('[data-blok-popover-container]')?.getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)) ?? []));
    await item.click();
  };

  // notion-motion.md Round 59 §5: the cell editor's ⋯ menu has the whole name selected from 30ms on.
  test('an option menu from the cell editor opens with the whole name selected', async ({ page }) => {
    await mount(page, blocks());
    await cell(page, 'r1', 'p-stage').click();
    await expect(editor(page)).toBeVisible();
    await editor(page).locator('[data-blok-database-select-option="o-idea"]').hover();
    await editor(page).locator('[data-blok-database-select-option="o-idea"] [data-blok-database-select-option-menu]').click();
    const name = page.locator('[data-blok-database-option-panel="o-idea"]').getByRole('textbox', { name: 'Option name' });
    const selection = (): Promise<[number | null, number | null, number]> => name.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd, el.value.length]);

    await expect(name).toBeFocused();
    await expect.poll(selection).toEqual([0, 4, 4]);
    // Still selected once the menu's entrance is over.
    await name.evaluate((el) => Promise.all(el.closest('[data-blok-popover]')?.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)) ?? []));
    expect(await selection()).toEqual([0, 4, 4]);
  });

  test('Edit property on a select recolours an option and the menu stays open', async ({ page }) => {
    await mount(page, blocks());
    await header(page, 'p-stage').click();
    await openMenu(page).getByRole('menuitem', { name: 'Edit property' }).click();
    const list = page.locator('[data-blok-database-options-editor]');

    await expect(list.locator('[data-blok-database-select-option]')).toHaveCount(2);
    // notion-spec-2 §24.8, §25.6: a select shows no note under its options.
    await expect(page.getByText('Changes apply to all views showing this property.')).toHaveCount(0);
    await list.locator('[data-blok-database-select-option="o-build"]').hover();
    await list.locator('[data-blok-database-select-option="o-build"] [data-blok-database-select-option-menu]').click();
    // notion-motion.md Round 57 §2: the option's menu is its own popover beside the list.
    await page.locator('[data-blok-database-option-panel="o-build"] [data-blok-database-option-color="red"]').click();

    await expect.poll(async () => (await savedSchema(page)).find((p) => p.id === 'p-stage')?.config?.options.find((o) => o.id === 'o-build')?.color).toBe('red');
    await expect(list).toBeVisible();
    await expect(cell(page, 'r2', 'p-stage').locator('[data-blok-database-option-pill]')).toHaveAttribute('data-color', 'red');
  });

  test('the options list keeps its own keys: add, rename, Escape and drag, with the menu open', async ({ page }) => {
    await mount(page, blocks());
    await header(page, 'p-stage').click();
    await openMenu(page).getByRole('menuitem', { name: 'Edit property' }).click();
    const list = page.locator('[data-blok-database-options-editor]');
    const options = async (): Promise<SavedOption[]> => (await savedSchema(page)).find((p) => p.id === 'p-stage')?.config?.options ?? [];

    await list.getByRole('button', { name: 'Add an option' }).click();
    const field = list.getByPlaceholder('Type a new option…');

    // notion-motion.md Round 59 §5: a 276x28 field 12 in from the 300 flyout, typed in rgb(44,44,43).
    const flyout = await list.evaluate((el) => el.closest('[data-blok-popover-container]')?.getBoundingClientRect().toJSON() as { x: number; width: number });
    const fieldBox = await field.boundingBox();

    expect(flyout.width).toBe(300);
    expect(fieldBox?.width).toBe(276);
    expect(fieldBox?.height).toBe(28);
    expect(fieldBox?.x).toBe(flyout.x + 12);
    await expect(field).toHaveCSS('color', 'rgb(44, 44, 43)');
    await field.fill('Review');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await options()).map((o) => o.label)).toContain('Review');
    await expect(list).toBeVisible();

    await list.locator('[data-blok-database-select-option="o-idea"]').hover();
    await list.locator('[data-blok-database-select-option="o-idea"] [data-blok-database-select-option-menu]').click();
    await page.locator('[data-blok-database-option-panel="o-idea"]').getByRole('textbox', { name: 'Option name' }).fill('Spark');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await options()).find((o) => o.id === 'o-idea')?.label).toBe('Spark');
    // The rename redraws the list under the menu; the menu stays.
    await expect(page.locator('[data-blok-database-option-panel="o-idea"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-blok-database-option-panel]')).toHaveCount(0);
    await expect(list.locator('[data-blok-database-select-option]')).toHaveCount(3);
    await expect(list).toBeVisible();

    const from = await list.locator('[data-blok-database-select-option="o-build"] [data-blok-database-select-option-handle]').boundingBox();
    const to = await list.locator('[data-blok-database-select-option="o-idea"]').boundingBox();

    if (from === null || to === null) {
      throw new Error('no option rows');
    }
    await list.locator('[data-blok-database-select-option="o-build"]').hover();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + 2, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => {
      const saved = await options();
      const idea = saved.find((o) => o.id === 'o-idea');
      const build = saved.find((o) => o.id === 'o-build');

      return (build?.position ?? 'z') < (idea?.position ?? '');
    }).toBe(true);
  });

  test('the status editor\'s "Edit property" opens the property menu on its options', async ({ page }) => {
    const withStatus = blocks().map((block) => (block.id === 'db-1'
      ? { ...block, data: { ...(block.data), schema: [...SCHEMA, { id: 'p-progress', name: 'Progress', type: 'status', position: 'a8' }] } }
      : block));

    await mount(page, withStatus);
    await cell(page, 'r1', 'p-progress').click();
    await editor(page).locator('[data-blok-database-select-edit-property]').click();

    await expect(editor(page)).toHaveCount(0);
    await openMenu(page).getByRole('menuitem', { name: 'Edit property' }).click();
    await expect(page.locator('[data-blok-database-options-editor="status"] [data-blok-database-status-group-heading]')).toHaveCount(3);
  });

  test('row ⋮⋮ › Move to sends the row to another database, and one undo brings it back', async ({ page }) => {
    const second: OutputBlockData[] = [
      {
        id: 'db-2',
        type: 'database',
        data: {
          title: 'Archive',
          schema: [{ id: 'q-title', name: 'Name', type: 'title', position: 'a0' }, { id: 'q-notes', name: 'Notes', type: 'text', position: 'a1' }],
          views: [{ id: 'w1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'w1',
        },
        content: [],
      },
    ];

    await mount(page, [...blocks(), ...second]);
    const first = page.locator('[data-blok-id="db-1"]');

    await first.locator('[data-row-id="r1"]').hover();
    await first.locator('[data-row-id="r1"] [data-blok-database-table-row-handle]').click();
    await expect(openMenu(page).getByPlaceholder('Search actions…')).toBeVisible();
    await clickSettled(openMenu(page).getByRole('menuitem', { name: 'Move to', exact: true }));
    // notion-motion.md Round 62 §1: the "Move page to…" picker takes the menu's place, its field focused.
    await expect(page.getByPlaceholder('Move page to…')).toBeFocused();
    await clickSettled(page.getByRole('option', { name: 'Archive' }));

    const moved = page.locator('[data-blok-id="db-2"] [data-blok-database-table-row][data-row-id="r1"]');

    await expect(moved).toBeVisible();
    await expect(first.locator('[data-blok-database-table-row][data-row-id="r1"]')).toHaveCount(0);
    expect(await savedRow(page, 'r1')).toEqual({ 'q-title': 'Alpha', 'q-notes': 'short' });

    await page.keyboard.press('ControlOrMeta+z');

    await expect(first.locator('[data-blok-database-table-row][data-row-id="r1"]')).toBeVisible();
    await expect(moved).toHaveCount(0);
    expect(await savedRow(page, 'r1')).toMatchObject({ 'p-title': 'Alpha', 'p-notes': 'short', 'p-amount': 1200, 'p-stage': 'o-idea' });
  });

  // notion-motion.md Round 62 §1 and Round 63 §2.
  test('the Move to picker keeps 453 tall with full-bleed rows, and a query moves it to the right-click point', async ({ page }) => {
    const archive: OutputBlockData = {
      id: 'db-2',
      type: 'database',
      data: {
        title: 'Archive',
        schema: [{ id: 'q-title', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'w1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'w1',
      },
      content: [],
    };
    const box = page.locator('[data-blok-database-move-picker] [data-blok-popover-container]');
    const option = page.locator('[data-blok-database-move-picker] [role="option"]').first();
    const rect = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
      const found = await locator.boundingBox();

      if (found === null) throw new Error('no box');

      return found;
    };
    const openAt = async (): Promise<{ x: number; y: number }> => {
      const target = await rect(cell(page, 'r1', 'p-notes'));
      const point = { x: Math.round(target.x + 20), y: Math.round(target.y + target.height / 2) };

      await page.mouse.click(point.x, point.y, { button: 'right' });
      await clickSettled(openMenu(page).getByRole('menuitem', { name: 'Move to', exact: true }));
      await expect(page.getByPlaceholder('Move page to…')).toBeFocused();
      await box.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))));

      return point;
    };

    // Cleared back to empty, the box is 453 again and keeps 12 from the window's edges.
    // The box re-places from a ResizeObserver, before paint; a read between the resize and that callback sees the old top.
    const clearInside = async (): Promise<void> => {
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      await expect.poll(async () => {
        const found = await rect(box);

        return { height: Math.round(found.height), inside: found.y >= 12 && found.y + found.height <= 705 };
      }).toEqual({ height: 453, inside: true });
    };
    const bottom = async (): Promise<number> => {
      const found = await rect(box);

      return Math.round(found.y + found.height);
    };

    await page.setViewportSize({ width: 1512, height: 717 });
    await mount(page, [...blocks(), archive]);
    const point = await openAt();

    // notion-motion.md Round 64 §3: the box opens at the click point, not on the row menu: 1px under it when it fits.
    await expect.poll(async () => Math.round((await rect(box)).y)).toBe(point.y + 1);
    expect(Math.round((await rect(box)).x)).toBe(point.x);

    // At rest: 453 tall whatever it holds, rows 330 wide edge to edge with no rounding, a 14px field.
    expect((await rect(box)).height).toBeCloseTo(453, 0);
    expect((await rect(option)).width).toBeCloseTo(330, 0);
    expect((await rect(option)).x).toBeCloseTo((await rect(box)).x, 0);
    // The scrolling list clips its rows, so it must span the box too.
    expect((await rect(page.locator('[data-blok-database-move-picker] [data-blok-popover-items]'))).width).toBeCloseTo(330, 0);
    expect(await option.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('0px');
    expect(await page.getByPlaceholder('Move page to…').evaluate((element) => getComputedStyle(element).fontSize)).toBe('14px');

    // A keyboard ring on a full-bleed row is drawn inside it, or the list clips its sides.
    await page.keyboard.press('ArrowDown');
    expect(await option.evaluate((element) => getComputedStyle(element).outlineOffset)).toBe('-2px');
    await page.keyboard.press('ArrowUp');

    // A query: rows inset 322 at +4, radius 6; the box fits its content, its top 1px under the point.
    await page.keyboard.type('Arch');
    await expect.poll(async () => Math.round((await rect(option)).width)).toBe(322);
    expect((await rect(option)).x).toBeCloseTo((await rect(box)).x + 4, 0);
    expect(await option.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('6px');
    await expect.poll(async () => Math.round((await rect(box)).y)).toBe(point.y + 1);
    expect((await rect(box)).height).toBeLessThan(453);

    // When the row menu opened above the point, the searched box sits above it, its bottom on the point.
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const holder = document.getElementById('blok');

      if (holder !== null) holder.style.marginTop = '520px';
    });
    const low = await openAt();

    // Round 64 §3: no room under the point, so the box sits above it, its bottom on the point.
    await expect.poll(bottom).toBe(low.y);
    await page.keyboard.type('Arch');
    await expect.poll(async () => {
      const found = await rect(box);

      return Math.round(found.y + found.height);
    }).toBe(low.y);
    await clearInside();

    // Lower in the window, cleared, the 453 box still fits it.
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const holder = document.getElementById('blok');

      if (holder !== null) holder.style.marginTop = '240px';
    });
    const mid = await openAt();

    expect(mid.y + 454).toBeGreaterThan(717);
    // Round 64 §3: no room under or above the point, so it is clamped 12 over the window bottom.
    await expect.poll(bottom).toBe(705);
    await page.keyboard.type('Arch');
    await expect.poll(async () => Math.round((await rect(option)).width)).toBe(322);
    await clearInside();
  });

  // notion-motion.md Round 64 §3: every entry places the box by one rule, 12 from the window's edges.
  test.describe('Move to picker placement', () => {
    const archiveBlock: OutputBlockData = {
      id: 'db-2',
      type: 'database',
      data: {
        title: 'Archive',
        schema: [{ id: 'q-title', name: 'Name', type: 'title', position: 'a0' }],
        views: [{ id: 'w1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
        activeViewId: 'w1',
      },
      content: [],
    };
    const pickerBox = async (page: Page): Promise<{ x: number; y: number; width: number; height: number }> => {
      const box = page.locator('[data-blok-database-move-picker] [data-blok-popover-container]');

      await expect(page.getByPlaceholder('Move page to…')).toBeFocused();
      await box.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))));
      const found = await box.boundingBox();

      if (found === null) throw new Error('no box');

      return found;
    };
    const lower = async (page: Page, by: number): Promise<void> => {
      await page.evaluate((margin) => {
        const holder = document.getElementById('blok');

        if (holder !== null) holder.style.marginTop = `${margin}px`;
      }, by);
    };

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1512, height: 717 });
    });

    test('a list row\'s right-click opens it at the point, and a query moves it there too', async ({ page }) => {
      await mount(page, [...blocks(), archiveBlock]);
      await page.evaluate(async (input) => {
        await window.blokInstance?.render({ blocks: input });
      }, [...blocks({ type: 'list', name: 'List' }), archiveBlock]);
      await lower(page, 240);
      const listRow = page.locator('[data-blok-id="db-1"] [data-blok-database-list-row][data-row-id="r1"]');
      const target = await listRow.boundingBox();

      if (target === null) throw new Error('no row');
      const point = { x: Math.round(target.x + 40), y: Math.round(target.y + target.height / 2) };

      await page.mouse.click(point.x, point.y, { button: 'right' });
      await clickSettled(openMenu(page).getByRole('menuitem', { name: 'Move to', exact: true }));
      const rest = await pickerBox(page);

      // No room under or above the point: clamped 12 over the window bottom, at the click x.
      expect(Math.round(rest.y + rest.height)).toBe(705);
      expect(Math.round(rest.x)).toBe(point.x);

      await page.keyboard.type('Arch');
      await expect.poll(async () => Math.round((await pickerBox(page)).y)).toBe(point.y + 1);
    });

    // notion-motion.md Round 65 §3: Notion's row starts 8 left of its halo, which is Blok's row box.
    test('⌘⇧P on a selected row keeps the box 12 over the window bottom, and Escape drops the selection', async ({ page }) => {
      await mount(page, [...blocks(), archiveBlock]);
      await lower(page, 240);
      await row(page, 'r1').hover();
      await row(page, 'r1').locator('[data-blok-database-table-row-handle]').click();
      await expect(openMenu(page).getByPlaceholder('Search actions…')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(row(page, 'r1')).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ControlOrMeta+Shift+P');
      const found = await pickerBox(page);
      const rowBox = await row(page, 'r1').boundingBox();

      expect(Math.round(found.x)).toBe(Math.round((rowBox?.x ?? -1) - 8));
      expect(Math.round(found.y + found.height)).toBe(705);

      await page.keyboard.press('Escape');
      await expect(page.getByPlaceholder('Move page to…')).toHaveCount(0);
      await expect(row(page, 'r1')).toHaveAttribute('aria-selected', 'false');
    });

    // notion-motion.md Round 65 §3: from the ⋮⋮ the box hangs under the handle, not from the row menu.
    test('the row ⋮⋮ › Move to opens it under the handle, or 12 over the window bottom', async ({ page }) => {
      const openFromHandle = async (): Promise<{ x: number; bottom: number }> => {
        await row(page, 'r1').hover();
        const handle = row(page, 'r1').locator('[data-blok-database-table-row-handle]');

        await handle.click();
        await clickSettled(openMenu(page).getByRole('menuitem', { name: 'Move to', exact: true }));
        // Read when the picker reads it: after the menu has opened and closed.
        const box = await handle.boundingBox();

        if (box === null) throw new Error('no handle');

        return { x: box.x, bottom: box.y + box.height };
      };

      await mount(page, [...blocks(), archiveBlock]);
      const high = await openFromHandle();
      const under = await pickerBox(page);

      expect(high.bottom + 453).toBeLessThanOrEqual(705);
      expect(Math.round(under.x)).toBe(Math.round(high.x));
      expect(Math.round(under.y)).toBe(Math.round(high.bottom));

      await page.keyboard.press('Escape');
      await lower(page, 240);
      const low = await openFromHandle();
      const clamped = await pickerBox(page);

      expect(low.bottom + 453).toBeGreaterThan(705);
      expect(Math.round(clamped.x)).toBe(Math.round(low.x));
      expect(Math.round(clamped.y + clamped.height)).toBe(705);
    });

    test('the side peek\'s ••• opens it under the button, 12 in from the window\'s right edge', async ({ page }) => {
      await mount(page, [...blocks(), archiveBlock]);
      await row(page, 'r1').hover();
      await row(page, 'r1').locator('[data-blok-database-table-open]').click();
      const actions = page.locator('[data-blok-database-peek-actions]:not([hidden])');

      await actions.click();
      await clickSettled(openMenu(page).getByRole('menuitem', { name: 'Move to', exact: true }));
      const found = await pickerBox(page);
      const button = await actions.boundingBox();

      expect(Math.round(found.x + found.width)).toBe(1512 - 12);
      expect(Math.round(found.y)).toBe(Math.round((button?.y ?? 0) + (button?.height ?? 0)));
    });
  });

  // notion-motion.md Round 62 §1 and Round 63 §2: Workspace rows 330x28, chevron 20 at +14, icon 16 at +37, title at +60; a level is +14.
  test('the Move to picker\'s Workspace tree opens a page\'s children 14px further in', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await page.evaluate(async (input) => {
      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }
      document.getElementById('blok')?.remove();
      const holder = document.createElement('div');
      const tree: Record<string, Array<{ pageId: string; title: string }>> = {
        '': [{ pageId: 'w-home', title: 'Home' }, { pageId: 'w-notes', title: 'Notes' }],
        'w-home': [{ pageId: 'w-plans', title: 'Plans' }],
      };

      holder.id = 'blok';
      holder.style.cssText = 'max-width:900px;margin:40px auto 0';
      document.body.appendChild(holder);
      window.blokInstance = new window.Blok({
        holder,
        data: { blocks: input },
        tools: {
          page: {
            class: (window as unknown as { defaultBlockTools: Record<string, { class: unknown }> }).defaultBlockTools.page.class,
            config: {
              databasePages: true,
              createFromMention: true,
              search: async () => [],
              children: async (pageId: string | null) => tree[pageId ?? ''] ?? [],
              create: () => undefined,
            },
          },
        },
      });
      await window.blokInstance.isReady;
    }, blocks());
    await expect(page.getByRole('grid').first()).toBeVisible();

    const box = page.locator('[data-blok-database-move-picker] [data-blok-popover-container]');
    const treeRow = (title: string): Locator => page.locator('[data-blok-database-move-picker] [data-blok-page-picker-tree-row]').filter({ hasText: title });
    const rect = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
      const found = await locator.boundingBox();

      if (found === null) throw new Error('no box');

      return found;
    };
    const offsets = async (title: string): Promise<number[]> => {
      const left = (await rect(box)).x;
      const row = treeRow(title);

      return [
        (await rect(row.getByTestId('page-picker-tree-chevron'))).x - left,
        (await rect(row.getByTestId('page-picker-option-icon'))).x - left,
        (await rect(row.getByText(title, { exact: true }))).x - left,
      ].map((value) => Math.round(value));
    };

    await page.locator('[data-row-id="r1"]').hover();
    await page.locator('[data-row-id="r1"] [data-blok-database-table-row-handle]').click();
    await clickSettled(openMenu(page).getByRole('menuitem', { name: 'Move to', exact: true }));
    await expect(page.getByPlaceholder('Move page to…')).toBeFocused();
    await expect(page.locator('[data-blok-database-move-picker] [data-blok-page-picker-section="workspace"]')).toHaveText('Workspace');
    await box.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined))));

    expect(await offsets('Home')).toEqual([14, 37, 60]);
    expect(Math.round((await rect(treeRow('Home'))).height)).toBe(28);
    expect(Math.round((await rect(treeRow('Home'))).width)).toBe(330);
    expect(Math.round((await rect(treeRow('Home').getByTestId('page-picker-tree-chevron'))).width)).toBe(20);
    expect(Math.round((await rect(treeRow('Home').getByTestId('page-picker-option-icon'))).width)).toBe(16);

    // notion-motion.md Round 65 §3: an open chevron painted 4.5 x 8, not a filled triangle.
    const glyph = treeRow('Home').locator('[data-blok-testid="page-picker-tree-chevron"] svg');
    const ink = await glyph.evaluate((svg) => {
      const path = svg.querySelector('path');

      if (path === null) throw new Error('no path');
      const box = path.getBoundingClientRect();
      const stroke = Number.parseFloat(getComputedStyle(path).strokeWidth);

      return { width: box.width + stroke, height: box.height + stroke, fill: getComputedStyle(path).fill };
    });

    expect(ink.fill).toBe('none');
    expect(Math.abs(ink.width - 4.5)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(ink.height - 8)).toBeLessThanOrEqual(0.5);

    const angle = (): Promise<number> => glyph.evaluate((element) => {
      const turn = new DOMMatrix(getComputedStyle(element).transform);
      const rotate = getComputedStyle(element).rotate;

      return Math.round(Math.atan2(turn.b, turn.a) * 180 / Math.PI) + (rotate === 'none' ? 0 : Number.parseFloat(rotate));
    });
    // Round 65 §3: the turn takes 0.2s ease-out, and focus goes to the chevron, with no ring.
    await page.evaluate(() => {
      const turns: unknown[] = [];
      const animate = Element.prototype.animate;

      Object.assign(window, { chevronTurns: turns });
      Element.prototype.animate = function (this: Element, keyframes, options) {
        if (this.closest('[data-blok-testid="page-picker-tree-chevron"]') !== null) turns.push({ keyframes, options });

        return animate.call(this, keyframes, options);
      };
    });
    await treeRow('Home').getByTestId('page-picker-tree-chevron').click();
    await expect(treeRow('Plans')).toBeVisible();
    expect((await page.evaluate(() => (window as unknown as { chevronTurns: unknown[] }).chevronTurns))[0]).toEqual({
      keyframes: [{ rotate: 'none' }, { rotate: '90deg' }],
      options: { duration: 200, easing: 'ease-out' },
    });
    expect(await offsets('Plans')).toEqual([28, 51, 74]);
    // The chevron turns down while the row is open.
    await expect.poll(angle).toBe(90);
    await expect(treeRow('Home').getByTestId('page-picker-tree-chevron')).toBeFocused();
    expect(await treeRow('Home').getByTestId('page-picker-tree-chevron').evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');

    // notion-motion.md Round 66 §4: on the focused chevron the arrows do nothing, and Space and Enter toggle it without picking.
    const chevron = treeRow('Home').getByTestId('page-picker-tree-chevron');
    const search = page.getByPlaceholder('Move page to…');
    const highlighted = page.locator('[data-blok-database-move-picker] [role="option"][aria-selected="true"]');
    const before = await highlighted.allTextContents();

    for (const key of ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft']) {
      await page.keyboard.press(key);
      await expect(chevron).toBeFocused();
      await expect(chevron).toHaveAttribute('aria-expanded', 'true');
      await expect(highlighted).toHaveText(before);
    }
    await page.keyboard.press('Space');
    await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    await expect(treeRow('Plans')).toHaveCount(0);
    await expect(search).toHaveValue('');
    await page.keyboard.press('Enter');
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(treeRow('Plans')).toBeVisible();
    await expect(chevron).toBeFocused();
    await expect(page.locator('[data-row-id="r1"]')).toBeVisible();

    // notion-motion.md Round 68 §5: Shift+Tab focuses the chevron's own row, and nothing else changes.
    await page.keyboard.press('Shift+Tab');
    await expect(treeRow('Home')).toBeFocused();
    await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    await expect(search).toHaveValue('');
    await expect(page.locator('[data-row-id="r1"]')).toBeVisible();
  });
});

test.describe('read-only', () => {
  test('renders the grid without gutter, new page row or editors', async ({ page }) => {
    await mount(page, blocks(), true);

    await expect(page.locator('[data-blok-database-table-gutter]')).toHaveCount(0);
    await expect(page.locator('[data-blok-database-table-add-row]')).toHaveCount(0);
    await cell(page, 'r1', 'p-notes').click();
    await expect(editor(page)).toHaveCount(0);
  });
});

test.describe('select all from a cell', () => {
  test('⌘A on one selected cell selects every page block, not cells (notion-motion.md Round 13)', async ({ page }) => {
    await mount(page, [
      { id: 'p-before', type: 'paragraph', data: { text: 'Before' } },
      ...blocks(),
      { id: 'p-after', type: 'paragraph', data: { text: 'After' } },
    ]);
    await cell(page, 'r3', 'p-amount').click();
    await page.keyboard.press('Escape');
    await expect(anchor(page)).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+a');

    for (const id of ['p-before', 'db-1', 'p-after']) {
      await expect(page.locator(`[data-blok-id="${id}"]`)).toHaveAttribute('data-blok-selected', 'true');
    }
    await expect(anchor(page)).toHaveCount(0);
    await expect(page.locator('[data-blok-database-table-cell][aria-selected="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('');

    await page.keyboard.press('ControlOrMeta+a');
    await expect(page.locator('[data-blok-id="p-after"]')).toHaveAttribute('data-blok-selected', 'true');
  });

  test('⌘A on selected rows hands over to the block selection and drops the rows', async ({ page }) => {
    await mount(page, [
      { id: 'p-before', type: 'paragraph', data: { text: 'Before' } },
      ...blocks(),
    ]);
    await cell(page, 'r2', 'p-notes').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(row(page, 'r2')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('ControlOrMeta+a');

    await expect(page.locator('[data-blok-id="p-before"]')).toHaveAttribute('data-blok-selected', 'true');
    await expect(page.locator('[data-blok-database-table-row][aria-selected="true"]')).toHaveCount(0);
  });
});

test.describe('range drag', () => {
  test('a drag across 2×2 cells selects them, a TSV paste fills them, and one undo takes it back (notion-motion.md Round 13)', async ({ page }) => {
    await mount(page, blocks());
    const from = await cell(page, 'r1', 'p-notes').boundingBox();
    const to = await cell(page, 'r2', 'p-amount').boundingBox();

    if (from === null || to === null) {
      throw new Error('no cell box');
    }
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator('[data-blok-database-table-cell][aria-selected="true"]')).toHaveCount(4);
    for (const [rowId, propertyId] of [['r1', 'p-notes'], ['r1', 'p-amount'], ['r2', 'p-notes'], ['r2', 'p-amount']]) {
      await expect(cell(page, rowId, propertyId)).toHaveAttribute('aria-selected', 'true');
    }
    await expect(anchor(page)).toHaveCount(1);
    await expect(cell(page, 'r1', 'p-notes')).toHaveAttribute('data-blok-database-table-cell-anchor', '');
    await expect(editor(page)).toHaveCount(0);
    await expect(page.locator('[data-blok-selected="true"]')).toHaveCount(0);
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('');

    await page.evaluate(() => {
      const transfer = new DataTransfer();

      transfer.setData('text/plain', 'Short note\t1234.5\nLong note\t-40');
      document.querySelector('[role="grid"]')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    });

    await expect.poll(async () => (await savedRow(page, 'r2'))['p-amount']).toBe(-40);
    expect(await savedRow(page, 'r1')).toMatchObject({ 'p-notes': 'Short note', 'p-amount': 1234.5 });
    expect((await savedRow(page, 'r2'))['p-notes']).toBe('Long note');
    await expect(page.locator('[data-blok-database-table-cell][aria-selected="true"]')).toHaveCount(4);
    await expect(cell(page, 'r1', 'p-notes')).toHaveAttribute('data-blok-database-table-cell-anchor', '');

    await page.keyboard.press('ControlOrMeta+z');

    await expect.poll(async () => (await savedRow(page, 'r2'))['p-amount']).toBe(35.5);
    expect(await savedRow(page, 'r1')).toMatchObject({ 'p-notes': 'short', 'p-amount': 1200 });
    expect((await savedRow(page, 'r2'))['p-notes'] ?? '').toBe('');
  });
});
