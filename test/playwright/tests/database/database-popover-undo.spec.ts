/**
 * Undo pressed while focus sits on a button inside a database popover or the
 * layout builder. Both are keyboard owners, so the key reaches the editor's
 * history. A popover must not keep, or later write back, what the undo took
 * away. The full-window layout builder hides the document, so undo must not
 * change it there.
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

interface SavedOption { id: string; label: string }

const SCHEMA = [
  { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
  {
    id: 'p-stage', name: 'Stage', type: 'select', position: 'a1',
    config: { options: [
      { id: 'o-idea', label: 'Idea', color: 'yellow', position: 'a0' },
      { id: 'o-build', label: 'Build', color: 'blue', position: 'a1' },
    ] },
  },
  {
    id: 'p-tags', name: 'Tags', type: 'multiSelect', position: 'a2',
    config: { options: [{ id: 't-x', label: 'X', color: 'red', position: 'a0' }, { id: 't-y', label: 'Y', color: 'blue', position: 'a1' }] },
  },
  { id: 'p-due', name: 'Due', type: 'text', position: 'a3' },
];

const BLOCKS: OutputBlockData[] = [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
    content: ['r1'],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-stage': 'o-idea', 'p-due': 'Friday' } } },
];

const mount = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ data: input }) => {
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
  }, { data: BLOCKS });
  await expect(page.getByRole('grid').first()).toBeVisible();
};

const optionLabels = async (page: Page, propertyId: string): Promise<string[]> => page.evaluate(async (id) => {
  const output = await window.blokInstance?.save();
  const db = output?.blocks.find((block) => block.id === 'db-1');
  const schema = (db?.data as { schema: Array<{ id: string; config?: { options: SavedOption[] } }> }).schema;

  return (schema.find((p) => p.id === id)?.config?.options ?? []).map((o) => o.label);
}, propertyId);

const header = (page: Page, propertyId: string): Locator => page.locator(`[role="columnheader"][data-property-id="${propertyId}"]`);
const tableRow = (page: Page, rowId: string): Locator => page.locator(`[data-blok-database-table-row][data-row-id="${rowId}"]`);
const cell = (page: Page, rowId: string, propertyId: string): Locator => tableRow(page, rowId).locator(`[role="gridcell"][data-property-id="${propertyId}"]`);
const openMenu = (page: Page): Locator => page.locator('[data-blok-popover-opened="true"]');
const cellEditor = (page: Page): Locator => page.locator('[data-blok-database-cell-editor]');
const peek = (page: Page): Locator => page.locator('[data-blok-database-drawer]');
const builder = (page: Page): Locator => page.getByRole('dialog', { name: 'Customize page layout' });
const added = (page: Page): Locator => page.locator('[data-blok-id="added"]');

/** Adds "Review" from the open cell editor's search, then focuses the delete-confirm button of option X. */
const createThenFocusDeleteConfirm = async (page: Page): Promise<Locator> => {
  const editor = cellEditor(page);

  await expect(editor).toBeVisible();
  await page.keyboard.type('Review');
  await page.keyboard.press('Enter');
  await expect.poll(() => optionLabels(page, 'p-tags')).toContain('Review');

  await editor.locator('[data-blok-database-select-option="t-x"]').hover();
  await editor.locator('[data-blok-database-select-option="t-x"] [data-blok-database-select-option-menu]').click();
  await editor.locator('[data-blok-database-option-delete]').click();
  const confirm = editor.locator('[data-blok-database-option-delete-confirm]');

  await expect(confirm).toBeFocused();

  return confirm;
};

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
});

