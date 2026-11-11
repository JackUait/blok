/**
 * A whole database block copied (or cut) by block selection and pasted back
 * into the same editor.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { openFixtureToggles } from '../helpers/toggle-open';

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
  {
    id: 'p-stage', name: 'Stage', type: 'select', position: 'a3',
    config: { options: [{ id: 'o-idea', label: 'Idea', position: 'a0' }, { id: 'o-build', label: 'Build', position: 'a1' }] },
  },
  { id: 'p-double', name: 'Double', type: 'formula', position: 'a4', formula: { expression: '{{property:p-amount}} * 2' } },
  { id: 'p-next', name: 'Next', type: 'relation', position: 'a5', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-prev' } },
  { id: 'p-prev', name: 'Prev', type: 'relation', position: 'a6', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-next' } },
  { id: 'p-total', name: 'Total', type: 'rollup', position: 'a7', rollup: { relationPropertyId: 'p-next', targetPropertyId: 'p-amount', function: 'sum' } },
];

const dbBlocks = (dbId = 'db-1', extra: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: dbId,
    type: 'database',
    data: {
      title: 'Tasks',
      schema: SCHEMA.map((p) => (p.type === 'relation' ? { ...p, relation: { ...p.relation, targetDatabaseId: dbId } } : p)),
      views: [
        { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], rowOrder: { [`${dbId}-r1`]: 'a2', [`${dbId}-r2`]: 'a0', [`${dbId}-r3`]: 'a1' } },
        { id: 'v2', name: 'Board', type: 'board', position: 'a1', groupBy: 'p-stage', sorts: [], filters: [], visibleProperties: [] },
      ],
      activeViewId: 'v1',
      ...extra,
    },
    content: [`${dbId}-r1`, `${dbId}-r2`, `${dbId}-r3`],
  },
  {
    id: `${dbId}-r1`, type: 'database-row', parent: dbId,
    data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-notes': 'first', 'p-amount': 1, 'p-stage': 'o-idea', 'p-next': [{ id: `${dbId}-r2` }] } },
    content: [`${dbId}-b1`, `${dbId}-b2`],
  },
  { id: `${dbId}-b1`, type: 'paragraph', parent: `${dbId}-r1`, data: { text: 'Alpha <b>body</b>' } },
  { id: `${dbId}-b2`, type: 'paragraph', parent: `${dbId}-r1`, data: { text: 'Alpha second' } },
  {
    id: `${dbId}-r2`, type: 'database-row', parent: dbId,
    data: { position: 'a1', properties: { 'p-title': 'Bravo', 'p-amount': 2, 'p-stage': 'o-build', 'p-prev': [{ id: `${dbId}-r1` }] } },
  },
  { id: `${dbId}-r3`, type: 'database-row', parent: dbId, data: { position: 'a2', properties: { 'p-title': 'Charlie', 'p-amount': 4 } } },
] as OutputBlockData[];

const docBlocks = (middle: OutputBlockData[]): OutputBlockData[] => [
  { id: 'above', type: 'paragraph', data: { text: 'Above' } },
  ...middle,
  { id: 'between', type: 'paragraph', data: { text: 'Between' } },
  { id: 'target', type: 'paragraph', data: { text: '' } },
  { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
] as OutputBlockData[];

const mount = async (page: Page, data: OutputBlockData[], config: Record<string, unknown> = {}): Promise<void> => {
  await page.evaluate(async ({ input, extra }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input }, ...extra });
    await window.blokInstance.isReady;
  }, { input: data, extra: config });
};

const saved = async (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return (output?.blocks ?? []) as SavedBlock[];
});

/** Polls save() until the block list stops changing. */
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

const selectedIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => [...document.querySelectorAll('[data-blok-selected="true"]')].map((el) => el.getAttribute('data-blok-id') ?? ''));

/** Dispatches a real copy/cut ClipboardEvent on `document` and captures every MIME it sets. */
const fireClipboard = async (page: Page, type: 'copy' | 'cut'): Promise<Record<string, string>> => page.evaluate(async (eventType) => {
  const store: Record<string, string> = {};
  const transfer = new DataTransfer();
  const original = transfer.setData.bind(transfer);

  transfer.setData = (format: string, value: string): void => {
    store[format] = value;
    original(format, value);
  };
  const target = document.activeElement ?? document.body;

  target.dispatchEvent(new ClipboardEvent(eventType, { clipboardData: transfer, bubbles: true, cancelable: true }));
  for (let i = 0; i < 40 && Object.keys(store).length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));

  return store;
}, type);

