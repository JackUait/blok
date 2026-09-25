import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
const BLOCK_TUNES_POPOVER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const SAMPLE_IMAGE_URL = 'https://placehold.co/600x400.png';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(() => {
  ensureBlokBundleBuilt();
});

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');
    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, initialData }) => {
      const blok = new window.Blok({ holder, ...(initialData ? { data: initialData } : {}) });
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

test.beforeEach(async ({ page }) => {
  await gotoTestPage(page);
});

test('image "more" button shows selected state while its menu is open', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
    ],
  });

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

  await expect(imageBlock).toBeVisible();
  await imageBlock.hover();

  const moreBtn = imageBlock.locator('[data-action="more"]');

  await expect(moreBtn).toHaveAttribute('aria-expanded', 'false');

  await moreBtn.click();

  const popover = page.locator(BLOCK_TUNES_POPOVER_SELECTOR);
  await expect(popover).toBeVisible();

  await expect(moreBtn).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();

  await expect(moreBtn).toHaveAttribute('aria-expanded', 'false');
});

const TUNES_POPOVER = '[data-blok-testid="block-tunes-popover"][data-blok-popover-opened="true"]';

const savedBlocks = async (page: Page): Promise<Array<{ id?: string; type: string }>> =>
  page.evaluate(async () => {
    const saved = await window.blokInstance?.save();

    return (saved?.blocks ?? []).map(({ id, type }) => ({ id, type }));
  });

test.describe('image "more" menu targets the image, not the block holding the caret', () => {
  test('Delete removes the image when the caret sits in another block', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'img1', type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Latte' } },
      ],
    });

    await page.getByText('Latte').click();

    const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

    await imageBlock.hover();
    await imageBlock.locator('[data-action="more"]').click();

    const tunes = page.locator(TUNES_POPOVER);

    await expect(tunes.locator('[data-blok-item-name="image-replace"]')).toBeVisible();

    await tunes.locator('[data-blok-item-name="delete"]').click();

    await expect.poll(() => savedBlocks(page)).toEqual([{ id: 'p1', type: 'paragraph' }]);
  });

  test('Delete removes an image inside a table cell when the caret sits in another cell', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        {
          id: 'tbl',
          type: 'table',
          data: { withHeadings: false, content: [[{ blocks: ['img1'] }], [{ blocks: ['p1'] }]] },
          content: ['img1', 'p1'],
        },
        { id: 'img1', type: 'image', parent: 'tbl', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
        { id: 'p1', type: 'paragraph', parent: 'tbl', data: { text: 'Latte' } },
      ],
    });

    await page.getByText('Latte').click();

    const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

    await imageBlock.hover();
    await imageBlock.locator('[data-action="more"]').click();

    const tunes = page.locator(TUNES_POPOVER);

    await expect(tunes.locator('[data-blok-item-name="image-replace"]')).toBeVisible();

    await tunes.locator('[data-blok-item-name="delete"]').click();

    await expect(page.locator(IMAGE_BLOCK_SELECTOR)).toHaveCount(0);
    await expect(page.getByText('Latte')).toBeVisible();
  });

  test('Duplicate copies the image when the caret sits in another block', async ({ page }) => {
    await createBlok(page, {
      blocks: [
        { id: 'img1', type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
        { id: 'p1', type: 'paragraph', data: { text: 'Latte' } },
      ],
    });

    await page.getByText('Latte').click();

    const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

    await imageBlock.hover();
    await imageBlock.locator('[data-action="more"]').click();
    await page.locator(TUNES_POPOVER).locator('[data-blok-item-name="duplicate"]').click();

    await expect.poll(async () => (await savedBlocks(page)).map(({ type }) => type))
      .toEqual(['image', 'image', 'paragraph']);
  });
});
