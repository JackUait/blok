import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
    BlokDatabase: unknown;
    BlokDatabaseRow: unknown;
  }
}

/**
 * » Minimize shows only while the pointer or a keyboard focus is on the toolbar
 * (notion-motion.md Round 102 §1 #1-#3). A keyboard user must still reach it.
 */
const HOLDER_ID = 'blok';

const blocks = (sorts: unknown[]): OutputData['blocks'] => [{
  id: 'db-1',
  type: 'database',
  data: {
    schema: [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'n', name: 'Number', type: 'number', position: 'a1' },
    ],
    views: [
      { id: 'v1', name: 'Table', type: 'table', position: 'a0', sorts, filters: [], properties: [{ id: 't', visible: true, width: 280 }, { id: 'n', visible: true, width: 200 }] },
      { id: 'v2', name: 'List', type: 'list', position: 'a1', sorts: [], filters: [], properties: [{ id: 't', visible: true }] },
    ],
    activeViewId: 'v1',
  },
  content: [],
}];

const create = async (page: Page, sorts: unknown[]): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    container.style.width = '1000px';
    document.body.appendChild(container);
    const blok = new window.Blok({
      holder,
      data: { blocks: blokBlocks },
      tools: {
        database: { class: window.BlokDatabase },
        'database-row': { class: window.BlokDatabaseRow },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks(sorts) });
};

test.describe('Database — » Minimize from the keyboard', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await gotoTestPage(page);
  });

  for (const [name, sorts] of [['a sort', [{ propertyId: 'n', direction: 'ascending' }]], ['no rule', []]] as const) {
    test(`Shift+Tab from Filter reaches » with ${name}, and Enter moves between » and «`, async ({ page }) => {
      await create(page, [...sorts]);
      const minimize = page.getByTestId('database-toolbar-minimize');
      const expand = page.getByTestId('database-toolbar-expand');
      const filter = page.getByTestId('database-toolbar-filter');

      await page.mouse.move(5, 700);
      await page.keyboard.press('Shift');
      await filter.focus();
      await page.keyboard.press('Shift+Tab');
      await expect(minimize).toBeFocused();
      await expect(minimize).toBeVisible();

      await page.keyboard.press('Enter');
      await expect(expand).toBeFocused();

      await page.keyboard.press('Enter');
      await expect(minimize).toBeFocused();
      await expect(minimize).toBeVisible();
    });
  }
});
