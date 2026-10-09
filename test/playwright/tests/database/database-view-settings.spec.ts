/**
 * Phase 3 view settings: the settings panel, filter pills and personal
 * edits, sorts, the advanced filter, grouping, conditional color, search
 * and lock. Behaviour from https://www.notion.com/help/views-filters-and-sorts
 * and research/08; every case checks the saved JSON, not only the DOM.
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
  { id: 'p-amount', name: 'Amount', type: 'number', position: 'a1' },
  {
    id: 'p-stage',
    name: 'Stage',
    type: 'select',
    position: 'a2',
    config: { options: [
      { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' },
      { id: 'o-build', label: 'Build', color: 'blue', position: 'a1' },
    ] },
  },
];

const ROWS: Array<{ id: string; properties: Record<string, unknown> }> = [
  { id: 'r1', properties: { 'p-title': 'Alpha', 'p-amount': 1200, 'p-stage': 'o-idea' } },
  { id: 'r2', properties: { 'p-title': 'Bravo', 'p-amount': 35, 'p-stage': 'o-build' } },
  { id: 'r3', properties: { 'p-title': 'Charlie' } },
];

const blocks = (view: Record<string, unknown> = {}): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [], ...view }],
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

const mount = async (page: Page, data: OutputBlockData[]): Promise<void> => {
  await page.evaluate(async ({ data: input }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById('blok')?.remove();
    localStorage.clear();
    const holder = document.createElement('div');

    holder.id = 'blok';
    holder.style.cssText = 'max-width:900px;margin:40px auto 0';
    document.body.appendChild(holder);
    window.blokInstance = new window.Blok({ holder, data: { blocks: input } });
    await window.blokInstance.isReady;
  }, { data });
  await expect(page.getByRole('grid')).toBeVisible();
};

const savedView = async (page: Page): Promise<Record<string, unknown>> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const db = output?.blocks.find((block) => block.id === 'db-1');

  return (db?.data as { views: Array<Record<string, unknown>> }).views[0];
});

const rowIds = async (page: Page): Promise<string[]> =>
  page.locator('[data-blok-database-table-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row-id') ?? ''));

const byTestId = (page: Page, id: string): Locator => page.getByTestId(id);

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('database view settings', () => {
  test('opens the settings panel and pages forward and back', async ({ page }) => {
    await mount(page, blocks());
    await byTestId(page, 'database-toolbar-settings').click();

    const panel = byTestId(page, 'database-view-settings');

    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS('width', '290px');
    await byTestId(page, 'database-settings-layout').click();
    await expect(byTestId(page, 'database-layout-table')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(byTestId(page, 'database-settings-layout')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('switches the layout and the load limit', async ({ page }) => {
    await mount(page, blocks());
    await byTestId(page, 'database-toolbar-settings').click();
    await byTestId(page, 'database-settings-layout').click();
    await byTestId(page, 'database-settings-load-limit').click();
    await byTestId(page, 'database-load-limit-10').click();
    await byTestId(page, 'database-panel-back').click();
    await byTestId(page, 'database-layout-list').click();

    await expect(page.locator('[data-blok-database-list]')).toBeVisible();
    expect(await savedView(page)).toMatchObject({ type: 'list', loadLimit: 10 });
  });

  test('keeps a filter personal until Save for everyone', async ({ page }) => {
    await mount(page, blocks());
    await byTestId(page, 'database-toolbar-filter').click();
    await byTestId(page, 'database-pick-property-p-stage').click();
    await byTestId(page, 'database-filter-option-o-idea').click();
    await page.keyboard.press('Escape');

    expect(await rowIds(page)).toEqual(['r1']);
    expect((await savedView(page)).filters).toEqual([]);

    const pill = page.locator('[data-blok-database-filter-pill][data-filter-id]');

    await expect(pill).toHaveText('Stage: Idea');
    // Gray, not Notion's blue (D3).
    const color = await pill.evaluate((el) => getComputedStyle(el).color);

    expect(color).not.toMatch(/rgb\(39, 131, 222\)/);

    await byTestId(page, 'database-view-save').click();

    expect((await savedView(page)).filters).toEqual([expect.objectContaining({ propertyId: 'p-stage', operator: 'equals', value: ['o-idea'] })]);
    await expect(byTestId(page, 'database-view-save')).toHaveCount(0);
  });

  test('Reset drops a personal sort', async ({ page }) => {
    await mount(page, blocks());
    await page.locator('[data-blok-database-table-column-header][data-property-id="p-amount"] [data-blok-database-table-column-button]').click();
    await page.getByRole('menuitem', { name: 'Sort' }).click();
    await byTestId(page, 'database-header-sort-desc').click();

    expect(await rowIds(page)).toEqual(['r1', 'r2', 'r3']);
    await expect(byTestId(page, 'database-sort-pill')).toHaveText('↓ Amount');

    await byTestId(page, 'database-view-reset').click();

    await expect(byTestId(page, 'database-sort-pill')).toHaveCount(0);
    expect((await savedView(page)).sorts).toEqual([]);
  });

  test('builds an advanced filter with an Or group', async ({ page }) => {
    await mount(page, blocks({ filterTree: { id: 'root', conjunction: 'and', filterRules: [] } }));
    await byTestId(page, 'database-toolbar-settings').click();
    await byTestId(page, 'database-settings-filter').click();
    await byTestId(page, 'database-filter-advanced').click();
    await byTestId(page, 'database-filter-add-rule-root').click();
    await byTestId(page, 'database-pick-property-p-amount').click();
    await byTestId(page, 'database-filter-add-rule-root').click();
    await byTestId(page, 'database-pick-property-p-stage').click();
    await byTestId(page, 'database-filter-conjunction-root').click();
    await byTestId(page, 'database-filter-conjunction-or').click();

    await expect(byTestId(page, 'database-advanced-pill')).toHaveText('2 rules');
  });

  test('groups by a select and hides a group', async ({ page }) => {
    await mount(page, blocks({ groupBy: 'p-stage' }));
    await byTestId(page, 'database-toolbar-settings').click();
    await byTestId(page, 'database-settings-group').click();
    await byTestId(page, 'database-group-visible-o-build').click();

    await expect(page.locator('[data-blok-database-table-group][data-group-key="o-build"]')).toHaveCount(0);
    expect((await savedView(page)).hiddenGroups).toEqual([{ id: 'o-build' }]);
  });

  test('colors rows that match a rule', async ({ page }) => {
    await mount(page, blocks());
    await byTestId(page, 'database-toolbar-settings').click();
    await byTestId(page, 'database-settings-color').click();
    await byTestId(page, 'database-color-add').click();
    await byTestId(page, 'database-pick-property-p-amount').click();

    await expect(page.locator('[data-row-id="r1"][data-blok-database-color="gray"]')).toHaveCount(1);
    await expect(page.locator('[data-row-id="r3"][data-blok-database-color]')).toHaveCount(0);
  });

  test('searches rows by title and property text', async ({ page }) => {
    await mount(page, blocks());
    await byTestId(page, 'database-toolbar-search').click();
    await page.keyboard.type('bra');

    await expect.poll(() => rowIds(page)).toEqual(['r2']);
  });

  test('a locked database keeps its views but takes data', async ({ page }) => {
    await mount(page, blocks());
    await byTestId(page, 'database-toolbar-settings').click();
    await byTestId(page, 'database-settings-lock').click();
    await page.keyboard.press('Escape');

    await expect(byTestId(page, 'database-toolbar-locked')).toBeVisible();
    const locked = await page.evaluate(async () => {
      const output = await window.blokInstance?.save();
      const db = output?.blocks.find((block) => block.id === 'db-1');

      return (db?.data as { schema: Array<{ type: string; databaseLocked?: boolean }> }).schema.find((p) => p.type === 'title')?.databaseLocked;
    });

    expect(locked).toBe(true);
  });

  test('toggle switch knob moves 12px over 200ms ease-out', async ({ page }) => {
    await mount(page, blocks());
    await byTestId(page, 'database-toolbar-settings').click();
    const knob = byTestId(page, 'database-settings-lock').locator('[data-blok-database-switch-knob]');

    await expect(knob).toHaveCSS('transition', /transform 0.2s ease-out/);
    await byTestId(page, 'database-settings-lock').click();
    await expect(knob).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 12, 0)');
  });

  test('Cmd/Ctrl+Alt+T folds every group', async ({ page }) => {
    await mount(page, blocks({ groupBy: 'p-stage' }));
    await page.keyboard.press('ControlOrMeta+Alt+KeyT');

    await expect(page.locator('[data-blok-database-table-group]:not([data-collapsed])')).toHaveCount(0);
  });
});
