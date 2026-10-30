// spec: open a table in a full-screen modal and edit it there
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const TABLE_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="table"]`;
const CELL_SELECTOR = '[data-blok-table-cell]';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const OPEN_LABEL = 'Open in full screen';
const CLOSE_LABEL = 'Close full screen';

declare global {
  interface Window {
    blokInstance?: Blok;
    fullscreenChanges?: number;
  }
}

const tableData: OutputData = {
  blocks: [
    {
      id: 'tbl',
      type: 'table',
      data: {
        withHeadings: true,
        content: [['Feature', 'Status'], ['Grid rendering', 'Complete']],
      },
    },
    { id: 'after', type: 'paragraph', data: { text: 'After the table' } },
  ],
};

const createBlok = async (page: Page, readOnly = false): Promise<void> => {
  await page.evaluate(async ({ holder, data, readOnly: isReadOnly }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    window.fullscreenChanges = 0;

    const tableClass = (window as unknown as Record<string, Record<string, unknown>>).Blok.Table;
    const blok = new window.Blok({
      holder,
      readOnly: isReadOnly,
      data,
      tools: { table: { class: tableClass } },
      onChange: () => {
        window.fullscreenChanges = (window.fullscreenChanges ?? 0) + 1;
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, data: tableData, readOnly });

  await expect(page.locator(TABLE_SELECTOR)).toBeVisible();
};

const openWithButton = async (page: Page): Promise<void> => {
  await page.locator(TABLE_SELECTOR).hover();
  await page.getByRole('button', { name: OPEN_LABEL }).click();
  await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
};

/** The element painted at the centre of `selector`'s box, inside it or not. */
const paintsOnTop = async (page: Page, selector: string): Promise<boolean> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);

    if (!(el instanceof HTMLElement)) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);

    return hit !== null && el.contains(hit);
  }, selector);

test.describe('Table full screen', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('the hover button opens the table in a modal that fills the viewport and Escape closes it', async ({ page }) => {
    await createBlok(page);
    const parentBefore = await page.locator(TABLE_SELECTOR).evaluate(el => el.parentElement?.getAttribute('data-blok-element-content') !== null);

    await openWithButton(page);

    const dialog = page.getByRole('dialog', { name: 'Table' });
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };

    expect(box?.width ?? 0).toBeGreaterThan(viewport.width * 0.9);
    expect(box?.height ?? 0).toBeGreaterThan(viewport.height * 0.9);
    // The live table is shown, not a copy.
    await expect(dialog.locator('[data-blok-tool="table"]')).toHaveCount(1);
    await expect(page.locator(TABLE_SELECTOR)).toHaveCount(1);
    expect(parentBefore).toBe(true);
    expect(await paintsOnTop(page, '[data-blok-table-fullscreen]')).toBe(true);

    await page.locator(CELL_SELECTOR).first().click();
    await page.keyboard.press('Escape');

    await expect(dialog).toHaveCount(0);
    await expect(page.locator('[data-blok-table-fullscreen-backdrop]')).toHaveCount(0);
  });

  test('opening and closing does not change the document', async ({ page }) => {
    await createBlok(page);
    const before = await page.evaluate(async () => (await window.blokInstance?.save())?.blocks);
    const changesBefore = await page.evaluate(() => window.fullscreenChanges);

    await openWithButton(page);
    await page.getByRole('button', { name: CLOSE_LABEL }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // onChange is debounced, so "nothing fired" needs a quiet window.
    const changesAfter = await page.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));

      return window.fullscreenChanges;
    });

    expect(changesAfter).toBe(changesBefore);
    expect(await page.evaluate(async () => (await window.blokInstance?.save())?.blocks)).toEqual(before);
    await expect(page.getByRole('button', { name: OPEN_LABEL })).toBeFocused();
  });

  test('a cell edited in full screen is saved', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    const cell = page.getByRole('dialog').locator('[contenteditable="true"]').filter({ hasText: 'Complete' });

    await cell.click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');

    await expect.poll(async () => JSON.stringify(await page.evaluate(async () => window.blokInstance?.save()))).toContain('Complete!');
  });

  test('the inline toolbar paints above the full-screen table', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    const cell = page.getByRole('dialog').locator('[contenteditable="true"]').filter({ hasText: 'Complete' });

    await cell.selectText();
    await expect(page.getByTestId('inline-toolbar')).toBeVisible();

    await expect.poll(() => paintsOnTop(page, '[data-blok-testid="inline-toolbar"] [data-blok-popover-container], [data-blok-testid="inline-toolbar"] > *')).toBe(true);
  });

  test('Escape closes a menu opened from the table before the modal', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.locator('[data-blok-table-cell-row="1"][data-blok-table-cell-col="0"]').click();
    const rowGrip = page.locator('[data-blok-table-grip-row="1"]');

    await expect(rowGrip).toBeVisible();
    await rowGrip.click();
    await expect(page.getByText('Duplicate', { exact: true })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByText('Duplicate', { exact: true })).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
  });

  test('clicking the backdrop closes the modal', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.mouse.click(4, 4);

    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the block menu opens the table in full screen', async ({ page }) => {
    await createBlok(page);
    await page.locator(CELL_SELECTOR).first().click();
    await page.locator(SETTINGS_BUTTON_SELECTOR).click();
    await page.locator('[data-blok-item-name="table-open-fullscreen"]').click();

    await expect(page.getByRole('dialog', { name: 'Table' })).toBeVisible();
  });

  test('a read-only table opens in full screen too', async ({ page }) => {
    await createBlok(page, true);
    await openWithButton(page);

    await expect(page.getByRole('button', { name: CLOSE_LABEL })).toBeVisible();
  });

  test('deleting the table while it is open removes the backdrop', async ({ page }) => {
    await createBlok(page);
    await openWithButton(page);

    await page.evaluate(async () => {
      await window.blokInstance?.blocks.delete(0);
    });

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('[data-blok-table-fullscreen-backdrop]')).toHaveCount(0);
    expect(await page.evaluate(() => document.body.hasAttribute('data-blok-scroll-locked'))).toBe(false);
  });
});
