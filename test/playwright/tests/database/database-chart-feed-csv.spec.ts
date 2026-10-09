/**
 * The Notion chart and feed layouts (research/03 §8, §9) and CSV export,
 * import and merge (research/05 §9.3). Each write is checked in the saved
 * JSON; chart pixels are unmeasured, so this checks behaviour, not looks.
 */

import { readFileSync } from 'node:fs';

import type { Download, Locator, Page } from '@playwright/test';

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
  { id: 'p-title', name: 'Task', type: 'title', position: 'a0' },
  {
    id: 'p-status',
    name: 'Status',
    type: 'select',
    position: 'a1',
    config: { options: [{ id: 'o-todo', label: 'Todo', position: 'a0' }, { id: 'o-done', label: 'Done', position: 'a1' }] },
  },
  { id: 'p-points', name: 'Points', type: 'number', position: 'a2' },
  { id: 'p-owner', name: 'Owner', type: 'select', position: 'a3', config: { options: [{ id: 'o-ann', label: 'Ann', position: 'a0' }, { id: 'o-bo', label: 'Bo', position: 'a1' }] } },
];

const ROWS = [
  { id: 'r1', properties: { 'p-title': 'Write, edit', 'p-status': 'o-todo', 'p-points': 3, 'p-owner': 'o-ann' } },
  { id: 'r2', properties: { 'p-title': 'Ship', 'p-status': 'o-done', 'p-points': 5, 'p-owner': 'o-bo' } },
  { id: 'r3', properties: { 'p-title': 'Rest', 'p-status': 'o-done', 'p-points': 1, 'p-owner': 'o-ann' } },
];

const blocks = (view: Record<string, unknown>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row, i) => ({
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
};

interface SavedBlock {
  id?: string;
  type: string;
  data: Record<string, unknown>;
  parent?: string;
}

const saved = async (page: Page): Promise<SavedBlock[]> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();

  return (output?.blocks ?? []).map((block) => ({ id: block.id, type: block.type, data: block.data, parent: block.parent }));
});

const savedView = async (page: Page): Promise<Record<string, unknown>> => {
  const database = (await saved(page)).find((block) => block.id === 'db-1');
  const views = database?.data.views as Array<Record<string, unknown>> | undefined;

  return views?.[0] ?? {};
};

const mark = (page: Page, key: string): Locator => page.locator(`[data-blok-database-chart-mark][data-key="${key}"]`).first();
const hit = (page: Page, key: string): Locator => page.locator(`[data-blok-database-chart-hit][data-key="${key}"]`).first();
const byTestId = (page: Page, id: string): Locator => page.getByTestId(id);

const downloaded = async (file: Download): Promise<string> => readFileSync(await file.path(), 'utf8');

const openSettingsAction = async (page: Page, testId: string): Promise<void> => {
  await byTestId(page, 'database-toolbar-settings').click();
  await byTestId(page, testId).click();
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('chart view', () => {
  test('draws a column per status group and shows the value on hover', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status', groupSettings: { hideEmptyGroups: true } }));

    await expect(page.locator('[data-blok-database-chart-mark]')).toHaveCount(2);
    await expect(page.getByRole('img', { name: /Status/ })).toBeVisible();

    await hit(page, 'o-done').hover();
    const tooltip = page.getByRole('tooltip');

    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText('Done');
    await expect(tooltip).toContainText('2');
  });

  test('drills down into a group and opens a row from it', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status', groupSettings: { hideEmptyGroups: true } }));

    await hit(page, 'o-done').click();
    const dialog = page.getByRole('dialog');

    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ship' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Rest' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Write, edit' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Ship' }).click();
    await expect(page.locator('[data-blok-database-drilldown]')).toHaveCount(0);
    await expect(page.locator('[data-blok-database-drawer], [data-blok-database-peek]').first()).toBeVisible();
  });

  test('a legend click hides a series for this session and writes nothing', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status', subGroupBy: 'p-owner', groupSettings: { hideEmptyGroups: true } }));
    const before = await savedView(page);
    const ann = page.locator('[data-blok-database-chart-legend-entry][data-key="o-ann"]');

    await expect(page.locator('[data-blok-database-chart-mark][data-series="o-ann"]')).toHaveCount(2);
    await ann.click();

    await expect(ann).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('[data-blok-database-chart-mark][data-series="o-ann"]')).toHaveCount(0);
    expect(await savedView(page)).toEqual(before);
  });

  test('switches to a donut from the Layout page and saves it', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status' }));

    await byTestId(page, 'database-toolbar-settings').click();
    await byTestId(page, 'database-settings-layout').click();
    await byTestId(page, 'database-chart-type').click();
    await byTestId(page, 'database-chart-type-donut').click();

    await expect(page.locator('[data-blok-database-chart]')).toHaveAttribute('data-chart-type', 'donut');
    await expect(page.locator('[data-blok-database-chart-center]')).toHaveText('3');
    expect((await savedView(page)).chartType).toBe('donut');
  });

  test('sums a property for the Y axis', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', chartType: 'number', groupBy: 'p-status', chartMeasure: 'sum:p-points' }));

    await expect(page.locator('[data-blok-database-chart-number]')).toHaveText('9');
  });

  test('saves the chart as an SVG with its colors resolved', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status' }));
    const download = page.waitForEvent('download');

    await openSettingsAction(page, 'database-settings-chart-svg');
    const file = await download;
    const text = await downloaded(file);

    expect(file.suggestedFilename()).toBe('Tasks.svg');
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(text).not.toContain('var(--');
  });

  test('still draws and drills down when read-only', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status', groupSettings: { hideEmptyGroups: true } }), true);

    await expect(mark(page, 'o-todo')).toBeVisible();
    await hit(page, 'o-todo').click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Write, edit' })).toBeVisible();
  });
});

