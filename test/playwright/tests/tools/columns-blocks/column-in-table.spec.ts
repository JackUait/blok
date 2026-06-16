 
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { createBlok, ensureBlokBundleBuilt, TEST_PAGE_URL } from './_helpers';

/**
 * Columns must never be creatable INSIDE a table cell. A column_list nested in a
 * cell breaks the table's flat-cell model, so every column_list preset is a
 * table-restricted tool: the slash/plus menu hides it inside a cell exactly the
 * way it already hides `header` and `table`.
 *
 * This guards the toolbox path (the primary creation path). The same restriction
 * registry also blocks insert/paste/drag-move into a cell — see
 * src/tools/table/table-restrictions.ts and its unit coverage.
 */

const TABLE_SELECTOR = '[data-blok-tool="table"]';
const TOOLBOX_POPOVER = '[data-blok-testid="toolbox-popover"]';
const TOOLBOX_CONTAINER = `${TOOLBOX_POPOVER} [data-blok-testid="popover-container"]`;

/**
 * A single 2x2 table block; all default tools (table, column_list, …) register.
 */
const tableDoc = {
  blocks: [
    {
      id: 't1',
      type: 'table',
      data: { withHeadings: false, content: [['', ''], ['', '']] },
    },
  ],
};

/**
 * Editable area of the first table cell.
 */
const firstCellEditable = (page: Page): ReturnType<Page['locator']> =>
  page.locator(`${TABLE_SELECTOR} [data-blok-table-row]`).first()
    .locator('[data-blok-table-cell]').first()
    .locator('[data-blok-table-cell-blocks] [contenteditable="true"]').first();

test.describe('Columns are restricted inside a table cell', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('the slash menu hides every Columns preset when opened inside a table cell', async ({ page }) => {
    await createBlok(page, tableDoc);

    await expect(page.locator(TABLE_SELECTOR)).toBeVisible();

    await firstCellEditable(page).click();
    await page.keyboard.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER)).toBeVisible();

    // No column_list preset (column_list, column_list-2, column_list-3, …) is
    // visible — all are hidden inside the cell.
    const visibleColumnPresets = page.locator(
      `${TOOLBOX_POPOVER} [data-blok-item-name^="column_list"]:not([data-blok-hidden])`
    );

    await expect(visibleColumnPresets).toHaveCount(0);
  });

  test('the same Columns presets ARE available outside a table cell', async ({ page }) => {
    await createBlok(page, {
      blocks: [{ id: 'p1', type: 'paragraph', data: { text: '' } }],
    });

    await page.locator('[data-blok-id="p1"] [contenteditable="true"]').first().click();
    await page.keyboard.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER)).toBeVisible();

    // Positive control: at least one Columns preset is visible at the root, so
    // the cell test above proves restriction — not a missing tool registration.
    const visibleColumnPresets = page.locator(
      `${TOOLBOX_POPOVER} [data-blok-item-name^="column_list"]:not([data-blok-hidden])`
    );

    expect(await visibleColumnPresets.count()).toBeGreaterThan(0);
  });
});
