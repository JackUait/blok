/**
 * Phase 6 structure, end to end: the button property, templates, sub-items,
 * dependencies on the timeline, and linked views. Notion behaviour:
 * research/05 §7, §8, §10, §11 and research/03 §1.11, §7. Each case checks
 * the saved JSON, not only the DOM.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { expectNoA11yViolations } from '../helpers/a11y';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    buttonCalls?: unknown[];
  }
}

const TITLE = { id: 'p-title', name: 'Name', type: 'title', position: 'a0' };

const view = (id: string, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, name: type, type, position: 'a0', sorts: [], filters: [], visibleProperties: [], ...extra });

const row = (id: string, parent: string, i: number, properties: Record<string, unknown>, extra: Record<string, unknown> = {}): OutputBlockData =>
  ({ id, type: 'database-row', parent, data: { position: `a${i}`, properties, ...extra } });

const mount = async (page: Page, blocks: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async (input) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:1100px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.buttonCalls = [];
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: {
        database: {
          class: (window as unknown as Record<string, unknown>).BlokDatabase,
          config: {
            buttons: { onAction: (call: unknown) => window.buttonCalls?.push(call) },
          },
        },
      },
    });
    await window.blokInstance.isReady;
  }, blocks);
};

const saved = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const savedRow = async (page: Page, id: string): Promise<Record<string, unknown>> =>
  ((await saved(page)).find((block) => block.id === id)?.data ?? {});

const tableRow = (scope: Page | Locator, rowId: string): Locator => scope.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);

const undo = async (page: Page): Promise<void> => {
  await page.evaluate(() => window.blokInstance?.history.undo());
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('button property', () => {
  const blocks = (): OutputBlockData[] => [
    {
      id: 'db-1',
      type: 'database',
      data: {
        schema: [
          TITLE,
          { id: 'p-done', name: 'Done', type: 'checkbox', position: 'a1' },
          {
            id: 'p-act', name: 'Act', type: 'button', position: 'a2',
            button: {
              label: 'Finish',
              buttonActions: [
                { id: 'x1', type: 'editProperty', propertyId: 'p-done', value: true },
                { id: 'x2', type: 'insertBlocks', blocks: [{ id: 'b1', type: 'paragraph', data: { text: 'Closed by button' } }] },
                { id: 'x3', type: 'callback', name: 'notify' },
              ],
            },
          },
        ],
        views: [view('v1', 'table')],
        activeViewId: 'v1',
      },
      content: ['r1'],
    },
    row('r1', 'db-1', 0, { 'p-title': 'Alpha', 'p-done': false }),
  ];

  test('runs its actions in order as one undo step and calls the host', async ({ page }) => {
    await mount(page, blocks());
    const button = tableRow(page, 'r1').getByRole('button', { name: 'Finish' });

    await expect(button).toBeVisible();
    await button.click();

    await expect.poll(async () => (await savedRow(page, 'r1')).properties).toMatchObject({ 'p-done': true });
    const body = (await saved(page)).filter((block) => (block as { parent?: string }).parent === 'r1');

    expect(JSON.stringify(body.map((block) => block.data))).toContain('Closed by button');
    expect(body).toHaveLength(1);
    expect(await page.evaluate(() => window.buttonCalls)).toEqual([expect.objectContaining({ rowId: 'r1', propertyId: 'p-act' })]);

    await undo(page);
    await expect.poll(async () => (await savedRow(page, 'r1')).properties).toMatchObject({ 'p-done': false });
    expect((await saved(page)).filter((block) => (block as { parent?: string }).parent === 'r1')).toEqual([]);
  });
});

test.describe('templates', () => {
  const blocks = (): OutputBlockData[] => [
    {
      id: 'db-1',
      type: 'database',
      data: { schema: [TITLE, { id: 'p-due', name: 'Due', type: 'date', position: 'a1' }], views: [view('v1', 'table', { visibleProperties: ['p-due'] })], activeViewId: 'v1' },
      content: ['r1', 'tpl'],
    },
    row('r1', 'db-1', 0, { 'p-title': 'Alpha' }),
    row('tpl', 'db-1', 1, { 'p-title': 'Bug report', 'p-due': '@today' }, { template: true, icon: '🐞' }),
    { id: 'tpl-body', type: 'paragraph', parent: 'tpl', data: { text: 'Steps to reproduce' } },
  ];

  test('a template stays out of the view; "New" ▾ makes a row from it', async ({ page }) => {
    await mount(page, blocks());
    await expect(page.getByRole('grid')).toBeVisible();
    await expect(tableRow(page, 'tpl')).toHaveCount(0);

    await page.getByTestId('database-toolbar-new-menu').click();
    await page.getByRole('menuitem', { name: 'Bug report' }).click();
    await page.getByRole('menuitem', { name: 'New page' }).click();

    await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database-row').length).toBe(3);
    const made = (await saved(page)).find((block) => block.type === 'database-row' && !['r1', 'tpl'].includes(block.id ?? ''));
    const today = await page.evaluate(() => {
      const d = new Date();

      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    expect(made?.data).toMatchObject({ icon: '🐞', properties: { 'p-title': 'Bug report', 'p-due': today } });
    expect((made?.data as { template?: boolean }).template).toBeUndefined();
    const body = (await saved(page)).filter((block) => (block as { parent?: string }).parent === made?.id);

    expect(body).toHaveLength(1);
    expect(JSON.stringify(body[0]?.data)).toContain('Steps to reproduce');
  });

  test('"+ New template" opens a template page with its banner', async ({ page }) => {
    await mount(page, blocks());
    await page.getByTestId('database-toolbar-new-menu').click();
    await page.getByRole('menuitem', { name: 'New template' }).click();

    await expect(page.locator('[data-blok-database-template-banner]')).toBeVisible();
    await expect.poll(async () => (await saved(page)).filter((block) => (block.data as { template?: boolean }).template === true).length).toBe(2);
  });
});

test.describe('sub-items', () => {
  const blocks = (): OutputBlockData[] => [
    {
      id: 'db-1',
      type: 'database',
      data: {
        schema: [
          TITLE,
          { id: 'p-parent', name: 'Parent item', type: 'relation', position: 'a1', relation: { targetDatabaseId: 'db-1', limit: 1, twoWay: true, syncedPropertyId: 'p-subs', role: 'parentItem' } },
          { id: 'p-subs', name: 'Sub-items', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-parent', role: 'subItems' } },
        ],
        views: [view('v1', 'table')],
        activeViewId: 'v1',
      },
      content: ['r1', 'r2', 'r3'],
    },
    row('r1', 'db-1', 0, { 'p-title': 'Launch', 'p-subs': [{ id: 'r2' }] }),
    row('r2', 'db-1', 1, { 'p-title': 'Write copy', 'p-parent': [{ id: 'r1' }] }),
    row('r3', 'db-1', 2, { 'p-title': 'Alone' }),
  ];

  test('parents show nested in a toggle; the toggle adds a sub-item; deleting a parent deletes it', async ({ page }) => {
    await mount(page, blocks());
    await expect(tableRow(page, 'r1')).toBeVisible();
    await expect(tableRow(page, 'r2')).toHaveCount(0);

    await tableRow(page, 'r1').locator('[data-blok-database-subitem-toggle]').click();
    await expect(tableRow(page, 'r2')).toHaveAttribute('data-subitem-depth', '1');
    // Scoped to what sub-items add: the table around them has its own findings.
    await expectNoA11yViolations(page, { include: ['[data-blok-database-add-subitem]', '[data-blok-database-subitem-toggle]'], label: 'an open sub-item toggle' });

    await page.locator('[data-blok-database-add-subitem][data-parent-id="r1"] button').click();
    await expect.poll(async () => (await savedRow(page, 'r1')).properties).toMatchObject({ 'p-subs': [{ id: 'r2' }, expect.objectContaining({ id: expect.any(String) })] });
    const made = ((await savedRow(page, 'r1')).properties as { 'p-subs': Array<{ id: string }> })['p-subs'][1].id;
    const child = (await saved(page)).find((block) => block.id === made);

    expect(child?.type).toBe('database-row');
    expect(child?.data).toMatchObject({ properties: { 'p-parent': [{ id: 'r1' }] } });

    await tableRow(page, 'r1').hover();
    await tableRow(page, 'r1').locator('[data-blok-database-table-row-checkbox]').click();
    await page.getByRole('toolbar').locator('[data-blok-database-table-selection-delete]').click();
    await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database-row').map((block) => block.id)).toEqual(['r3']);
  });
});

test.describe('dependencies', () => {
  const blocks = (): OutputBlockData[] => [
    {
      id: 'db-1',
      type: 'database',
      data: {
        schema: [
          TITLE,
          { id: 'p-when', name: 'When', type: 'date', position: 'a1' },
          { id: 'p-blocked', name: 'Blocked by', type: 'relation', position: 'a2', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-blocking', role: 'blockedBy' }, dependency: { shift: 'maintain' } },
          { id: 'p-blocking', name: 'Blocking', type: 'relation', position: 'a3', relation: { targetDatabaseId: 'db-1', twoWay: true, syncedPropertyId: 'p-blocked', role: 'blocking' } },
        ],
        views: [view('v1', 'timeline', { timelineBy: 'p-when', timelineZoom: 'week' })],
        activeViewId: 'v1',
      },
      content: ['a', 'b', 'c'],
    },
    row('a', 'db-1', 0, { 'p-title': 'Design', 'p-when': '2026-10-05/2026-10-07', 'p-blocking': [{ id: 'b' }] }),
    row('b', 'db-1', 1, { 'p-title': 'Build', 'p-when': '2026-10-08/2026-10-09', 'p-blocked': [{ id: 'a' }] }),
    row('c', 'db-1', 2, { 'p-title': 'Ship', 'p-when': '2026-10-12/2026-10-13' }),
  ];

  const bar = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-timeline-bar][data-row-id="${rowId}"]`);

  test('draws an arrow per link; a drag from a bar\'s handle onto another bar links them', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-09T12:00:00'));
    await mount(page, blocks());
    await expect(page.locator('[data-blok-database-timeline-arrow][data-from="a"][data-to="b"]')).toHaveCount(1);

    await bar(page, 'b').hover();
    const handle = bar(page, 'b').locator('[data-blok-database-timeline-link-handle]');
    const from = await handle.boundingBox();
    const to = await bar(page, 'c').boundingBox();

    if (from === null || to === null) throw new Error('no layout');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // The bar's start: its far end can sit past the scroller's edge.
    await page.mouse.move(to.x + 16, to.y + to.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await savedRow(page, 'c')).properties).toMatchObject({ 'p-blocked': [{ id: 'b' }] });
    await expect(page.locator('[data-blok-database-timeline-arrow][data-from="b"][data-to="c"]')).toHaveCount(1);
  });
});

test.describe('linked view', () => {
  const blocks = (): OutputBlockData[] => [
    {
      id: 'db-1',
      type: 'database',
      data: { title: 'Tasks', schema: [TITLE, { id: 'p-status', name: 'Status', type: 'text', position: 'a1' }], views: [view('v1', 'table', { visibleProperties: ['p-status'] })], activeViewId: 'v1' },
      content: ['r1'],
    },
    row('r1', 'db-1', 0, { 'p-title': 'Alpha', 'p-status': 'open' }),
    {
      id: 'linked-1',
      type: 'database',
      data: { source: { databaseId: 'db-1' }, schema: [{ id: 'stub', name: 'Name', type: 'title', position: 'a0' }], views: [view('lv', 'table', { visibleProperties: ['p-status'] })], activeViewId: 'lv' },
    },
  ];

  const linked = (page: Page): Locator => page.locator('[data-blok-database-table]').nth(1);

  test('shows the source rows, writes edits to the source, and shows "source deleted" when it goes', async ({ page }) => {
    await mount(page, blocks());
    await expect(tableRow(linked(page), 'r1')).toBeVisible();

    await page.evaluate(() => {
      const index = window.blokInstance?.blocks.getBlockIndex('db-1');

      if (index !== undefined) void window.blokInstance?.blocks.delete(index);
    });

    await expect(page.locator('[data-blok-database-source-missing]')).toBeVisible();
    const kept = (await saved(page)).find((block) => block.id === 'linked-1');

    expect(kept?.data).toMatchObject({ source: { databaseId: 'db-1' } });
  });

  test('a cell edit in the linked view lands on the source row', async ({ page }) => {
    await mount(page, blocks());
    const cell = tableRow(linked(page), 'r1').locator('[data-blok-database-table-cell][data-property-id="p-status"]');

    await cell.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('done');
    await page.keyboard.press('Enter');

    await expect.poll(async () => (await savedRow(page, 'r1')).properties).toMatchObject({ 'p-status': 'done' });
    await expect(tableRow(page.locator('[data-blok-database-table]').first(), 'r1').locator('[data-property-id="p-status"]')).toHaveText('done');
  });
});
