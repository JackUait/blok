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
    await page.getByRole('menuitem', { name: 'Freeze up to column' }).click();

    expect((await savedView(page)).frozenColumnCount).toBe(2);
    await expect(header(page, 'p-notes')).toHaveCSS('position', 'sticky');

    const before = await cell(page, 'r1', 'p-title').boundingBox();

    await page.locator('[data-blok-database-table-scroller]').evaluate((el) => el.scrollTo({ left: 300, behavior: 'instant' }));
    const after = await cell(page, 'r1', 'p-title').boundingBox();

    expect(after?.x).toBeGreaterThanOrEqual((before?.x ?? 0) - 300 + 1);
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

    await expect(page.getByRole('menuitem', { name: 'Freeze up to column' })).toBeVisible();
    await expect(shownHint).toHaveCount(0);
    // The pointer stays on the header past the hint delay: the hint must not come back over the menu.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 1000)));
    await expect(shownHint).toHaveCount(0);
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

  test('Edit property on a select recolours an option and the menu stays open', async ({ page }) => {
    await mount(page, blocks());
    await header(page, 'p-stage').click();
    await openMenu(page).getByRole('menuitem', { name: 'Edit property' }).click();
    const list = page.locator('[data-blok-database-options-editor]');

    await expect(list.locator('[data-blok-database-select-option]')).toHaveCount(2);
    await expect(page.getByText('Changes apply to all views showing this property.')).toBeVisible();
    await list.locator('[data-blok-database-select-option="o-build"]').hover();
    await list.locator('[data-blok-database-select-option="o-build"] [data-blok-database-select-option-menu]').click();
    await list.locator('[data-blok-database-option-color="red"]').click();

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
    await list.getByPlaceholder('Add an option').fill('Review');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await options()).map((o) => o.label)).toContain('Review');
    await expect(list).toBeVisible();

    await list.locator('[data-blok-database-select-option="o-idea"]').hover();
    await list.locator('[data-blok-database-select-option="o-idea"] [data-blok-database-select-option-menu]').click();
    await list.getByRole('textbox', { name: 'Option name' }).fill('Spark');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await options()).find((o) => o.id === 'o-idea')?.label).toBe('Spark');

    await page.keyboard.press('Escape');
    await expect(list.locator('[data-blok-database-option-panel]')).toHaveCount(0);
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
    await clickSettled(page.getByRole('menuitem', { name: 'Archive' }));

    const moved = page.locator('[data-blok-id="db-2"] [data-blok-database-table-row][data-row-id="r1"]');

    await expect(moved).toBeVisible();
    await expect(first.locator('[data-blok-database-table-row][data-row-id="r1"]')).toHaveCount(0);
    expect(await savedRow(page, 'r1')).toEqual({ 'q-title': 'Alpha', 'q-notes': 'short' });

    await page.keyboard.press('ControlOrMeta+z');

    await expect(first.locator('[data-blok-database-table-row][data-row-id="r1"]')).toBeVisible();
    await expect(moved).toHaveCount(0);
    expect(await savedRow(page, 'r1')).toMatchObject({ 'p-title': 'Alpha', 'p-notes': 'short', 'p-amount': 1200, 'p-stage': 'o-idea' });
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