test.describe('undo with a database popover open', () => {
  test('undo closes the property options list, and the undone option stays gone', async ({ page }) => {
    await mount(page);
    await header(page, 'p-stage').click();
    await openMenu(page).getByRole('menuitem', { name: 'Edit property' }).click();
    const list = page.locator('[data-blok-database-options-editor]');

    await list.getByRole('button', { name: 'Add an option' }).click();
    await list.getByPlaceholder('Add an option').fill('Review');
    await page.keyboard.press('Enter');
    await expect.poll(() => optionLabels(page, 'p-stage')).toContain('Review');

    const ideaMenu = list.locator('[data-blok-database-select-option="o-idea"] [data-blok-database-select-option-menu]');

    await ideaMenu.focus();
    await page.keyboard.press('ControlOrMeta+z');

    await expect(list).toHaveCount(0);
    await expect.poll(() => optionLabels(page, 'p-stage')).toEqual(['Idea', 'Build']);

    await header(page, 'p-stage').click();
    await openMenu(page).getByRole('menuitem', { name: 'Edit property' }).click();
    await expect(list.locator('[data-blok-database-select-option]')).toHaveCount(2);
  });

  test('undo closes the multi-select cell editor, so its delete prompt cannot bring the option back', async ({ page }) => {
    await mount(page);
    await cell(page, 'r1', 'p-tags').click();
    await createThenFocusDeleteConfirm(page);

    await page.keyboard.press('ControlOrMeta+z');

    await expect(cellEditor(page)).toHaveCount(0);
    await expect.poll(() => optionLabels(page, 'p-tags')).toEqual(['X', 'Y']);
  });

  test('undo and redo close the multi-select editor in the row peek', async ({ page }) => {
    await mount(page);
    await tableRow(page, 'r1').hover();
    await tableRow(page, 'r1').locator('[data-blok-database-table-open]').click();
    await expect(peek(page)).toBeVisible();
    const tags = (): Locator => peek(page).locator('[data-blok-database-drawer-prop-value][data-property-id="p-tags"]');

    await tags().click();
    await createThenFocusDeleteConfirm(page);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(cellEditor(page)).toHaveCount(0);
    await expect.poll(() => optionLabels(page, 'p-tags')).toEqual(['X', 'Y']);

    await tags().click();
    await expect(cellEditor(page)).toBeVisible();
    await cellEditor(page).locator('[data-blok-database-select-option="t-x"]').hover();
    await cellEditor(page).locator('[data-blok-database-select-option="t-x"] [data-blok-database-select-option-menu]').click();
    await cellEditor(page).locator('[data-blok-database-option-delete]').click();
    await expect(cellEditor(page).locator('[data-blok-database-option-delete-confirm]')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Shift+z');

    await expect(cellEditor(page)).toHaveCount(0);
    await expect.poll(() => optionLabels(page, 'p-tags')).toContain('Review');
  });

  const openBuilderOverAddedBlock = async (page: Page): Promise<void> => {
    await mount(page);
    await page.evaluate(() => {
      window.blokInstance?.blocks.insert('paragraph', { text: 'added' }, undefined, 0, false, false, 'added');
    });
    await expect(added(page)).toBeAttached();
    await tableRow(page, 'r1').hover();
    await tableRow(page, 'r1').locator('[data-blok-database-table-open]').click();
    await peek(page).hover();
    await peek(page).getByRole('button', { name: 'Customize layout' }).click();
    await expect(builder(page)).toBeVisible();
  };
  const headingModuleMenu = (page: Page): Locator =>
    builder(page).locator('[data-blok-database-layout-module="heading"]').getByRole('button', { name: 'Action menu for module' });

  test('undo from a builder menu item leaves the hidden document alone', async ({ page }) => {
    await openBuilderOverAddedBlock(page);
    await headingModuleMenu(page).click();
    const item = page.getByRole('button', { name: 'Show Due as pinned' });

    await item.focus();
    await expect(item).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');

    await expect(added(page)).toBeAttached();
  });

  test('undo from the builder discard question leaves the hidden document alone', async ({ page }) => {
    await openBuilderOverAddedBlock(page);
    await headingModuleMenu(page).click();
    await page.getByRole('button', { name: 'Show Due as pinned' }).click();
    await page.keyboard.press('Escape');
    await builder(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    const discard = page.getByRole('alertdialog', { name: 'Discard all layout changes?' }).getByRole('button', { name: 'Discard' });

    await discard.focus();
    await expect(discard).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');

    await expect(added(page)).toBeAttached();
  });

  test('undo in the layout builder leaves the hidden document alone', async ({ page }) => {
    await openBuilderOverAddedBlock(page);
    const moduleMenu = headingModuleMenu(page);

    await moduleMenu.focus();
    await expect(moduleMenu).toBeFocused();
    await page.keyboard.press('ControlOrMeta+z');

    await expect(added(page)).toBeAttached();
    await expect(builder(page)).toBeVisible();
    await builder(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(builder(page)).toBeHidden();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(added(page)).toHaveCount(0);
  });
});
