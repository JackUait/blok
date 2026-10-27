/**
 * The Notion chart and feed layouts (research/03 §8, §9) and CSV export,
 * import and merge (research/05 §9.3). Each write is checked in the saved
 * JSON; chart pixels are unmeasured, so this checks behaviour, not looks.
 */

import { readFileSync } from 'node:fs';

import type { Download, Locator, Page } from '@playwright/test';

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

const blocks = (view: Record<string, unknown>, rows: Array<{ id: string; properties: Record<string, unknown> }> = ROWS): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'View', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
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

/** CSV actions sit under More settings (feel/findings-toolbar V12). */
const openSettingsAction = async (page: Page, testId: string): Promise<void> => {
  await byTestId(page, 'database-toolbar-settings').click();
  await byTestId(page, 'database-settings-more').click();
  await byTestId(page, testId).click();
};

const openSaveChartAs = async (page: Page): Promise<void> => {
  await byTestId(page, 'database-toolbar-settings').click();
  await page.getByRole('button', { name: 'Save chart as…' }).click();
};

/** RGBA of the image's top-left pixel, decoded by the browser. */
const cornerPixel = async (page: Page, png: Buffer): Promise<number[]> => page.evaluate(async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');

  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d');

  context?.drawImage(bitmap, 0, 0);

  return [...(context?.getImageData(1, 1, 1, 1).data ?? [])];
}, png.toString('base64'));

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 1000 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('chart view', () => {
  test('rescales signed axes when a legend series is hidden', async ({ page }) => {
    await mount(page, blocks({
      type: 'chart', groupBy: 'p-status', subGroupBy: 'p-owner', chartMeasure: 'sum:p-points',
      groupSettings: { hideEmptyGroups: true },
    }, [
      { id: 'sale', properties: { 'p-title': 'Sale', 'p-status': 'o-todo', 'p-points': 60, 'p-owner': 'o-ann' } },
      { id: 'refund', properties: { 'p-title': 'Refund', 'p-status': 'o-todo', 'p-points': -40, 'p-owner': 'o-bo' } },
    ]));
    const ticks = (): Promise<number[]> => page.locator('[data-blok-database-chart-tick]').evaluateAll((els) => els.map((el) => Number(el.textContent)));
    const ann = page.locator('[data-blok-database-chart-legend-entry][data-key="o-ann"]');
    const bo = page.locator('[data-blok-database-chart-legend-entry][data-key="o-bo"]');

    await expect.poll(async () => Math.min(...await ticks())).toBeLessThanOrEqual(-40);
    await expect.poll(async () => Math.max(...await ticks())).toBeGreaterThanOrEqual(60);
    await ann.click();

    await expect.poll(async () => Math.max(...await ticks())).toBe(0);
    await expect.poll(async () => Math.min(...await ticks())).toBeLessThanOrEqual(-40);
    await expect(page.locator('[data-blok-database-chart-mark][data-series="o-bo"]')).toHaveCount(1);
    await ann.click();
    await bo.click();

    await expect.poll(async () => Math.min(...await ticks())).toBe(0);
    await expect.poll(async () => Math.max(...await ticks())).toBeGreaterThanOrEqual(60);
  });

  for (const chartType of ['column', 'bar'] as const) {
    for (const grouped of [false, true]) {
      test(`a ${chartType} chart draws refunds opposite sales with grouping ${grouped}`, async ({ page }) => {
        await mount(page, blocks({
          type: 'chart', chartType, chartMeasure: 'sum:p-points', groupBy: 'p-status',
          ...(grouped ? { subGroupBy: 'p-owner' } : {}),
          groupSettings: { hideEmptyGroups: true },
        }, [
          { id: 'sale', properties: { 'p-title': 'Sale', 'p-status': 'o-todo', 'p-points': 60, 'p-owner': 'o-ann' } },
          { id: 'refund', properties: { 'p-title': 'Refund', 'p-status': grouped ? 'o-todo' : 'o-done', 'p-points': -40, 'p-owner': 'o-bo' } },
        ]));
        const positive = page.locator(grouped
          ? '[data-blok-database-chart-mark][data-series="o-ann"]'
          : '[data-blok-database-chart-mark][data-key="o-todo"]');
        const negative = page.locator(grouped
          ? '[data-blok-database-chart-mark][data-series="o-bo"]'
          : '[data-blok-database-chart-mark][data-key="o-done"]');

        await expect(negative).toBeVisible();
        const bounds = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => locator.evaluate((el) => {
          if (!(el instanceof SVGGraphicsElement)) throw new Error('not a chart mark');
          const box = el.getBBox();

          return { x: box.x, y: box.y, width: box.width, height: box.height };
        });
        const sale = await bounds(positive);
        const refund = await bounds(negative);
        const baseline = Number(await page.locator('[data-blok-database-chart-axis]').getAttribute(chartType === 'bar' ? 'x1' : 'y1'));

        // Value-axis extent where larger means more positive. SVG y grows down, so columns are negated.
        const extent = (box: { x: number; y: number; width: number; height: number }): { low: number; high: number } => chartType === 'bar'
          ? { low: box.x, high: box.x + box.width }
          : { low: -(box.y + box.height), high: -box.y };
        const base = chartType === 'bar' ? baseline : -baseline;
        const saleExtent = extent(sale);
        const refundExtent = extent(refund);

        expect(refundExtent.high).toBeLessThanOrEqual(base + 0.5);
        expect(refundExtent.low).toBeLessThan(base);
        expect(saleExtent.low).toBeGreaterThanOrEqual(base - 0.5);
        expect(saleExtent.high).toBeGreaterThan(saleExtent.low);
      });
    }
  }

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

    await openSaveChartAs(page);
    await page.getByRole('button', { name: 'Download SVG' }).click();
    const file = await download;
    const text = await downloaded(file);

    expect(file.suggestedFilename()).toBe('Tasks.svg');
    expect(text).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(text).not.toContain('var(--');
  });

  test('downloads a PNG painted on the page surface', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status' }));
    const download = page.waitForEvent('download');

    await openSaveChartAs(page);
    await page.getByRole('button', { name: 'Download PNG' }).click();
    const file = await download;
    const bytes = readFileSync(await file.path());

    expect(file.suggestedFilename()).toBe('Tasks.png');
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('\x89PNG');
    expect(await cornerPixel(page, bytes)).toEqual([255, 255, 255, 255]);
  });

  test('downloads a PNG on the dark surface in the dark theme', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status' }));
    await page.evaluate(() => window.blokInstance?.theme.set('dark'));
    const download = page.waitForEvent('download');

    await openSaveChartAs(page);
    await page.getByRole('button', { name: 'Download PNG' }).click();

    expect(await cornerPixel(page, readFileSync(await (await download).path()))).toEqual([25, 25, 25, 255]);
  });

  test('downloads a transparent PNG with the background switched off, and the switch resets', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status' }));
    const download = page.waitForEvent('download');

    await openSaveChartAs(page);
    await page.getByRole('switch', { name: 'Background' }).click();
    await page.getByRole('button', { name: 'Download PNG' }).click();

    expect((await cornerPixel(page, readFileSync(await (await download).path())))[3]).toBe(0);
    await openSaveChartAs(page);
    await expect(page.getByRole('switch', { name: 'Background' })).toHaveAttribute('aria-checked', 'true');
  });

  test('copies the chart to the clipboard as a PNG', async ({ page }) => {
    const context = page.context();

    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
    try {
      await mount(page, blocks({ type: 'chart', groupBy: 'p-status' }));
      await openSaveChartAs(page);
      await page.getByRole('button', { name: 'Copy as PNG' }).click();

      await expect(page.getByText('Chart copied to clipboard')).toBeVisible();
      const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => [...item.types]));

      expect(types).toContain('image/png');
    } finally {
      await context.clearPermissions();
    }
  });

  test('says so when the browser cannot copy an image', async ({ page }) => {
    await mount(page, blocks({ type: 'chart', groupBy: 'p-status' }));
    await page.evaluate(() => {
      Reflect.set(window, '__clipboardItem', Reflect.get(window, 'ClipboardItem'));
      Reflect.deleteProperty(window, 'ClipboardItem');
    });
    try {
      await openSaveChartAs(page);
      await page.getByRole('button', { name: 'Copy as PNG' }).click();

      await expect(page.getByText('Couldn’t copy the chart. Download the PNG instead.')).toBeVisible();
    } finally {
      await page.evaluate(() => Reflect.set(window, 'ClipboardItem', Reflect.get(window, '__clipboardItem')));
    }
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
    await openSettingsAction(page, 'database-settings-csv-import');
    const dialog = page.getByRole('dialog');
    const chooser = page.waitForEvent('filechooser');

    await dialog.getByTestId('database-csv-choose-file').click();
    await (await chooser).setFiles({ name: 'plan.csv', mimeType: 'text/csv', buffer: Buffer.from('Step,Hours,Due\nDraft,2,10/09/2026\nReview,1.5,2026-10-12\n') });
    await dialog.getByTestId('database-csv-map').click();
    await dialog.getByTestId('database-csv-import').click();

    await expect(page.locator('[data-blok-tool="database"]')).toHaveCount(2);
    await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database').length).toBe(2);
    const all = await saved(page);
    const imported = all.find((block) => block.type === 'database' && block.id !== 'db-1');
    const schema = imported?.data.schema as Array<{ name: string; type: string }>;
    const rows = all.filter((block) => block.type === 'database-row' && block.parent === imported?.id);

    // research/27 §2: the title stays the placeholder, not the file name.
    expect(imported?.data.title ?? '').toBe('');
    expect(schema.map((p) => [p.name, p.type])).toEqual([['Step', 'title'], ['Hours', 'number'], ['Due', 'date']]);
    expect(rows.map((row) => Object.values(row.data.properties as Record<string, unknown>))).toEqual([
      ['Draft', 2, '2026-10-09'],
      ['Review', 1.5, '2026-10-12'],
    ]);
  });

  // research/27 §2: Notion's "Setup CSV columns" step, with the file it was measured with.
  test('maps each CSV column to a type in the import dialog, keeping file order', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }));
    await openSettingsAction(page, 'database-settings-csv-import');
    const dialog = page.getByRole('dialog');
    const map = dialog.getByTestId('database-csv-map');

    await expect(map).toHaveAttribute('aria-disabled', 'true');
    await dialog.locator('[data-blok-database-csv-input]').setInputFiles({
      name: 'blok-r27.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from([
        'Name,Due,Amount,Site,Email,Done,Stage',
        'Alpha,2026-03-04,12,https://example.com,a@example.com,Yes,Todo',
        'Bravo,2026-03-05,7.5,https://example.org,b@example.com,No,Doing',
        'Charlie,2026-03-06,100,https://example.net,c@example.com,Yes,Todo',
      ].join('\n')),
    });
    await expect(map).toHaveAttribute('aria-disabled', 'false');
    await map.click();

    const types = dialog.getByTestId('database-csv-type');

    await expect(types).toHaveText(['Name', 'Date • Full date', 'Number', 'URL', 'Email', 'Checkbox', 'Text']);
    await types.nth(6).click();
    await page.locator('[data-blok-item-name="database-csv-type-new"]').click();
    await page.locator('[data-blok-item-name="database-csv-type-new-select"]').click();
    await expect(types.nth(6)).toHaveText('Select');
    // The closed menu fades out first; wait so only the next one matches.
    await expect(page.locator('[data-blok-item-name="database-csv-type-skip"]')).toHaveCount(0);
    await types.nth(3).click();
    await page.locator('[data-blok-item-name="database-csv-type-skip"]').click();
    await dialog.getByTestId('database-csv-import').click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database').length).toBe(2);
    const all = await saved(page);
    const imported = all.find((block) => block.type === 'database' && block.id !== 'db-1');
    const schema = imported?.data.schema as Array<{ id: string; name: string; type: string; config?: { options: Array<{ label: string }> } }>;
    const rows = all.filter((block) => block.type === 'database-row' && block.parent === imported?.id);
    const title = schema.find((p) => p.type === 'title');

    expect(schema.map((p) => [p.name, p.type])).toEqual([
      ['Name', 'title'], ['Due', 'date'], ['Amount', 'number'], ['Email', 'email'], ['Done', 'checkbox'], ['Stage', 'select'],
    ]);
    expect(schema.find((p) => p.name === 'Stage')?.config?.options.map((o) => o.label)).toEqual(['Todo', 'Doing']);
    // Blok keeps file order; Notion reversed the rows (research/21 §4, research/27 §2).
    expect(rows.map((row) => (row.data.properties as Record<string, unknown>)[title?.id ?? ''])).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  test('one Escape on the mapping step closes the whole import', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }));
    await openSettingsAction(page, 'database-settings-csv-import');
    const dialog = page.getByRole('dialog');

    await dialog.locator('[data-blok-database-csv-input]').setInputFiles({ name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,N\na,1\n') });
    await dialog.getByTestId('database-csv-map').click();
    await expect(dialog.getByTestId('database-csv-setup')).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-blok-tool="database"]')).toHaveCount(1);
  });

  test('merges a CSV by adding rows only', async ({ page }) => {
    await mount(page, blocks({ type: 'table' }));
    await openSettingsAction(page, 'database-settings-csv-merge');
    const dialog = page.getByRole('dialog');

    await dialog.locator('[data-blok-database-csv-input]').setInputFiles({ name: 'more.csv', mimeType: 'text/csv', buffer: Buffer.from('Task,Points\nShip,8\nPlan,2\n') });
    await dialog.getByTestId('database-csv-map').click();
    await dialog.getByTestId('database-csv-import').click();

    await expect.poll(async () => (await saved(page)).filter((block) => block.type === 'database-row').length).toBe(5);
    const rows = (await saved(page)).filter((block) => block.type === 'database-row').map((row) => row.data.properties as Record<string, unknown>);

    expect(rows.filter((p) => p['p-title'] === 'Ship').map((p) => p['p-points'])).toEqual([5, 8]);
    expect(rows.find((p) => p['p-title'] === 'Plan')?.['p-points']).toBe(2);
  });

  // Unverified in Notion (research/05 U4): Blok offers the conversion after a plain-text table paste.
  test('turns a pasted TSV table into a database on request, keeping markup as text', async ({ page }) => {
    await mount(page, [{ id: 'p1', type: 'paragraph', data: { text: '' } }]);
    const paragraph = page.locator('[data-blok-testid="block-wrapper"] [contenteditable]').first();

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
