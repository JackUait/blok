import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const HOLDER_ID = 'blok';

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await page.evaluate(async ({ holder, blokBlocks }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);

    const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blokBlocks: blocks });
};

test.describe('Trash icon lid', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('stays closed until its menu item is hovered', async ({ page }) => {
    await createBlok(page, [{ type: 'paragraph', data: { text: 'Hello world' } }]);

    await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`).hover();
    await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`).click();

    const deleteItem = page.locator('[data-blok-testid="popover-item"][data-blok-item-name="delete"]');
    const lid = deleteItem.locator('[data-blok-icon-lid]');

    await expect(deleteItem).toBeVisible();
    await page.mouse.move(0, 0);
    await expect.poll(() => lid.evaluate(el => getComputedStyle(el).transform)).toBe('none');

    await deleteItem.hover();
    await expect.poll(() => lid.evaluate(el => getComputedStyle(el).transform)).not.toBe('none');
  });
});
