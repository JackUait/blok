/**
 * Board sub-group bands fold from their ▼ toggle (research/31 §3).
 * The fold is saved on the view, so it survives a reload.
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
  { id: 'p-title', name: 'Task', type: 'title', position: 'a0' },
  { id: 'p-status', name: 'Status', type: 'select', position: 'a1', config: { options: [{ id: 'o-todo', label: 'Todo', position: 'a0' }, { id: 'o-done', label: 'Done', position: 'a1' }] } },
  { id: 'p-owner', name: 'Owner', type: 'select', position: 'a2', config: { options: [{ id: 'o-ann', label: 'Ann', position: 'a0' }, { id: 'o-bo', label: 'Bo', position: 'a1' }] } },
];

const ROWS = [
  { id: 'r1', position: 'a0', properties: { 'p-title': 'Write', 'p-status': 'o-todo', 'p-owner': 'o-ann' } },
  { id: 'r2', position: 'a1', properties: { 'p-title': 'Ship', 'p-status': 'o-done', 'p-owner': 'o-bo' } },
];

const blocks = (view: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      title: 'Tasks',
      schema: SCHEMA,
      views: [{
        id: 'v1', name: 'Board', type: 'board', position: 'a0', groupBy: 'p-status', subGroupBy: 'p-owner',
        subGroupSettings: { hideEmptyGroups: true }, sorts: [], filters: [], visibleProperties: [], ...view,
      }],
      activeViewId: 'v1',
    },
    content: ROWS.map((row) => row.id),
  },
  ...ROWS.map((row) => ({ id: row.id, type: 'database-row', data: { position: row.position, properties: row.properties } })),
];

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

const save = async (page: Page): Promise<OutputBlockData[]> => page.evaluate(async () => (await window.blokInstance?.save())?.blocks ?? []);

const band = (page: Page, label: string): Locator => page.locator(`[data-blok-database-board-lane][aria-label="${label}"]`);
const toggle = (page: Page, label: string): Locator => band(page, label).locator('[data-blok-database-board-lane-toggle]');
const iconTransform = async (page: Page, label: string): Promise<string> =>
  toggle(page, label).evaluate((button) => {
    const icon = button.firstElementChild;

    return icon === null ? '' : getComputedStyle(icon).transform;
  });

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test('a click folds the band, turns the arrow, and the fold survives a reload', async ({ page }) => {
  await mount(page, blocks());

  await expect(band(page, 'Ann').getByText('Write')).toBeVisible();
  await toggle(page, 'Ann').click();

  await expect(band(page, 'Ann').getByText('Write')).toBeHidden();
  await expect(band(page, 'Ann').locator('[data-blok-database-add-card]').first()).toBeHidden();
  await expect(band(page, 'Bo').getByText('Ship')).toBeVisible();
  await expect(toggle(page, 'Ann')).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle(page, 'Ann')).toHaveAccessibleName('Open');
  await expect.poll(() => iconTransform(page, 'Ann')).toBe('matrix(0, -1, 1, 0, 0, 0)');

  const data = await save(page);

  expect((data[0].data as { views: Array<{ collapsedGroups?: unknown }> }).views[0].collapsedGroups).toEqual([{ id: 'sub:o-ann' }]);

  await mount(page, data);

  await expect(band(page, 'Ann').getByText('Write')).toBeHidden();
  await expect(toggle(page, 'Ann')).toHaveAccessibleName('Open');
});

test('Enter on the focused toggle opens a folded band again', async ({ page }) => {
  await mount(page, blocks({ collapsedGroups: [{ id: 'sub:o-ann' }] }));

  await expect(toggle(page, 'Ann')).toHaveAccessibleName('Open');
  await toggle(page, 'Ann').focus();
  await page.keyboard.press('Enter');

  await expect(band(page, 'Ann').getByText('Write')).toBeVisible();
  await expect(toggle(page, 'Ann')).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(page, 'Ann')).toHaveAccessibleName('Close');
  await expect.poll(() => iconTransform(page, 'Ann')).toBe('none');
});
