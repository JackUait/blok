/**
 * The Notion table view: cell keyboard model, editing each type, column
 * resize, reorder and freeze, calculations, load more, a grouped table and
 * read-only. Behaviour from research/08 "Cell keyboard model"; sizes from
 * research/07. Each case checks the saved JSON, not only the DOM.
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
    data: { position: `a${String(i).padStart(3, '0')}`, properties: row.properties },
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
  await expect(page.getByRole('grid')).toBeVisible();
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
    await expect(page.locator('[data-blok-database-table-grid]')).toHaveAttribute('data-blok-keyboard-owner', '');
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

  test('Freeze up to this column keeps it in place on horizontal scroll', async ({ page }) => {
    await mount(page, blocks());
    await header(page, 'p-notes').click();
    await page.getByRole('menuitem', { name: 'Freeze up to column' }).click();

    expect((await savedView(page)).frozenColumnCount).toBe(2);
    await expect(header(page, 'p-notes')).toHaveCSS('position', 'sticky');

    const before = await cell(page, 'r1', 'p-title').boundingBox();

    await page.locator('[data-blok-database-table-scroller]').evaluate((el) => el.scrollTo({ left: 300, behavior: 'instant' }));
    const after = await cell(page, 'r1', 'p-title').boundingBox();

    expect(after?.x).toBeGreaterThanOrEqual((before?.x ?? 0) - 300 + 1);
  });

  test('the header hint shows the full name only after a hover delay', async ({ page }) => {
    await mount(page, blocks());
    await header(page, 'p-amount').hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.getByRole('tooltip')).toContainText('Amount', { timeout: 2000 });
  });
});

test.describe('calculations', () => {
  test('Sum from the footer menu writes the calculation and shows the value', async ({ page }) => {
    await mount(page, blocks());
    const footer = page.locator('[data-blok-database-table-calc][data-property-id="p-amount"]');

    await footer.click();
    // Calculation rows mark the current choice, so they are menuitemcheckbox.
    await page.getByRole('menuitemcheckbox', { name: 'More options' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Sum' }).click();

    await expect(footer.locator('[data-blok-database-table-calc-value]')).toHaveText('1235.5');
    await expect(footer.locator('[data-blok-database-table-calc-label]')).toHaveCSS('text-transform', 'uppercase');
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