const pasteAtBlock = async (page: Page, blockId: string, formats: Record<string, string>): Promise<void> => {
  const input = page.locator(`[data-blok-id="${blockId}"] [contenteditable="true"]`).first();

  await input.click();
  await input.evaluate((element, data) => {
    const transfer = new DataTransfer();

    Object.entries(data).forEach(([format, value]) => transfer.setData(format, value));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, formats);
};

const pick = (formats: Record<string, string>, keys: string[]): Record<string, string> =>
  Object.fromEntries(Object.entries(formats).filter(([key]) => keys.includes(key)));

interface Node { type: string; data: unknown; children: Node[] }

/**
 * The database subtree with every id it owns turned into a stable label
 * (SELF, ROW#i, BLK#k, VIEW#i). An id it does not own stays as EXT:<id>,
 * so a copy that still names the original's rows shows up as a diff.
 */
const normalize = (blocks: SavedBlock[], rootId: string): Node | null => {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const root = byId.get(rootId);

  if (root === undefined) return null;
  const labels = new Map<string, string>([[rootId, 'SELF']]);
  const counter = { row: 0, blk: 0 };
  const walk = (id: string): void => {
    const block = byId.get(id);

    if (block === undefined) return;
    (block.content ?? []).forEach((child) => {
      const childBlock = byId.get(child);

      labels.set(child, childBlock?.type === 'database-row' && id === rootId ? `ROW#${counter.row++}` : `BLK#${counter.blk++}`);
      walk(child);
    });
  };

  walk(rootId);
  const views = Array.isArray(root.data.views) ? root.data.views as Array<{ id?: string }> : [];

  views.forEach((view, index) => {
    if (typeof view.id === 'string') labels.set(view.id, `VIEW#${index}`);
  });
  const allIds = new Set(blocks.map((block) => block.id));
  const relabel = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (labels.has(value)) return labels.get(value);

      return allIds.has(value) ? `EXT:${value}` : value;
    }
    if (Array.isArray(value)) return value.map(relabel);
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [labels.get(key) ?? (allIds.has(key) ? `EXT:${key}` : key), relabel(inner)]));
    }

    return value;
  };
  const node = (id: string): Node => {
    const block = byId.get(id);

    return { type: block?.type ?? 'MISSING', data: relabel(block?.data), children: (block?.content ?? []).map(node) };
  };

  return node(rootId);
};

const newDatabaseIds = (before: SavedBlock[], after: SavedBlock[]): string[] => {
  const old = new Set(before.map((block) => block.id));

  return after.filter((block) => block.type === 'database' && !old.has(block.id)).map((block) => block.id);
};

