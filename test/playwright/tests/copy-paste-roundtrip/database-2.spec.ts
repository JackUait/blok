/**
 * Database round trips: table grid cells and rows, board and list item
 * selection, and row page body blocks.
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

interface SavedBlock {
  id: string;
  type: string;
  parent?: string;
  content?: string[];
  data: Record<string, unknown>;
}

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a2' },
  { id: 'p-pct', name: 'Pct', type: 'number', position: 'a3', number: { format: 'percent' } },
  {
    id: 'p-stage', name: 'Stage', type: 'select', position: 'a4',
    config: { options: [{ id: 'o-idea', label: 'Idea', position: 'a0' }, { id: 'o-build', label: 'Build', position: 'a1' }] },
  },
  {
    id: 'p-tags', name: 'Tags', type: 'multiSelect', position: 'a5',
    config: { options: [{ id: 't-red', label: 'Red', position: 'a0' }, { id: 't-bg', label: 'Blue, Green', position: 'a1' }, { id: 't-q', label: 'Say "hi"', position: 'a2' }] },
  },
  { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a6' },
  { id: 'p-due', name: 'Due', type: 'date', position: 'a7' },
  { id: 'p-url', name: 'Link', type: 'url', position: 'a8' },
  { id: 'p-email', name: 'Mail', type: 'email', position: 'a9' },
  { id: 'p-phone', name: 'Phone', type: 'phone', position: 'b0' },
  { id: 'p-owner', name: 'Owner', type: 'person', position: 'b1' },
  { id: 'p-files', name: 'Files', type: 'files', position: 'b2' },
  { id: 'p-rel', name: 'Related', type: 'relation', position: 'b3', relation: { targetDatabaseId: 'db-1' } },
  { id: 'p-place', name: 'Place', type: 'place', position: 'b4' },
  { id: 'p-rich', name: 'Rich', type: 'richText', position: 'b5' },
];

const FULL: Record<string, unknown> = {
  'p-title': 'Alpha',
  'p-notes': 'two\nlines "quoted"',
  'p-amount': 1200.5,
  'p-pct': 0.125,
  'p-stage': 'o-idea',
  'p-tags': ['t-red', 't-bg', 't-q'],
  'p-done': true,
  'p-due': '2026-01-05/2026-01-09',
  'p-url': 'https://example.com/a?b=1',
  'p-email': 'a@example.com',
  'p-phone': '+1 555 0100',
  'p-owner': ['u1'],
  'p-files': [{ url: 'https://example.com/f.pdf', name: 'f.pdf' }],
  'p-rel': [{ id: 'r4' }],
  'p-place': { name: 'Office', address: '1 Main St' },
  'p-rich': { blocks: [{ type: 'paragraph', data: { text: 'Rich' } }] },
};

const rowsOf = (props: Array<Record<string, unknown>>, dbId: string): OutputBlockData[] =>
  props.map((properties, i) => ({ id: `r${i + 1}`, type: 'database-row', parent: dbId, data: { position: `a${i}`, properties } }));

const gridDoc = (): OutputBlockData[] => [
  { id: 'above', type: 'paragraph', data: { text: 'Above' } },
  {
    id: 'db-1', type: 'database',
    data: { schema: SCHEMA, views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v1' },
    content: ['r1', 'r2', 'r3', 'r4'],
  },
  ...rowsOf([FULL, { 'p-title': 'Bravo' }, { 'p-title': '' }, { 'p-title': 'Charlie' }], 'db-1'),
  { id: 'target', type: 'paragraph', data: { text: '' } },
  { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
] as OutputBlockData[];

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, data);
};

const saved = async (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return (output?.blocks ?? []) as SavedBlock[];
});

const settle = async (page: Page): Promise<SavedBlock[]> => {
  let last = '';
  let stable = 0;
  let blocks: SavedBlock[] = [];

  for (let i = 0; i < 40 && stable < 3; i++) {
    // eslint-disable-next-line playwright/no-wait-for-timeout -- paste and save settle with no event to wait on
    await page.waitForTimeout(150);
    blocks = await saved(page);
    const sig = JSON.stringify(blocks);

    stable = sig === last ? stable + 1 : 0;
    last = sig;
  }

  return blocks;
};

const fireOn = async (target: Locator, type: 'copy' | 'cut'): Promise<Record<string, string>> => target.evaluate(async (element, eventType) => {
  const store: Record<string, string> = {};
  const transfer = new DataTransfer();
  const original = transfer.setData.bind(transfer);

  transfer.setData = (format: string, value: string): void => {
    store[format] = value;
    original(format, value);
  };
  element.dispatchEvent(new ClipboardEvent(eventType, { clipboardData: transfer, bubbles: true, cancelable: true }));
  for (let i = 0; i < 40 && Object.keys(store).length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));

  return store;
}, type);

/** Copy/cut fired at the focused element, as a keyboard copy does. */
const fireAtFocus = async (page: Page, type: 'copy' | 'cut'): Promise<Record<string, string>> => page.evaluate(async (eventType) => {
  const store: Record<string, string> = {};
  const transfer = new DataTransfer();
  const original = transfer.setData.bind(transfer);

  transfer.setData = (format: string, value: string): void => {
    store[format] = value;
    original(format, value);
  };
  (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent(eventType, { clipboardData: transfer, bubbles: true, cancelable: true }));
  for (let i = 0; i < 40 && Object.keys(store).length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));

  return store;
}, type);

