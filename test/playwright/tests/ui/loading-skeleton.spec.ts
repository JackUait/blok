import type { Page } from '@playwright/test';

import type { Blok } from '@/types';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    releaseLoad?: () => void;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

/** Boots an editor whose load stays pending until `window.releaseLoad()`. */
const bootSlow = async (page: Page, extra: Record<string, unknown> = {}): Promise<void> => {
  await gotoTestPage(page);
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(({ holder, extraConfig }) => {
    let release: (value: unknown) => void = () => undefined;

    window.releaseLoad = (): void => release({ blocks: [{ id: 'x', type: 'paragraph', data: { text: 'Loaded text' } }] });
    window.blokInstance = new window.Blok({
      holder,
      loader: { delay: 0 },
      ...extraConfig,
      persistence: {
        load: () => new Promise((resolve) => {
          release = resolve;
        }),
        save: async () => undefined,
      },
    });
  }, { holder: HOLDER_ID, extraConfig: extra });
};

test.describe('boot loading skeleton', () => {
  test.afterEach(async ({ page }) => {
    // The page is shared across the file, so emulated media must not leak into the next test.
    await page.emulateMedia({ reducedMotion: null });
  });

  test('skeleton shows during a slow load, then hands off to editable content', async ({ page }) => {
    await bootSlow(page);

    await expect(page.getByTestId('loading-skeleton')).toBeVisible();
    await page.evaluate(() => window.releaseLoad?.());
    await expect(page.getByTestId('loading-skeleton')).toHaveCount(0);
    await expect(page.getByText('Loaded text')).toBeVisible();
    await page.getByText('Loaded text').click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect(page.getByText('Loaded text!')).toBeVisible();
  });

  test('reduced motion: bars do not animate', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await bootSlow(page);

    const bar = page.getByTestId('loading-skeleton').locator('[data-blok-skeleton-bar]').first();

    await expect(bar).toBeVisible();

    const name = await bar.evaluate(el => getComputedStyle(el).animationName);

    expect(name).toBe('none');
  });

  test('read-only boot also hands off and stays read-only', async ({ page }) => {
    await bootSlow(page, { readOnly: true });

    await expect(page.getByTestId('loading-skeleton')).toBeVisible();
    await page.evaluate(() => window.releaseLoad?.());
    await expect(page.getByTestId('loading-skeleton')).toHaveCount(0);
    await expect(page.getByText('Loaded text')).toBeVisible();
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  });

  test('read-only boot: the skeleton never paints over the host element below the editor', async ({ page }) => {
    await bootSlow(page, { readOnly: true });
    await page.evaluate(({ holder }) => {
      const after = document.createElement('div');

      after.setAttribute('data-blok-testid', 'after-editor');
      after.textContent = 'Host content below';
      document.getElementById(holder)?.after(after);
    }, { holder: HOLDER_ID });

    const overlay = page.getByTestId('loading-skeleton');

    await expect(overlay).toBeVisible();

    const overlayBox = await overlay.boundingBox();
    const afterBox = await page.getByTestId('after-editor').boundingBox();

    expect(overlayBox).not.toBeNull();
    expect(afterBox).not.toBeNull();
    expect(afterBox?.y ?? 0).toBeGreaterThanOrEqual((overlayBox?.y ?? 0) + (overlayBox?.height ?? 0));

    await page.evaluate(() => window.releaseLoad?.());
    await expect(overlay).toHaveCount(0);
    await page.evaluate(() => document.querySelector('[data-blok-testid="after-editor"]')?.remove());
  });

  test('RTL: the sheen is anchored at the right edge', async ({ page }) => {
    await bootSlow(page, { i18n: { direction: 'rtl' } });

    const bar = page.getByTestId('loading-skeleton').locator('[data-blok-skeleton-bar]').first();

    await expect(bar).toBeVisible();

    const edge = await bar.evaluate(el => getComputedStyle(el).getPropertyValue('--blok-skeleton-edge').trim());

    expect(edge).toBe('right');
  });
});
