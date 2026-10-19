/**
 * A filled AI Autofill cell's hover buttons, against Notion (research/12 §2):
 * Autofill, Comment, Copy to Clipboard, left to right, each 24x20.
 */

import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputBlockData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
    autofillLog?: { comments: unknown[]; copied: string[] };
  }
}

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-summary', name: 'Summary', type: 'text', position: 'a1', autofill: { mode: 'summary' } },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1', 'r2'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-summary': 'The page describes Alpha.' } } },
  { id: 'r2', type: 'database-row', parent: 'db-1', data: { position: 'a1', properties: { 'p-title': 'Beta' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ input }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');
    const log = { comments: [] as unknown[], copied: [] as string[] };

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.autofillLog = log;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (text: string) => { log.copied.push(text);

        return Promise.resolve(); } },
    });
    window.blokInstance = new window.Blok({
      holder,
      data: { blocks: input },
      tools: {
        database: {
          class: window.BlokDatabase,
          config: {
            comments: { open: (target: unknown) => log.comments.push(target) },
            ai: { autofill: () => Promise.resolve('Regenerated') },
          },
        },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });
    await window.blokInstance.isReady;
  }, { input: blocks() });
  await expect(page.getByRole('grid')).toBeVisible();
};

const cell = (page: Page, rowId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"] [role="gridcell"][data-property-id="p-summary"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
});

test('hovering a filled autofill cell shows Autofill, Comment, Copy in one 76x24 pill', async ({ page }) => {
  const filled = cell(page, 'r1');
  const pill = filled.locator('[data-blok-database-table-cell-actions]');

  await expect(pill).toBeHidden();
  await filled.hover();
  await expect(pill).toBeVisible();

  const buttons = pill.getByRole('button');

  await expect(buttons).toHaveCount(3);
  expect(await buttons.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(['Autofill', 'Comment', 'Copy to clipboard']);
  const boxes = await buttons.evaluateAll((els) => els.map((el) => {
    const box = el.getBoundingClientRect();

    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }));

  boxes.forEach((box) => expect([box.width, box.height]).toEqual([24, 20]));
  // One row, left to right, all on the same line.
  expect(boxes[0].x).toBeLessThan(boxes[1].x);
  expect(boxes[1].x).toBeLessThan(boxes[2].x);
  expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
  const pillBox = await pill.boundingBox();

  expect([pillBox?.width, pillBox?.height]).toEqual([76, 24]);
  // The Autofill inside the pill drops its own corner box.
  const run = pill.getByRole('button', { name: 'Autofill' });

  expect(await run.evaluate((el) => [getComputedStyle(el).boxShadow, getComputedStyle(el).backgroundColor]))
    .toEqual(['none', 'rgba(0, 0, 0, 0)']);
});

test('an empty autofill cell shows the lone Autofill button', async ({ page }) => {
  const empty = cell(page, 'r2');

  await empty.hover();
  await expect(empty.getByRole('button', { name: 'Autofill' })).toBeVisible();
  await expect(empty.locator('[data-blok-database-table-cell-actions]')).toHaveCount(0);
});

test('Copy copies the cell text; Comment opens the host comments; neither edits', async ({ page }) => {
  const filled = cell(page, 'r1');

  await filled.hover();
  await filled.getByRole('button', { name: 'Copy to clipboard' }).click();
  await expect.poll(() => page.evaluate(() => window.autofillLog?.copied)).toEqual(['The page describes Alpha.']);
  await filled.hover();
  await filled.getByRole('button', { name: 'Comment' }).click();
  await expect.poll(() => page.evaluate(() => window.autofillLog?.comments.length)).toBe(1);
  await expect(page.locator('[data-blok-database-cell-editor]')).toHaveCount(0);
});

test('Autofill on a filled cell regenerates its value', async ({ page }) => {
  const filled = cell(page, 'r1');

  await filled.hover();
  await filled.getByRole('button', { name: 'Autofill' }).click();
  await expect(filled).toContainText('Regenerated');
});