test.describe('feed view', () => {
  test('stacks a card per row and opens the row from its title', async ({ page }) => {
    await mount(page, blocks({ type: 'feed', properties: [{ id: 'p-title', visible: true }, { id: 'p-points', visible: true }] }));
    const cards = page.locator('[data-blok-database-feed-card]');

    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('3');
    await cards.first().getByRole('button', { name: 'Write, edit' }).click();
    await expect(page.locator('[data-blok-database-drawer], [data-blok-database-peek]').first()).toBeVisible();
  });
});

test.describe('CSV', () => {
  test('exports the current view with its filter, sort and visible properties', async ({ page }) => {
    await mount(page, blocks({
      type: 'table',
      filters: [{ id: 'f1', propertyId: 'p-points', operator: 'greater_than', value: 2 }],
      sorts: [{ id: 's1', propertyId: 'p-points', direction: 'desc' }],
      properties: [{ id: 'p-title', visible: true }, { id: 'p-status', visible: true }, { id: 'p-points', visible: true }, { id: 'p-owner', visible: false }],
    }));
    const download = page.waitForEvent('download');

    await openSettingsAction(page, 'database-settings-csv-export');
    const file = await download;
    const text = await downloaded(file);

    expect(file.suggestedFilename()).toBe('Tasks.csv');
    expect(text).toBe('﻿Task,Status,Points\r\nShip,Done,5\r\n"Write, edit",Todo,3');
  });

  test('imports a CSV as a new database after this one', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }));
    const chooser = page.waitForEvent('filechooser');

    await openSettingsAction(page, 'database-settings-csv-import');
    await (await chooser).setFiles({ name: 'plan.csv', mimeType: 'text/csv', buffer: Buffer.from('Step,Hours,Due\nDraft,2,10/09/2026\nReview,1.5,2026-10-12\n') });

    await expect(page.locator('[data-blok-tool="database"]')).toHaveCount(2);
    await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database').length).toBe(2);
    const all = await saved(page);
    const imported = all.find((block) => block.type === 'database' && block.id !== 'db-1');
    const schema = imported?.data.schema as Array<{ name: string; type: string }>;
    const rows = all.filter((block) => block.type === 'database-row' && block.parent === imported?.id);

    expect(imported?.data.title).toBe('plan');
    expect(schema.map((p) => [p.name, p.type])).toEqual([['Step', 'title'], ['Hours', 'number'], ['Due', 'date']]);
    expect(rows.map((row) => Object.values(row.data.properties as Record<string, unknown>))).toEqual([
      ['Draft', 2, '2026-10-09'],
      ['Review', 1.5, '2026-10-12'],
    ]);
  });

  test('merges a CSV by adding rows only', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }));
    const chooser = page.waitForEvent('filechooser');

    await openSettingsAction(page, 'database-settings-csv-merge');
    await (await chooser).setFiles({ name: 'more.csv', mimeType: 'text/csv', buffer: Buffer.from('Task,Points\nShip,8\nPlan,2\n') });

    await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database-row').length).toBe(5);
    const rows = (await saved(page)).filter((block) => block.type === 'database-row').map((row) => row.data.properties as Record<string, unknown>);

    expect(rows.filter((p) => p['p-title'] === 'Ship').map((p) => p['p-points'])).toEqual([5, 8]);
    expect(rows.find((p) => p['p-title'] === 'Plan')?.['p-points']).toBe(2);
  });

  // Unverified in Notion (research/05 U4): Blok offers the conversion after a plain-text table paste.
  test('turns a pasted TSV table into a database on request, keeping markup as text', async ({ page }) => {
    await mount(page, [{ id: 'p1', type: 'paragraph', data: { text: '' } }]);
    const paragraph = page.locator('[data-blok-tool="paragraph"] [contenteditable="true"]').first();

    await paragraph.click();
    await paragraph.evaluate((element: HTMLElement, text: string) => {
      const event = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: { getData: (type: string): string => (type === 'text/plain' ? text : ''), types: ['text/plain'] },
      });

      element.dispatchEvent(event);
    }, 'Task\tNote\nShip\t<b>bold</b> & co\nRest\tx');

    await page.getByRole('button', { name: 'Convert to database' }).click();

    await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database').length).toBe(1);
    const all = await saved(page);
    const database = all.find((block) => block.type === 'database');
    const schema = database?.data.schema as Array<{ id: string; name: string; type: string }>;
    const note = schema.find((p) => p.name === 'Note')?.id ?? '';
    const rows = all.filter((block) => block.type === 'database-row' && block.parent === database?.id);

    expect(schema.map((p) => [p.name, p.type])).toEqual([['Task', 'title'], ['Note', 'text']]);
    expect(rows.map((row) => (row.data.properties as Record<string, unknown>)[note])).toEqual(['<b>bold</b> & co', 'x']);
    expect(all.filter((block) => block.type === 'paragraph' && JSON.stringify(block.data).includes('Ship'))).toHaveLength(0);
  });
});
