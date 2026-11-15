/**
 * Form toolbar buttons and the no-results buttons against Notion
 * (notion-motion.md Round 41 Part B). Reads getComputedStyle: the Share form
 * bug was a cascade loss that the stylesheet text alone does not show.
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
];

const blocks = (activeViewId: string, search = false): OutputBlockData[] => [
  {
    id: 'db-1',
    type: 'database',
    data: {
      schema: SCHEMA,
      views: [
        {
          id: 'v-table',
          name: 'Table',
          type: 'table',
          position: 'a0',
          sorts: [],
          filters: search ? [] : [ { id: 'f1', propertyId: 'p-amount', operator: 'greater_than', value: 100 } ],
          visibleProperties: [],
        },
        {
          id: 'v-form',
          name: 'Form',
          type: 'form',
          position: 'a1',
          sorts: [],
          filters: [],
          visibleProperties: [],
          properties: [ { id: 'p-title', visible: true } ],
        },
      ],
      activeViewId,
    },
    content: [ 'r1' ],
  },
  { id: 'r1', type: 'database-row', parent: 'db-1', data: { position: 'a0', properties: { 'p-title': 'Alpha', 'p-amount': 3 } } },
];

const mount = async (page: Page, activeViewId: string, search = false): Promise<void> => {
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
  }, blocks(activeViewId, search));
};

/** A token's computed colour, read through a probe inside the editor. */
const token = (page: Page, name: string): Promise<string> => page.evaluate((variable) => {
  const probe = document.createElement('div');

  probe.style.color = `var(${variable})`;
  document.querySelector('[data-blok-interface]')?.appendChild(probe);
  const value = getComputedStyle(probe).color;

  probe.remove();

  return value;
}, name);

const byTestId = (page: Page, id: string): Locator => page.locator(`[data-blok-testid="${id}"]`);

test.beforeAll(ensureBlokBundleBuilt);

test.describe('form toolbar and no-results buttons (notion-motion.md Round 41)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 717 });
    await page.emulateMedia({ colorScheme: 'light' });
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('"Share form" is the blue filled button, white 14px 500 text', async ({ page }) => {
    await mount(page, 'v-form');
    const share = byTestId(page, 'database-toolbar-share-form');

    await expect(share).toBeVisible();
    await expect(share).toHaveCSS('background-color', await token(page, '--blok-database-new-bg'));
    await expect(share).toHaveCSS('color', await token(page, '--blok-database-new-text'));
    await expect(share).toHaveCSS('font-weight', '500');
    await expect(share).toHaveCSS('height', '28px');
  });

  test('"Preview" is a 28px bordered button with an eye and a label in primary ink', async ({ page }) => {
    await mount(page, 'v-form');
    const preview = byTestId(page, 'database-toolbar-preview-form');

    await expect(preview).toBeVisible();
    await expect(preview).toHaveText('Preview');
    await expect(preview).toHaveCSS('border-top-width', '1px');
    await expect(preview).toHaveCSS('border-top-style', 'solid');
    await expect(preview).toHaveCSS('border-top-color', await token(page, '--blok-database-table-control-border'));
    await expect(preview).toHaveCSS('color', await token(page, '--blok-database-ink'));
    await expect(preview).toHaveCSS('height', '28px');
    const box = await preview.boundingBox();

    // Notion: 94 wide. Font metrics differ a little between the apps.
    expect(box?.width).toBeGreaterThan(88);
    expect(box?.width).toBeLessThan(100);
  });

  test('Preview and Share form stay hidden on a table view', async ({ page }) => {
    await mount(page, 'v-table');

    await expect(byTestId(page, 'database-toolbar-preview-form')).toHaveCSS('display', 'none');
    await expect(byTestId(page, 'database-toolbar-share-form')).toHaveCSS('display', 'none');
  });

  test('no results: "Edit filters" carries a 16px filter icon and "+ New page" is bordered, 14px 500', async ({ page }) => {
    await mount(page, 'v-table');
    const empty = page.locator('[data-blok-database-table-empty]');
    const edit = empty.locator('[data-blok-database-table-edit-filters]');
    const add = empty.locator('[data-blok-database-table-add-row]');

    await expect(edit).toBeVisible();
    await expect(edit.locator('svg')).toHaveCSS('width', '16px');
    await expect(add).toHaveCSS('border-top-width', '1px');
    await expect(add).toHaveCSS('border-top-color', await token(page, '--blok-database-table-control-border'));
    await expect(add).toHaveCSS('font-size', '14px');
    await expect(add).toHaveCSS('font-weight', '500');
    await expect(add).toHaveCSS('height', '28px');
    await expect(add).toHaveCSS('color', await edit.evaluate((el) => getComputedStyle(el).color));
  });

  test('the table body\'s "+ New page" row stays borderless', async ({ page }) => {
    await mount(page, 'v-table', true);
    const add = page.locator('[data-blok-database-table-add-row]').first();

    await expect(add).toBeVisible();
    await expect(add).toHaveCSS('border-top-width', '0px');
    await expect(add).toHaveCSS('font-weight', '400');
  });
});
