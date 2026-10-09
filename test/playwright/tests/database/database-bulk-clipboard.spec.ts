/**
 * Table bulk actions and the clipboard.
 * - Bulk edit (Cmd/Ctrl+/) and fill (Cmd/Ctrl+R, Cmd/Ctrl+D): https://www.notion.com/help/keyboard-shortcuts
 * - Row checkbox selection and the edit menu: https://www.notion.com/help/tables
 * - Paste one value into many cells: https://www.notion.com/releases/2021-12-23
 * - Fill handle: https://www.notion.com/releases/2022-08-25
 * Fill handle size and the selection bar: research/08. Selection is gray (D3).
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
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a2' },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a3',
    config: { options: [{ id: 'o-idea', label: 'Idea', position: 'a0' }, { id: 'o-build', label: 'Build', position: 'a1' }] },
  },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a4' },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Alpha', 'p-notes': 'short', 'p-amount': 1200, 'p-stage': 'o-idea' } },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-amount': 35.5 } },
  { id: 'r3', properties: { 'p-title': 'Charlie' } },
];

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({ id: row.id, type: 'database-row', parent: 'db-1', data: { position: `a${i}`, properties: row.properties } })),
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:80px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, blocks());
  await expect(page.getByRole('grid')).toBeVisible();
};

const properties = async (page: Page): Promise<Record<string, Record<string, unknown>>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return Object.fromEntries((output?.blocks ?? [])
    .filter((block) => block.type === 'database-row')
    .map((block) => [block.id, (block.data as { properties: Record<string, unknown> }).properties]));
});

const row = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);
const cell = (page: Page, rowId: string, propertyId: string): Locator =>
  row(page, rowId).locator(`[role="gridcell"][data-property-id="${propertyId}"]`);

/** Selects a cell without leaving its editor open. */
const selectCell = async (page: Page, rowId: string, propertyId: string): Promise<void> => {
  await cell(page, rowId, propertyId).click();
  if (await page.locator('[data-blok-database-cell-editor]').count() > 0) {
    await page.keyboard.press('Escape');
  }
};

const paste = async (page: Page, data: Record<string, string>): Promise<void> => {
  await page.evaluate((formats) => {
    const transfer = new DataTransfer();

    Object.entries(formats).forEach(([format, value]) => transfer.setData(format, value));
    document.querySelector('[role="grid"]')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, data);
};

const copy = async (page: Page): Promise<{ text: string; html: string }> => page.evaluate(() => {
  const transfer = new DataTransfer();

  document.querySelector('[role="grid"]')?.dispatchEvent(new ClipboardEvent('copy', { clipboardData: transfer, bubbles: true, cancelable: true }));

  return { text: transfer.getData('text/plain'), html: transfer.getData('text/html') };
});

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
});

test.describe('clipboard', () => {
  test('copies a range as TSV and an HTML table', async ({ page }) => {
    await selectCell(page, 'r1', 'p-title');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');

    const copied = await copy(page);

    expect(copied.text).toBe('Alpha\tshort\nBravo\t');
    expect(copied.html).toContain('<td>Alpha</td><td>short</td>');
  });

  test('pastes a block of cells, then one undo takes the whole paste back', async ({ page }) => {
    await selectCell(page, 'r2', 'p-amount');
    await paste(page, { 'text/plain': '7\tBuild\n8\tIdea' });

    await expect.poll(async () => {
      const values = await properties(page);

      return [values.r2['p-amount'], values.r2['p-stage'], values.r3['p-amount'], values.r3['p-stage']];
    }).toEqual([7, 'o-build', 8, 'o-idea']);

    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await properties(page)).r3['p-amount']).toBeUndefined();
    expect((await properties(page)).r2['p-amount']).toBe(35.5);
  });

  test('pastes one value into every selected cell', async ({ page }) => {
    await selectCell(page, 'r1', 'p-notes');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await paste(page, { 'text/plain': 'same' });

    await expect.poll(async () => Object.values(await properties(page)).map((values) => values['p-notes'])).toEqual(['same', 'same', 'same']);
  });

  test('a pasted table with matching headers becomes new rows', async ({ page }) => {
    await page.getByRole('grid').focus();
    await paste(page, {
      'text/html': '<table><tr><th>Name</th><th>Stage</th></tr><tr><td>Delta</td><td>Build</td></tr><tr><td>Echo</td><td>Idea</td></tr></table>',
      'text/plain': 'Name\tStage\nDelta\tBuild\nEcho\tIdea',
    });

    await expect(row(page, 'r3')).toBeVisible();
    await expect.poll(async () => Object.values(await properties(page)).slice(3).map((values) => [values['p-title'], values['p-stage']]))
      .toEqual([['Delta', 'o-build'], ['Echo', 'o-idea']]);
  });
});

test.describe('fill', () => {
  test('Cmd/Ctrl+D fills down and Cmd/Ctrl+R fills right', async ({ page }) => {
    await selectCell(page, 'r1', 'p-amount');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('ControlOrMeta+d');

    await expect.poll(async () => Object.values(await properties(page)).map((values) => values['p-amount'])).toEqual([1200, 1200, 1200]);

    await selectCell(page, 'r2', 'p-title');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ControlOrMeta+r');

    await expect.poll(async () => (await properties(page)).r2['p-notes']).toBe('Bravo');
  });

  test('the fill handle is a 9px circle with a 2px ring, and dragging it fills down', async ({ page }) => {
    await selectCell(page, 'r1', 'p-notes');
    const handle = cell(page, 'r1', 'p-notes').locator('[data-blok-database-table-fill-handle]');

    await expect(handle).toHaveCSS('width', '9px');
    await expect(handle).toHaveCSS('border-top-width', '2px');
    await expect(handle).toHaveCSS('border-radius', '50%');

    const box = await handle.boundingBox();
    const target = await cell(page, 'r3', 'p-notes').boundingBox();

    if (box === null || target === null) throw new Error('no geometry');
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(target.x + 20, target.y + target.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect.poll(async () => Object.values(await properties(page)).map((values) => values['p-notes'])).toEqual(['short', 'short', 'short']);
  });
});

test.describe('bulk actions', () => {
  const checkbox = (page: Page, rowId: string): Locator => row(page, rowId).locator('[data-blok-database-table-row-checkbox]');

  test('shift-click selects a range; the bar count is gray; a property button edits every row', async ({ page }) => {
    await row(page, 'r1').hover();
    await checkbox(page, 'r1').click();
    await row(page, 'r3').hover();
    await checkbox(page, 'r3').click({ modifiers: ['Shift'] });

    const bar = page.getByRole('toolbar');

    await expect(bar.locator('[data-blok-database-table-selection-count]')).toHaveText('3 selected');
    const color = await bar.locator('[data-blok-database-table-selection-count]').evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];

    expect(b - Math.min(r, g)).toBeLessThan(40);

    await bar.getByRole('button', { name: 'Done' }).click();
    await expect.poll(async () => Object.values(await properties(page)).map((values) => values['p-done'])).toEqual([true, true, true]);
  });

  test('Cmd/Ctrl+/ lists the properties; the … menu duplicates', async ({ page }) => {
    await row(page, 'r1').hover();
    await checkbox(page, 'r1').click();
    await page.keyboard.press('ControlOrMeta+/');
    await expect(page.locator('[data-blok-popover-item]').filter({ hasText: 'Stage' })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('toolbar').getByRole('button', { name: 'More actions' }).click();
    await page.locator('[data-blok-popover-item]').filter({ hasText: 'Duplicate' }).click();

    await expect.poll(async () => Object.keys(await properties(page)).length).toBe(4);
  });
});
