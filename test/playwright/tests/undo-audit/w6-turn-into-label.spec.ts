/**
 * The block menu names its conversion submenu "Turn into", like Notion.
 */
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON = '[data-blok-interface=blok] [data-blok-testid="settings-toggler"]';
const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await gotoTestPage(page);
  await page.evaluate(async ({ holder, initial }) => {
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
    const blok = new window.Blok({ holder, data: { blocks: initial } });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, initial: blocks });
};

test('the block menu says "Turn into" and it opens the conversion list', async ({ page }) => {
  await createBlok(page, [{ id: 'p', type: 'paragraph', data: { text: 'Hello' } }]);
  await page.locator('[data-blok-id="p"]').hover({ position: { x: 10, y: 10 } });
  await page.locator(SETTINGS_BUTTON).click();

  const menu = page.locator(TUNES_POPOVER);

  await expect(menu.getByRole('menuitem', { name: 'Convert to', exact: true })).toHaveCount(0);
  await menu.getByRole('menuitem', { name: 'Turn into', exact: true }).click();
  await expect(page.locator('[data-blok-nested="true"]').getByRole('menuitem', { name: 'Heading 1', exact: true })).toBeVisible();
});
