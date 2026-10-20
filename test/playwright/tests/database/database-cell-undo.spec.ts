/**
 * Each table cell commit is its own undo step: two commits, two undos,
 * both values back (Notion does the same).
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

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
        { id: 'p-score', name: 'Score', type: 'number', position: 'a2' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-notes': 'old', 'p-score': 1 } } },
];

const savedRow = async (page: Page): Promise<Record<string, unknown>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const row = output?.blocks.find((block) => block.id === 'r1');

  return (row?.data as { properties: Record<string, unknown> } | undefined)?.properties ?? {};
});

const cell = (page: Page, propertyId: string): Locator =>
  page.locator(`[data-blok-database-table-row][data-row-id="r1"] [role="gridcell"][data-property-id="${propertyId}"]`);
const editor = (page: Page): Locator => page.locator('[data-blok-database-cell-editor]');

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(async (data) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: data } });
    await window.blokInstance.isReady;
  }, BLOCKS);
  await expect(page.getByRole('grid').first()).toBeVisible();
});

test('two cell commits are two undo steps, even when Mod+Z is pressed back to back', async ({ page }) => {
  await cell(page, 'p-notes').click();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('new');
  await page.keyboard.press('Enter');
  await expect(editor(page)).toHaveCount(0);

  await cell(page, 'p-score').click();
  await expect(editor(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('9');
  await page.keyboard.press('Enter');
  await expect(editor(page)).toHaveCount(0);

  expect(await savedRow(page)).toMatchObject({ 'p-notes': 'new', 'p-score': 9 });

  // Back to back, well under any human gap: each press is its own step.
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => savedRow(page)).toMatchObject({ 'p-notes': 'old', 'p-score': 1 });
  await expect(cell(page, 'p-notes')).toContainText('old');

  // One redo brings back only the first commit, so they were two steps.
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => savedRow(page)).toMatchObject({ 'p-notes': 'new', 'p-score': 1 });
});

// research/23 §9: Notion's undo leaves the selection where it is and moves focus nowhere.
test('undo keeps the selection where it is and never focuses the database title', async ({ page }) => {
  const anchor = page.locator('[data-blok-database-table-cell-anchor]');
  const focusInTitle = (): Promise<boolean> => page.evaluate(() =>
    document.activeElement?.closest('[data-blok-database-title]') != null);

  for (const [propertyId, typed] of [['p-notes', 'new'], ['p-score', '9']] as const) {
    await cell(page, propertyId).click();
    await expect(editor(page)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(typed);
    await page.keyboard.press('Enter');
    await expect(editor(page)).toHaveCount(0);
  }
  // One row only, so Enter keeps the edited cell selected.
  await expect(anchor).toHaveAttribute('data-property-id', 'p-score');

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => savedRow(page)).toMatchObject({ 'p-notes': 'new', 'p-score': 1 });
  await expect(cell(page, 'p-score')).toContainText('1');
  expect(await focusInTitle()).toBe(false);
  await expect(anchor).toHaveAttribute('data-property-id', 'p-score');
  await expect(editor(page)).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => savedRow(page)).toMatchObject({ 'p-notes': 'old', 'p-score': 1 });
  await expect(cell(page, 'p-notes')).toContainText('old');
  expect(await focusInTitle()).toBe(false);
  await expect(anchor).toHaveAttribute('data-property-id', 'p-score');
});
