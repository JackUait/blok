/**
 * Property-name clashes, as measured in Notion (research/14):
 * Add property with a taken name is suffixed " 1"; a rename to a taken name
 * is refused with an error and Escape restores the old name.
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

const blocks = (): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: [
        { id: 'p-title', name: 'Name', type: 'title', position: 'a0' },
        { id: 'p-notes', name: 'Notes', type: 'text', position: 'a1' },
        { id: 'p-notes2', name: 'Notes 2', type: 'text', position: 'a2' },
      ],
      views: [{ id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [] }],
      activeViewId: 'v1',
    },
  },
];

const mount = async (page: Page): Promise<void> => {
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
  }, blocks());
  await expect(page.getByRole('grid')).toBeVisible();
};

const savedNames = async (page: Page): Promise<string[]> => page.evaluate(async () => {
  const output = await window.blokInstance?.save();
  const db = output?.blocks.find((block) => block.id === 'db-1');

  return (db?.data as { schema: Array<{ name: string }> }).schema.map((property) => property.name);
});

test.beforeAll(ensureBlokBundleBuilt);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await gotoTestPage(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await mount(page);
});

test('adding "Notes" again names the new column "Notes 1"', async ({ page }) => {
  await page.getByRole('button', { name: 'Add property' }).click();
  await page.getByPlaceholder('Property name').fill('Notes');
  await page.locator('[data-blok-database-property-type-option="text"]').click();

  await expect(page.getByRole('columnheader', { name: 'Notes 1', exact: true })).toBeVisible();
  expect(await savedNames(page)).toEqual(['Name', 'Notes', 'Notes 2', 'Notes 1']);
});

test('renaming to a taken name shows an error, Enter does nothing, Escape keeps the old name', async ({ page }) => {
  await page.getByRole('columnheader', { name: 'Notes 2', exact: true }).click();
  const name = page.locator('[data-blok-popover-opened="true"]').getByRole('textbox', { name: 'Property name' });

  await name.fill('Notes');
  await expect(page.getByText('A property named Notes already exists in this database.')).toBeVisible();
  await name.press('Enter');
  await expect(name).toBeVisible();
  await expect(name).toHaveValue('Notes');
  await name.press('Escape');

  await expect(name).toBeHidden();
  await expect(page.getByRole('columnheader', { name: 'Notes 2', exact: true })).toBeVisible();
  expect(await savedNames(page)).toEqual(['Name', 'Notes', 'Notes 2']);
});
