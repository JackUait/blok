import { expect, test } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expectBlokField } from '../helpers/field';
import { selectAllInEditable } from '../helpers/selection';
import { gotoTestPage } from '../helpers/shared-page';

declare global {
  interface Window {
    Blok: new (...args: unknown[]) => Blok;
    blokInstance?: Blok;
  }
}

const TEXT = 'One field look everywhere';

test.beforeAll(ensureBlokBundleBuilt);

for (const [theme, width] of [['light', 1280], ['dark', 1280]] as const) {
  test.describe(`${theme}, ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test.beforeEach(async ({ page }) => {
      await gotoTestPage(page);
      await page.evaluate(async text => {
        const holder = document.createElement('div');

        holder.style.cssText = 'max-width:650px;margin:200px auto 0';
        document.body.appendChild(holder);
        window.blokInstance = new window.Blok({
          holder,
          data: { blocks: [{ type: 'paragraph', data: { text } }] },
        });
        await window.blokInstance.isReady;
      }, TEXT);
      await page.evaluate(value => document.documentElement.setAttribute('data-blok-theme', value), theme);
    });

    test('block settings search is the shared search field', async ({ page }) => {
      await page.getByText(TEXT, { exact: true }).click();
      await page.getByTestId('settings-toggler').click();
      const menu = page.getByTestId('block-tunes-popover');
      const field = menu.getByTestId('popover-search-field').first();

      await expect(field).toBeVisible();
      await expectBlokField(field, field.getByRole('combobox'), 'search', { radius: '6px' });
    });

    test('"Turn into" search is the shared search field', async ({ page }) => {
      await selectAllInEditable(page.getByText(TEXT, { exact: true }));
      await page.getByTestId('inline-toolbar').getByRole('menuitem', { name: 'Text', exact: true }).click();
      const field = page.getByTestId('popover-container')
        .filter({ has: page.locator('[data-blok-convert-item]') }).last()
        .getByTestId('popover-search-field');

      await expect(field).toBeVisible();
      await expectBlokField(field, field.getByRole('combobox'), 'search', { radius: '6px' });
    });
  });
}
