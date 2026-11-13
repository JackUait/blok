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

const createBookmark = async (page: Page, direction: 'ltr' | 'rtl', withCover = true): Promise<void> => {
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
    const data = { url: 'https://example.com/article', title, ...(cover === null ? {} : { image: cover }) };
    const blok = new window.Blok({
      holder,
      i18n: { direction: dir },
      data: { blocks: [ { id: 'bm', type: 'bookmark', data } ] },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, cover: withCover ? COVER : null, dir: direction });
};

const part = (page: Page, role: string): Locator => page.locator(`[data-blok-id="bm"] [data-role="${role}"]`);
const card = (page: Page): Locator => page.locator('[data-blok-id="bm"] [data-blok-testid="bookmark-card"]');

const box = async (locator: Locator): Promise<{ left: number; right: number; top: number; bottom: number }> => {
  const rect = await locator.boundingBox();

  if (rect === null) {
    throw new Error('element has no box');
  }

  return { left: rect.x, right: rect.x + rect.width, top: rect.y, bottom: rect.y + rect.height };
};

test.describe('Bookmark card', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('puts the sharp cover at the end of the card, clear of the text column', async ({ page }) => {
    await createBookmark(page, 'ltr');
    await expect(part(page, 'bookmark-image')).toBeVisible();

    const [ whole, cover, text ] = await Promise.all([ box(card(page)), box(part(page, 'bookmark-image')), box(part(page, 'bookmark-content')) ]);

    expect(Math.abs(cover.right - whole.right)).toBeLessThan(1);
    expect(Math.abs(cover.top - whole.top)).toBeLessThan(1);
    expect(Math.abs(cover.bottom - whole.bottom)).toBeLessThan(1);
    expect(text.right).toBeLessThanOrEqual(cover.left + 1);
  });

  test('puts the cover at the other end in RTL', async ({ page }) => {
    await createBookmark(page, 'rtl');
    await expect(part(page, 'bookmark-image')).toBeVisible();

    const [ whole, cover, text ] = await Promise.all([ box(card(page)), box(part(page, 'bookmark-image')), box(part(page, 'bookmark-content')) ]);

    expect(Math.abs(cover.left - whole.left)).toBeLessThan(1);
    expect(text.left).toBeGreaterThanOrEqual(cover.right - 1);
  });

  test('fills the whole card with the blurred cover', async ({ page }) => {
    await createBookmark(page, 'ltr');
    await expect(part(page, 'bookmark-wash')).toBeVisible();

    const [ whole, wash ] = await Promise.all([ box(card(page)), box(part(page, 'bookmark-wash')) ]);

    expect(Math.abs(wash.left - whole.left)).toBeLessThan(1);
    expect(Math.abs(wash.right - whole.right)).toBeLessThan(1);
    expect(Math.abs(wash.top - whole.top)).toBeLessThan(1);
    expect(Math.abs(wash.bottom - whole.bottom)).toBeLessThan(1);
  });

  test('stays in place on hover', async ({ page }) => {
    // With motion reduced a hover move would land at once, so one read is enough.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await createBookmark(page, 'ltr');
    await expect(card(page)).toBeVisible();

    const before = await box(card(page));

    await card(page).hover();

    expect(await box(card(page))).toStrictEqual(before);
    await expect(card(page)).toHaveCSS('transform', 'none');
    await page.emulateMedia({ reducedMotion: null });
  });

  test('gives the text the full width when there is no cover', async ({ page }) => {
    await createBookmark(page, 'ltr', false);
    await expect(card(page)).toBeVisible();

    const [ whole, text ] = await Promise.all([ box(card(page)), box(part(page, 'bookmark-content')) ]);

    expect(Math.abs(text.right - whole.right)).toBeLessThan(1);
    await expect(part(page, 'bookmark-image')).toHaveCount(0);
  });
});