const pasteOn = async (target: Locator, formats: Record<string, string>): Promise<void> => {
  await target.evaluate((element, data) => {
    const transfer = new DataTransfer();

    Object.entries(data).forEach(([format, value]) => transfer.setData(format, value));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, formats);
};

const pasteAtFocus = async (page: Page, formats: Record<string, string>): Promise<void> => {
  await page.evaluate((data) => {
    const transfer = new DataTransfer();

    Object.entries(data).forEach(([format, value]) => transfer.setData(format, value));
    (document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, formats);
};

const pick = (formats: Record<string, string>, keys: string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(formats).filter(([key]) => keys.includes(key)));

const grid = (page: Page, dbId = 'db-1'): Locator => page.locator(`[data-blok-id="${dbId}"] [role="grid"]`).first();
const row = (page: Page, rowId: string, dbId = 'db-1'): Locator => page.locator(`[data-blok-id="${dbId}"] [data-blok-database-table-row][data-row-id="${rowId}"]`);
const cell = (page: Page, rowId: string, propertyId: string, dbId = 'db-1'): Locator =>
  row(page, rowId, dbId).locator(`[role="gridcell"][data-property-id="${propertyId}"]`);

const selectCell = async (page: Page, rowId: string, propertyId: string, dbId = 'db-1'): Promise<void> => {
  await cell(page, rowId, propertyId, dbId).click();
  if (await page.locator('[data-blok-database-cell-editor]').count() > 0) {
    await page.keyboard.press('Escape');
  }
};

const props = (blocks: SavedBlock[], rowId: string): Record<string, unknown> =>
  (blocks.find((block) => block.id === rowId)?.data.properties ?? {}) as Record<string, unknown>;

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('table grid', () => {
  test('grid-range-types: copy a whole row range, paste over another row: every value per type', async ({ page }) => {
    await mount(page, gridDoc());
    await expect(grid(page)).toBeVisible();
    await selectCell(page, 'r1', 'p-title');
    for (let i = 1; i < SCHEMA.length; i++) {
      await page.keyboard.press('Shift+ArrowRight');
    }
    const formats = await fireOn(grid(page), 'copy');

    await selectCell(page, 'r2', 'p-title');
    await pasteOn(grid(page), formats);
    const after = await settle(page);
    const r2 = props(after, 'r2');
    // The saver reshapes some values (rich text into segments), so compare with the saved source row.
    const r1 = props(after, 'r1');

    for (const property of SCHEMA) {
      expect.soft(r2[property.id], `${property.type} (${property.id})`).toEqual(r1[property.id]);
    }
  });

  test('grid-range-plain: the same range through text/plain only', async ({ page }) => {
    test.fixme(true, 'database-grid-range-plain: place and rich text cannot round-trip through TSV until a format is decided');
    await mount(page, gridDoc());
    await expect(grid(page)).toBeVisible();
    await selectCell(page, 'r1', 'p-title');
    for (let i = 1; i < SCHEMA.length; i++) {
      await page.keyboard.press('Shift+ArrowRight');
    }
    const formats = await fireOn(grid(page), 'copy');

    await selectCell(page, 'r2', 'p-title');
    await pasteOn(grid(page), pick(formats, ['text/plain']));
    const after = await settle(page);
    const r2 = props(after, 'r2');

    for (const property of SCHEMA) {
      expect.soft(r2[property.id], `${property.type} (${property.id})`).toEqual(FULL[property.id]);
    }
  });

  test('grid-past-end: a two-row range pasted at the last row adds a row for the overflow', async ({ page }) => {
    await mount(page, gridDoc());
    await expect(grid(page)).toBeVisible();
    await selectCell(page, 'r1', 'p-title');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const formats = await fireOn(grid(page), 'copy');

    await selectCell(page, 'r4', 'p-title');
    await pasteOn(grid(page), formats);
    const after = await settle(page);
    const rows = after.filter((block) => block.parent === 'db-1');

    expect.soft(rows).toHaveLength(5);
    expect.soft(props(after, 'r4')['p-title']).toBe('Alpha');
    const added = rows.find((block) => !['r1', 'r2', 'r3', 'r4'].includes(block.id));

    expect.soft((added?.data.properties as Record<string, unknown> | undefined)?.['p-title']).toBe('Bravo');
  });

  test('grid-rows-copy-paste-rows-selected: copy rows picked with checkboxes, paste while they stay picked', async ({ page }) => {
    await mount(page, gridDoc());
    await expect(grid(page)).toBeVisible();
    const before = await saved(page);

    await row(page, 'r2').hover();
    await row(page, 'r2').locator('[data-blok-database-table-row-checkbox]').click();
    await row(page, 'r4').hover();
    await row(page, 'r4').locator('[data-blok-database-table-row-checkbox]').click({ modifiers: ['Shift'] });
    const formats = await fireOn(grid(page), 'copy');

    expect.soft(formats['text/plain'] ?? '').toContain('Bravo');
    await pasteOn(grid(page), formats);
    const after = await settle(page);
    const beforeRows = before.filter((block) => block.parent === 'db-1').map((block) => ({ id: block.id, p: block.data.properties }));
    const afterRows = after.filter((block) => block.parent === 'db-1').map((block) => ({ id: block.id, p: block.data.properties }));

    // Expected: paste over the picked rows writes the same values back (a no-op), or adds the 3 copied rows; never drops a copied row.
    const titles = afterRows.map((entry) => (entry.p as Record<string, unknown>)['p-title']);
    const sameAsBefore = JSON.stringify(afterRows) === JSON.stringify(beforeRows);
    const addedTitles = titles.slice(beforeRows.length);

    expect.soft(sameAsBefore || JSON.stringify(addedTitles) === JSON.stringify(['Bravo', '', 'Charlie']), 'paste over picked rows: no-op or the 3 copied rows').toBe(true);
  });

  test('grid-rows-copy-paste-into-empty-row: copy rows picked with checkboxes, paste at an empty row title cell', async ({ page }) => {
    await mount(page, gridDoc());
    await expect(grid(page)).toBeVisible();
    await row(page, 'r1').hover();
    await row(page, 'r1').locator('[data-blok-database-table-row-checkbox]').click();
    const formats = await fireOn(grid(page), 'copy');

    await selectCell(page, 'r3', 'p-title');
    await pasteOn(grid(page), formats);
    const after = await settle(page);
    const r3 = props(after, 'r3');

    expect.soft(r3['p-title']).toBe('Alpha');
    expect.soft(r3['p-amount']).toBe(1200.5);
    expect.soft(r3['p-stage']).toBe('o-idea');
  });

  test('grid-to-other-database: copy cells, paste into another database whose columns share names', async ({ page }) => {
    const second: OutputBlockData[] = [
      {
        id: 'db-2', type: 'database',
        data: {
          schema: [
            { id: 'q-title', name: 'Name', type: 'title', position: 'a0' },
            { id: 'q-stage', name: 'Stage', type: 'select', position: 'a1', config: { options: [{ id: 'x-idea', label: 'Idea', position: 'a0' }] } },
          ],
          views: [{ id: 'w1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'w1',
        },
        content: ['s1'],
      },
      { id: 's1', type: 'database-row', parent: 'db-2', data: { position: 'a0', properties: { 'q-title': '' } } },
    ] as OutputBlockData[];

    await mount(page, [
      { id: 'above', type: 'paragraph', data: { text: 'Above' } },
      {
        id: 'db-1', type: 'database',
        data: { schema: SCHEMA.slice(0, 5).filter((p) => p.id === 'p-title' || p.id === 'p-stage'), views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v1' },
        content: ['r1'],
      },
      { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-stage': 'o-idea' } } },
      ...second,
    ] as OutputBlockData[]);
    await expect(page.getByRole('grid')).toHaveCount(2);
    await selectCell(page, 'r1', 'p-title');
    await page.keyboard.press('Shift+ArrowRight');
    const formats = await fireOn(grid(page), 'copy');

    await selectCell(page, 's1', 'q-title', 'db-2');
    await pasteOn(grid(page, 'db-2'), formats);
    const after = await settle(page);

    expect.soft(props(after, 's1')).toEqual({ 'q-title': 'Alpha', 'q-stage': 'x-idea' });
  });

  test('grid-to-paragraph: copy cells, paste outside the database into a paragraph', async ({ page }) => {
    await mount(page, gridDoc());
    await expect(grid(page)).toBeVisible();
    const before = await saved(page);

    await selectCell(page, 'r1', 'p-title');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const formats = await fireOn(grid(page), 'copy');

    const target = page.locator('[data-blok-id="target"] [contenteditable="true"]');

    await target.click();
    await pasteOn(target, formats);
    const after = await settle(page);
    const added = after.filter((block) => !before.some((old) => old.id === block.id) || block.id === 'target');

    const text = JSON.stringify(added);

    for (const value of ['Alpha', 'two', 'Bravo']) {
      expect.soft(text, `${value} survives`).toContain(value);
    }
  });
});

test.describe('board and list items', () => {
  for (const { name, view, selector } of [
    { name: 'board card', view: { type: 'board', groupBy: 'p-stage' }, selector: '[data-blok-database-card]' },
    { name: 'list row', view: { type: 'list' }, selector: '[data-blok-database-list-row]' },
  ]) {
    test(`card-copy (${name}): pick an item with Shift-click and copy`, async ({ page }) => {
      await mount(page, [
        { id: 'above', type: 'paragraph', data: { text: 'Above' } },
        {
          id: 'db-1', type: 'database',
          data: { schema: SCHEMA.slice(0, 5), views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }], activeViewId: 'v1' },
          content: ['r1', 'r2'],
        },
        ...rowsOf([{ 'p-title': 'Alpha', 'p-stage': 'o-idea' }, { 'p-title': 'Bravo', 'p-stage': 'o-idea' }], 'db-1'),
        { id: 'target', type: 'paragraph', data: { text: '' } },
      ] as OutputBlockData[]);
      await page.getByText('Above', { exact: true }).click();
      await page.locator(`${selector}[data-row-id="r1"]`).first().click({ modifiers: ['Shift'] });
      const picked = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-blok-database-row-selected]')].map((el) => el.getAttribute('data-row-id')))]);

      expect(picked).toEqual(['r1']);
      const formats = await fireAtFocus(page, 'copy');

      const before = await saved(page);
      const target = page.locator('[data-blok-id="target"] [contenteditable="true"]');

      await target.click();
      await pasteOn(target, formats);
      const after = await settle(page);
      const added = after.filter((block) => !before.some((old) => old.id === block.id) || block.id === 'target');

      expect.soft(Object.keys(formats).length, 'copy puts the item on the clipboard').toBeGreaterThan(0);
      expect.soft(JSON.stringify(added), 'the item title comes back').toContain('Alpha');
    });
  }
});

test.describe('row page body', () => {
  const bodyDoc = (): OutputBlockData[] => [
    { id: 'above', type: 'paragraph', data: { text: 'Above' } },
    {
      id: 'db-1', type: 'database',
      data: { schema: SCHEMA.slice(0, 2), views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'v1' },
      content: ['r1', 'r2'],
    },
    { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha' } }, content: ['b1', 'b2', 'b3'] },
    { id: 'b1', type: 'paragraph', parent: 'r1', data: { text: 'Body <b>one</b>' } },
    { id: 'b2', type: 'toggle', parent: 'r1', data: { text: 'Body toggle', isOpen: true }, content: ['b2c'] },
    { id: 'b2c', type: 'paragraph', parent: 'b2', data: { text: 'Toggle child' } },
    { id: 'b3', type: 'paragraph', parent: 'r1', data: { text: 'Body three' } },
    { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Bravo' } } },
    { id: 'target', type: 'paragraph', data: { text: '' } },
    { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
  ] as OutputBlockData[];

  const openRow = async (page: Page, rowId: string): Promise<void> => {
    await row(page, rowId).hover();
    await row(page, rowId).locator('[data-blok-database-table-open]').click();
    await expect(page.locator('[data-blok-database-drawer]')).toBeVisible();
  };
  const body = (page: Page): Locator => page.locator('[data-blok-database-drawer-editor]');
  const closePeek = async (page: Page): Promise<void> => {
    await page.mouse.click(5, 5);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-blok-database-drawer]')).toHaveCount(0);
  };

  /** Selects b1..b3 (with b2's child) as a keyboard user would and copies them. */
  const copyBody = async (page: Page): Promise<Record<string, string>> => {
    await openRow(page, 'r1');
    await body(page).getByText('Body one').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    const selected = await page.evaluate(() => [...document.querySelectorAll('[data-blok-selected="true"]')].map((el) => el.getAttribute('data-blok-id')));

    expect(selected).toEqual(expect.arrayContaining(['b1', 'b2', 'b3']));
    const formats = await fireAtFocus(page, 'copy');

    return formats;
  };

  const shape = (blocks: SavedBlock[], parentId: string): unknown => {
    const byId = new Map(blocks.map((block) => [block.id, block]));
    const node = (id: string): unknown => {
      const block = byId.get(id);

      return { type: block?.type, data: block?.data, children: (block?.content ?? []).map(node) };
    };

    return (byId.get(parentId)?.content ?? []).map(node);
  };

  test('body-to-other-row: copy body blocks of one row page, paste into another row page', async ({ page }) => {
    await mount(page, bodyDoc());
    await expect(grid(page)).toBeVisible();
    const before = await settle(page);
    const formats = await copyBody(page);

    await closePeek(page);
    await openRow(page, 'r2');
    await body(page).locator('[data-blok-database-row-empty]').click();
    await pasteAtFocus(page, formats);
    const after = await settle(page);

    expect.soft(shape(after, 'r2')).toEqual(shape(before, 'r1'));
    expect.soft(shape(after, 'r1'), 'source body unchanged').toEqual(shape(before, 'r1'));
  });

  test('body-to-top-level: copy body blocks of a row page, paste at the top level', async ({ page }) => {
    await mount(page, bodyDoc());
    await expect(grid(page)).toBeVisible();
    const before = await settle(page);
    const formats = await copyBody(page);

    await closePeek(page);
    const target = page.locator('[data-blok-id="target"] [contenteditable="true"]');

    await target.click();
    await pasteOn(target, formats);
    const after = await settle(page);
    const added = after.filter((block) => !before.some((old) => old.id === block.id));
    const roots = added.filter((block) => block.parent === undefined);

    const byId = new Map(after.map((block) => [block.id, block]));
    const node = (id: string): unknown => ({ type: byId.get(id)?.type, data: byId.get(id)?.data, children: (byId.get(id)?.content ?? []).map(node) });

    expect.soft(roots.map((block) => node(block.id))).toEqual(shape(before, 'r1'));
  });

  test('body-select-all-escalation: Cmd+A inside a row page body, copy, paste at the top level', async ({ page }) => {
    await mount(page, bodyDoc());
    await expect(grid(page)).toBeVisible();
    const before = await settle(page);

    await openRow(page, 'r1');
    await body(page).getByText('Body one').click();
    const steps: string[][] = [];

    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ControlOrMeta+a');
      steps.push(await page.evaluate(() => [...document.querySelectorAll('[data-blok-selected="true"]')].map((el) => el.getAttribute('data-blok-id') ?? '')));
    }
    const formats = await fireAtFocus(page, 'copy');

    await closePeek(page);
    const target = page.locator('[data-blok-id="target"] [contenteditable="true"]');

    await target.click();
    await pasteOn(target, formats);
    const after = await settle(page);
    const added = after.filter((block) => !before.some((old) => old.id === block.id));

    expect.soft(added.filter((block) => block.type === 'database-row' && block.parent === undefined).map((block) => block.id), 'no orphan database-row at top level').toEqual([]);
    expect.soft(after.filter((block) => block.parent === 'db-1').map((block) => block.id), 'original rows unchanged').toEqual(['r1', 'r2']);
  });

  test('body-text-fragment: copy the text of one body paragraph, paste into another row page', async ({ page }) => {
    await mount(page, bodyDoc());
    await expect(grid(page)).toBeVisible();
    await openRow(page, 'r1');
    const first = body(page).getByText('Body one');

    await first.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    const formats = await fireAtFocus(page, 'copy');

    await closePeek(page);
    await openRow(page, 'r2');
    await body(page).locator('[data-blok-database-row-empty]').click();
    await pasteAtFocus(page, formats);
    const after = await settle(page);

    expect.soft(shape(after, 'r2')).toEqual([
      { type: 'paragraph', data: { text: [{ text: 'Body ' }, { text: 'one', marks: { bold: true } }] }, children: [] },
    ]);
  });
});
