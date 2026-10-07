import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const COVER = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="36"><rect width="64" height="36" fill="#4a6cf7"/></svg>')}`;

const createBookmark = async (page: Page, direction: 'ltr' | 'rtl'): Promise<void> => {
  await page.evaluate(async ({ holder, cover, dir }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.style.width = '800px';
    document.body.appendChild(container);

    // RTL text makes the block lay out RTL; the editor direction alone does not.
    const title = dir === 'rtl' ? 'ع عنوان' : 'Title';
    const blok = new window.Blok({
      holder,
      i18n: { direction: dir },
      data: { blocks: [ { id: 'bm', type: 'bookmark', data: { url: 'https://example.com/article', title, image: cover } } ] },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, cover: COVER, dir: direction });
};

const windowFrame = (page: Page): Locator =>
  page.locator('[data-blok-id="bm"] [data-role="bookmark-window"]');

/** Rotation of the window in degrees, read from its computed matrix. */
const windowAngle = (page: Page): Promise<number> => windowFrame(page).evaluate((el) => {
  const { a, b } = new DOMMatrix(getComputedStyle(el).transform);

  return Math.round(Math.atan2(b, a) * 180 / Math.PI);
});

test.describe('Bookmark cover window', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('leans back from the text at rest and stands up on hover', async ({ page }) => {
    await createBookmark(page, 'ltr');

    await expect.poll(() => windowAngle(page)).toBeLessThan(0);

    await page.locator('[data-blok-id="bm"] [data-blok-testid="bookmark-card"]').hover();

    await expect.poll(() => windowAngle(page)).toBe(0);
  });

  test('leans the other way in RTL', async ({ page }) => {
    await createBookmark(page, 'rtl');

    await expect.poll(() => windowAngle(page)).toBeGreaterThan(0);
  });
});
