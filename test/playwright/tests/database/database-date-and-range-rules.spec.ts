/**
 * research/30 B2, B6, B12: End date on an empty cell, the Relative date
 * format's words, and where "Out of range" sits under a descending sort.
 * Checks the saved JSON where a value is written.
 */

import type { Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const dateBlocks = (date: Record<string, unknown>, due: Array<string | null>): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-due', name: 'Due', type: 'date', position: 'a1', date },
      ],
      views: [{ id: 'v1', name: 'table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: ['p-due'] }],
      activeViewId: 'v1',
    },
    content: due.map((_, i) => `r${i}`),
  },
  ...due.map((value, i) => ({ id: `r${i}`, type: 'database-row', parent: 'db-1', data: { position: `a${i}`, properties: { 'p-title': `Row ${i}`, 'p-due': value } } })),
];

const mount = async (page: Page, input: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: data },
      tools: { database: { class: (window as unknown as Record<string, unknown>).BlokDatabase } },
    });
    await window.blokInstance.isReady;
  }, input);
};

const savedDue = async (page: Page, id: string): Promise<unknown> => page.evaluate(async (rowId) => {
  const saved = await window.blokInstance?.save();
  const row = saved?.blocks.find((block) => block.id === rowId)?.data as { properties: Record<string, unknown> } | undefined;

  return row?.properties['p-due'];
}, id);

const dueCell = (page: Page, title: string) => page.getByRole('row', { name: new RegExp(title) }).getByRole('gridcell').nth(1);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  // Wednesday, Oct 21, 2026, as in research/30.
  await page.clock.setFixedTime(new Date(2026, 9, 21, 1, 0, 7));
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('Relative: the cell reads the week words, the picker field the full date', async ({ page }) => {
  await mount(page, dateBlocks({ dateFormat: 'relative', timeFormat: '12_hour' }, ['2026-10-26T02:00', '2026-10-18T02:00', '2026-10-23T02:00', '2026-10-11T02:00', '2026-10-22T02:00']));

  await expect(dueCell(page, 'Row 0')).toHaveText('Next Monday 2:00 AM');
  await expect(dueCell(page, 'Row 1')).toHaveText('Last Sunday 2:00 AM');
  await expect(dueCell(page, 'Row 2')).toHaveText('Friday 2:00 AM');
  await expect(dueCell(page, 'Row 3')).toHaveText('October 11, 2026 2:00 AM');
  await expect(dueCell(page, 'Row 4')).toHaveText('Tomorrow 2:00 AM');

  await dueCell(page, 'Row 4').click();
  await expect(page.getByRole('textbox', { name: 'Start date' })).toHaveValue('Oct 22, 2026');
});

test('End date on an empty cell writes today to today at once', async ({ page }) => {
  await mount(page, dateBlocks({}, [null]));

  await dueCell(page, 'Row 0').click();
  await page.getByRole('switch', { name: 'End date' }).click();

  await expect.poll(() => savedDue(page, 'r0')).toBe('2026-10-21/2026-10-21');
  await expect(page.getByRole('textbox', { name: 'Start date' })).toHaveValue('Oct 21, 2026');
  await expect(page.getByRole('textbox', { name: 'End date' })).toHaveValue('Oct 21, 2026');
  await page.keyboard.press('Escape');
  await expect(dueCell(page, 'Row 0')).toHaveText('October 21, 2026 → October 21, 2026');
});

test('a descending range grouping keeps Out of range after the ranges', async ({ page }) => {
  const rows = [['r1', 'Alpha', 1], ['r2', 'Bravo', 2], ['r3', 'Charlie', 3]] as const;

  await mount(page, [
    {
      id: 'db-1',
      type: 'database',
      data: {
        schema: [
          { id: 'p-name', name: 'Name', type: 'title', position: 'a0' },
          { id: 'p-score', name: 'Score', type: 'number', position: 'a1' },
        ],
        views: [{
          id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-score', sorts: [], filters: [], visibleProperties: [],
          groupSettings: { numberBy: 'range', rangeStart: 0, rangeEnd: 2, rangeSize: 1, sort: 'descending', hideEmptyGroups: true },
        }],
        activeViewId: 'v1',
      },
      content: rows.map(([id]) => id),
    },
    ...rows.map(([id, name, score], i) => ({ id, type: 'database-row', parent: 'db-1', data: { position: `a${i}`, properties: { 'p-name': name, 'p-score': score } } })),
  ]);

  await expect.poll(() => page.locator('[data-blok-database-column]').evaluateAll((columns) => columns.map((c) => c.getAttribute('data-option-id'))))
    .toEqual(['range:2', 'range:1', 'range:out']);
});