/** Escape on "Above", then ArrowDown (and Shift+ArrowDown `extend` times): the block selection a keyboard user makes. */
const selectFromAbove = async (page: Page, extend = 0): Promise<void> => {
  await page.getByText('Above', { exact: true }).click();
  await page.keyboard.press('Escape');
  if (extend === 0) {
    await page.keyboard.press('ArrowDown');

    return;
  }
  // Shift+ArrowDown grows from "Above", so it rides along in the copy.
  for (let i = 0; i <= extend; i++) {
    await page.keyboard.press('Shift+ArrowDown');
  }
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('whole database block', () => {
  test('db-copy-full: copy a database, paste it below: schema, rows, bodies, views, relations survive', async ({ page }) => {
    await mount(page, docBlocks(dbBlocks()));
    await expect(page.getByRole('grid')).toBeVisible();
    const before = await settle(page);
    const expected = normalize(before, 'db-1');

    await selectFromAbove(page);
    expect(await selectedIds(page)).toEqual(['db-1']);
    const formats = await fireClipboard(page, 'copy');

    expect(Object.keys(formats)).toContain('application/x-blok');
    await pasteAtBlock(page, 'target', formats);
    const after = await settle(page);
    const ids = newDatabaseIds(before, after);

    expect.soft(ids).toHaveLength(1);
    const copy = ids[0] === undefined ? null : normalize(after, ids[0]);

    expect.soft(copy).toEqual(expected);
    expect.soft(normalize(after, 'db-1'), 'original unchanged').toEqual(expected);
    expect.soft(after.filter((block) => block.type === 'database-row' && block.parent === undefined).map((b) => b.id), 'no top-level rows').toEqual([]);
    if (ids[0] !== undefined) {
      // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
      await expect.soft(page.locator(`[data-blok-id="${ids[0]}"] [data-blok-database-table-row]`)).toHaveCount(3);
    }
  });

  test('db-copy-stale: edit a cell then copy at once: the copy carries the edit', async ({ page }) => {
    await mount(page, docBlocks(dbBlocks()));
    await expect(page.getByRole('grid')).toBeVisible();
    const cell = page.locator('[data-blok-id="db-1"] [data-blok-database-table-row][data-row-id="db-1-r3"] [role="gridcell"][data-property-id="p-notes"]');

    await cell.click();
    if (await page.locator('[data-blok-database-cell-editor]').count() === 0) {
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('edited');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await selectFromAbove(page);
    expect(await selectedIds(page)).toEqual(['db-1']);
    const formats = await fireClipboard(page, 'copy');
    const payload = JSON.parse(formats['application/x-blok'] ?? '[]') as Array<{ id: string; data: { properties?: Record<string, unknown> } }>;

    expect.soft(payload.find((entry) => entry.id === 'db-1-r3')?.data.properties?.['p-notes']).toBe('edited');
  });

  test('db-copy-two-related: copy two related databases together: the relation points at the copies', async ({ page }) => {
    const projects: OutputBlockData[] = [
      {
        id: 'db-p', type: 'database',
        data: {
          title: 'Projects',
          schema: [
            { id: 'pp-title', name: 'Project', type: 'title', position: 'a0' },
            { id: 'pp-tasks', name: 'Tasks', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db-t', twoWay: true, syncedPropertyId: 'tt-project' } },
          ],
          views: [{ id: 'vp', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'vp',
        },
        content: ['p1'],
      },
      { id: 'p1', type: 'database-row', parent: 'db-p', data: { position: 'a0', properties: { 'pp-title': 'Launch', 'pp-tasks': [{ id: 't1' }] } } },
      {
        id: 'db-t', type: 'database',
        data: {
          title: 'Tasks',
          schema: [
            { id: 'tt-title', name: 'Task', type: 'title', position: 'a0' },
            { id: 'tt-project', name: 'Project', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db-p', twoWay: true, syncedPropertyId: 'pp-tasks' } },
          ],
          views: [{ id: 'vt', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
          activeViewId: 'vt',
        },
        content: ['t1', 't2'],
      },
      { id: 't1', type: 'database-row', parent: 'db-t', data: { position: 'a0', properties: { 'tt-title': 'Write', 'tt-project': [{ id: 'p1' }] } } },
      { id: 't2', type: 'database-row', parent: 'db-t', data: { position: 'a1', properties: { 'tt-title': 'Ship' } } },
    ] as OutputBlockData[];

    await mount(page, docBlocks(projects));
    await expect(page.getByRole('grid')).toHaveCount(2);
    const before = await settle(page);

    await selectFromAbove(page, 1);
    expect(await selectedIds(page)).toEqual(['above', 'db-p', 'db-t']);
    const formats = await fireClipboard(page, 'copy');

    await pasteAtBlock(page, 'target', formats);
    const after = await settle(page);
    const ids = newDatabaseIds(before, after);

    expect.soft(ids).toHaveLength(2);
    const [newP, newT] = ids;
    const pData = after.find((b) => b.id === newP)?.data as { schema?: Array<{ id: string; relation?: { targetDatabaseId?: string } }> } | undefined;
    const tData = after.find((b) => b.id === newT)?.data as { schema?: Array<{ id: string; relation?: { targetDatabaseId?: string } }> } | undefined;
    const newPRows = after.filter((b) => b.parent === newP);
    const newTRows = after.filter((b) => b.parent === newT);

    expect.soft(pData?.schema?.find((p) => p.id === 'pp-tasks')?.relation?.targetDatabaseId, 'P copy relation target').toBe(newT);
    expect.soft(tData?.schema?.find((p) => p.id === 'tt-project')?.relation?.targetDatabaseId, 'T copy relation target').toBe(newP);
    const pTasks = (newPRows[0]?.data.properties as Record<string, unknown> | undefined)?.['pp-tasks'];

    expect.soft(pTasks, 'P copy row relation names the T copy row').toEqual([{ id: newTRows[0]?.id }]);
    const original = after.filter((b) => b.parent === 'db-t' || b.parent === 'db-p').map((b) => ({ id: b.id, props: b.data.properties }));

    expect.soft(original).toEqual(before.filter((b) => b.parent === 'db-t' || b.parent === 'db-p').map((b) => ({ id: b.id, props: b.data.properties })));
  });

  test('db-cut-paste: cut a database and paste it back: same database', async ({ page }) => {
    await mount(page, docBlocks(dbBlocks()));
    await expect(page.getByRole('grid')).toBeVisible();
    const before = await settle(page);
    const expected = normalize(before, 'db-1');

    await selectFromAbove(page);
    expect(await selectedIds(page)).toEqual(['db-1']);
    const formats = await fireClipboard(page, 'cut');
    const afterCut = await settle(page);

    expect.soft(afterCut.some((b) => b.id === 'db-1'), 'cut removed the database').toBe(false);
    await pasteAtBlock(page, 'target', formats);
    const after = await settle(page);
    const dbs = after.filter((b) => b.type === 'database');

    expect.soft(dbs).toHaveLength(1);
    const copy = dbs[0] === undefined ? null : normalize(after, dbs[0].id);

    expect.soft(copy).toEqual(expected);
    expect.soft(after.filter((b) => b.type === 'database-row' && b.parent === undefined).map((b) => b.id), 'no top-level rows').toEqual([]);
  });

  test('db-paste-in-toggle: a copied database pasted inside a toggle lands in it with its rows', async ({ page }) => {
    const blocks = [
      { id: 'above', type: 'paragraph', data: { text: 'Above' } },
      ...dbBlocks(),
      { id: 'tg', type: 'toggle', data: { text: 'Toggle', isOpen: true }, content: ['target'] },
      { id: 'target', type: 'paragraph', parent: 'tg', data: { text: 'In toggle' } },
      { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
    ] as OutputBlockData[];

    await mount(page, blocks);
    await openFixtureToggles(page, { blocks });
    await expect(page.getByRole('grid')).toBeVisible();
    const before = await settle(page);
    const expected = normalize(before, 'db-1');

    await selectFromAbove(page);
    expect(await selectedIds(page)).toEqual(['db-1']);
    const formats = await fireClipboard(page, 'copy');

    await page.getByText('In toggle', { exact: true }).click({ timeout: 3000 });
    await page.keyboard.press('End');
    await page.evaluate((data) => {
      const transfer = new DataTransfer();

      Object.entries(data).forEach(([format, value]) => transfer.setData(format, value));
      document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, formats);
    const after = await settle(page);
    const ids = newDatabaseIds(before, after);
    const copyBlock = after.find((b) => b.id === ids[0]);

    expect.soft(copyBlock?.parent, 'copy sits in the toggle').toBe('tg');
    expect.soft(ids[0] === undefined ? null : normalize(after, ids[0])).toEqual(expected);
    if (ids[0] !== undefined) {
      const inToggle = await page.locator(`[data-blok-id="tg"] [data-blok-id="${ids[0]}"]`).count();

      // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
      expect.soft(inToggle, 'copy holder is inside the toggle DOM').toBe(1);
    }
  });

  test('db-copy-linked-view-alone: copy a linked view without its source: it still shows the source', async ({ page }) => {
    await mount(page, [
      ...docBlocks([
        { id: 'db-l', type: 'database', data: { title: '', schema: [], views: [{ id: 'vl', name: 'Linked', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'vl', source: { databaseId: 'db-1' } } },
      ] as OutputBlockData[]),
      ...dbBlocks(),
    ] as OutputBlockData[]);
    await expect(page.getByRole('grid')).toHaveCount(2);
    const before = await settle(page);

    await selectFromAbove(page);
    expect(await selectedIds(page)).toEqual(['db-l']);
    const formats = await fireClipboard(page, 'copy');

    await pasteAtBlock(page, 'target', formats);
    const after = await settle(page);
    const ids = newDatabaseIds(before, after);
    const copy = after.find((b) => b.id === ids[0]);

    expect.soft((copy?.data.source as { databaseId?: string } | undefined)?.databaseId).toBe('db-1');
    if (ids[0] !== undefined) {
      // eslint-disable-next-line playwright/no-conditional-expect -- the expected result depends on the clipboard variant
      await expect.soft(page.locator(`[data-blok-id="${ids[0]}"] [data-blok-database-table-row]`)).toHaveCount(3);
    }
  });

  test('db-copy-linked-with-source: copy a source and its linked view together: the copy view names the copy source', async ({ page }) => {
    await mount(page, docBlocks([
      ...dbBlocks(),
      { id: 'db-l', type: 'database', data: { title: '', schema: [], views: [{ id: 'vl', name: 'Linked', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }], activeViewId: 'vl', source: { databaseId: 'db-1' } } },
    ] as OutputBlockData[]));
    await expect(page.getByRole('grid')).toHaveCount(2);
    const before = await settle(page);

    await selectFromAbove(page, 1);
    expect(await selectedIds(page)).toEqual(['above', 'db-1', 'db-l']);
    const formats = await fireClipboard(page, 'copy');

    await pasteAtBlock(page, 'target', formats);
    const after = await settle(page);
    const ids = newDatabaseIds(before, after);
    const linkedCopy = after.find((b) => ids.includes(b.id) && b.data.source !== undefined);
    const sourceCopy = after.find((b) => ids.includes(b.id) && b.data.source === undefined);

    expect.soft((linkedCopy?.data.source as { databaseId?: string } | undefined)?.databaseId).toBe(sourceCopy?.id);
  });

  test('db-copy-full-page: a full-page database copies with fullPage and rows', async ({ page }) => {
    await mount(page, docBlocks(dbBlocks('db-1', { fullPage: true })));
    const before = await settle(page);
    const expected = normalize(before, 'db-1');

    await selectFromAbove(page);
    const selected = await selectedIds(page);

    expect(selected).toEqual(['db-1']);
    const formats = await fireClipboard(page, 'copy');

    await pasteAtBlock(page, 'target', formats);
    const after = await settle(page);
    const ids = newDatabaseIds(before, after);

    expect.soft(ids).toHaveLength(1);
    expect.soft(ids[0] === undefined ? null : normalize(after, ids[0])).toEqual(expected);
  });

  test('db-select-all-copy: Cmd+A over the page, copy, paste at the end: every database row comes back', async ({ page }) => {
    await mount(page, docBlocks(dbBlocks()));
    await expect(page.getByRole('grid')).toBeVisible();
    const before = await settle(page);
    const expected = normalize(before, 'db-1');

    await page.getByText('Above', { exact: true }).click();
    for (let i = 0; i < 5 && !(await selectedIds(page)).includes('db-1'); i++) {
      await page.keyboard.press('ControlOrMeta+a');
    }

    const formats = await fireClipboard(page, 'copy');
    const payload = JSON.parse(formats['application/x-blok'] ?? '[]') as Array<{ id: string; tool: string }>;

    expect.soft(payload.map((entry) => entry.id)).toEqual(expect.arrayContaining(['db-1', 'db-1-r1', 'db-1-r2', 'db-1-r3', 'db-1-b1', 'db-1-b2']));
    await page.getByText('Tail', { exact: true }).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.evaluate((data) => {
      const transfer = new DataTransfer();

      Object.entries(data).forEach(([format, value]) => transfer.setData(format, value));
      document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    }, formats);
    const after = await settle(page);
    const ids = newDatabaseIds(before, after);

    expect.soft(ids).toHaveLength(1);
    expect.soft(ids[0] === undefined ? null : normalize(after, ids[0])).toEqual(expected);
  });

  test('db-degraded-html: copy a database, paste only text/html + text/plain', async ({ page }) => {
    await mount(page, docBlocks(dbBlocks()));
    await expect(page.getByRole('grid')).toBeVisible();
    const before = await settle(page);

    await selectFromAbove(page);
    expect(await selectedIds(page)).toEqual(['db-1']);
    const formats = await fireClipboard(page, 'copy');

    await pasteAtBlock(page, 'target', pick(formats, ['text/html', 'text/plain']));
    const after = await settle(page);
    const added = after.filter((b) => !before.some((old) => old.id === b.id));

    const addedText = JSON.stringify(added);

    for (const title of ['Alpha', 'Bravo', 'Charlie']) {
      expect.soft(addedText, `row title ${title} survives`).toContain(title);
    }
    expect.soft(after.filter((b) => b.type === 'database-row' && b.parent === undefined).map((b) => b.id), 'no orphan rows').toEqual([]);
  });

  test('db-degraded-plain: copy a database, paste only text/plain', async ({ page }) => {
    await mount(page, docBlocks(dbBlocks()));
    await expect(page.getByRole('grid')).toBeVisible();
    const before = await settle(page);

    await selectFromAbove(page);
    expect(await selectedIds(page)).toEqual(['db-1']);
    const formats = await fireClipboard(page, 'copy');

    await pasteAtBlock(page, 'target', pick(formats, ['text/plain']));
    const after = await settle(page);
    const added = after.filter((b) => !before.some((old) => old.id === b.id));

    const addedText = JSON.stringify(added);

    for (const title of ['Alpha', 'Bravo', 'Charlie']) {
      expect.soft(addedText, `row title ${title} survives`).toContain(title);
    }
  });
});
