import { expect, test } from '@playwright/test';

import type { Blok } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const SETTINGS_TRIGGER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const MENU_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

test.describe('root popover boundary', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('keeps block settings beside a deep block when body is only 100vh tall', async ({ page }) => {
    /**
     * This is the consumer's actual scroll geometry: body has a definite
     * viewport height while its descendants overflow far below it. Once the
     * document scrolls, body.getBoundingClientRect() is entirely above the
     * viewport and cannot serve as a collision boundary.
     */
    await page.addStyleTag({
      content: 'html, body { margin: 0 } body { height: 100vh } #blok { padding-top: 2200px; padding-bottom: 1200px }',
    });
    await page.evaluate(async () => {
      const holder = document.createElement('div');

      holder.id = 'blok';
      document.body.appendChild(holder);

      const blok = new window.Blok({
        holder: 'blok',
        data: {
          blocks: [
            {
              id: 'deep-block',
              type: 'paragraph',
              data: { text: 'Deep target' },
            },
          ],
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    });

    const block = page.locator(BLOCK_SELECTOR);

    await block.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    await block.click();

    const trigger = page.locator(SETTINGS_TRIGGER_SELECTOR);

    await expect(trigger).toBeVisible();
    const triggerBox = await trigger.boundingBox();

    if (triggerBox === null) {
      throw new Error('Settings trigger has no bounding box');
    }

    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);
    await trigger.click();

    const menu = page.locator(MENU_SELECTOR);

    await expect(menu).toBeVisible();
    // The container opens from scale(0.98) over 120ms. Bounding boxes during
    // that transition differ by a few pixels across engines, so wait for the
    // geometry-affecting transform to settle before asserting placement.
    await expect(menu).toHaveCSS('transform', 'none');
    const menuBox = await menu.boundingBox();

    if (menuBox === null) {
      throw new Error('Block settings menu has no bounding box');
    }

    const triggerCenterY = triggerBox.y + triggerBox.height / 2;
    const menuCenterY = menuBox.y + menuBox.height / 2;

    expect(Math.abs(menuCenterY - triggerCenterY)).toBeLessThanOrEqual(2);
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(720);
  });
});
