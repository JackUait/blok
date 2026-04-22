// test/playwright/tests/tools/image.spec.ts

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;
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
  await page.goto(TEST_PAGE_URL);
});

test('inserts image via slash menu and embeds URL', async ({ page }) => {
  await createBlok(page);

  const defaultParagraph = page.locator(
    `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`
  );

  await defaultParagraph.click();
  await page.keyboard.type('/image', { delay: 50 });

  const imageMenuItem = page.locator('[data-blok-item-name="image"]');

  await expect(imageMenuItem).toBeVisible();
  await imageMenuItem.click();

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

  await expect(imageBlock).toBeVisible();

  await imageBlock.locator('[data-tab="embed"]').click();
  await imageBlock.getByPlaceholder('Paste an image URL…').fill(SAMPLE_IMAGE_URL);
  await imageBlock.locator('[data-action="submit-url"]').click();

  await expect(imageBlock).toHaveAttribute('data-state', 'rendered');
});

test('clicking image opens lightbox; Escape closes it', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
    ],
  });

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);
  const imageEl = imageBlock.getByAltText('pic');

  await expect(imageEl).toBeVisible();
  await imageEl.click();

  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('lightbox toolbar hides filename, shows copy-url, has no backdrop-filter', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic', fileName: 'photo.png' } },
    ],
  });

  const imageEl = page.locator(IMAGE_BLOCK_SELECTOR).getByAltText('pic');

  await expect(imageEl).toBeVisible();
  await imageEl.click();

  const dialog = page.getByRole('dialog');
  const toolbar = dialog.locator('[data-role="lightbox-toolbar"]');

  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator('[data-role="lightbox-filename"]')).toHaveCount(0);
  await expect(toolbar.locator('[data-action="lightbox-copy-url"]')).toBeVisible();

  const backdrop = await toolbar.evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(backdrop).toBe('none');

  await toolbar.locator('[data-action="lightbox-collapse"]').click();
  await expect(dialog).toHaveCount(0);
});

test('image controls only show when hovering image or caption, not surrounding whitespace', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic', caption: 'hello caption', size: 'sm', alignment: 'center' } },
    ],
  });

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);
  const img = imageBlock.getByRole('img');
  const toolbar = imageBlock.locator('[data-role="image-overlay"]');
  const caption = imageBlock.getByRole('textbox');

  await expect(img).toBeVisible();

  await page.mouse.move(0, 0);
  expect(await toolbar.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

  // Hover empty space inside the tool root but outside the image figure.
  const rootBox = await imageBlock.boundingBox();
  const figureBox = await imageBlock.locator('.blok-image-inner').boundingBox();
  if (!rootBox || !figureBox) throw new Error('box missing');
  const whitespaceX = rootBox.x + 4;
  const whitespaceY = figureBox.y + figureBox.height / 2;
  await page.mouse.move(whitespaceX, whitespaceY);
  await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

  await caption.hover();
  await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

  await page.mouse.move(0, 0);
  await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');

  await img.hover();
  await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});

test('alignment change does not leave controls stuck visible after mouse leaves', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic', size: 'sm', alignment: 'center' } },
    ],
  });

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);
  const img = imageBlock.getByRole('img');
  const toolbar = imageBlock.locator('[data-role="image-overlay"]');

  await expect(img).toBeVisible();
  await img.hover();
  await imageBlock.locator('[data-action="align-trigger"]').click();
  await imageBlock.locator('[data-action="align-left"]').click();

  await page.mouse.move(0, 0);
  await expect.poll(() => toolbar.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await expect(imageBlock).not.toHaveAttribute('data-align-open', 'true');
});

test('read-only mode hides overlay and resize handles', async ({ page }) => {
  await createBlok(page, {
    blocks: [
      { type: 'image', data: { url: SAMPLE_IMAGE_URL, alt: 'pic' } },
    ],
  });

  const imageBlock = page.locator(IMAGE_BLOCK_SELECTOR);

  await expect(imageBlock.getByRole('img')).toBeVisible();

  await page.evaluate(async () => {
    const blok = window.blokInstance ?? (() => {
      throw new Error('Blok instance not found');
    })();

    await blok.readOnly.toggle(true);
  });

  await page.waitForFunction(() => window.blokInstance?.readOnly.isEnabled === true);

  await expect(imageBlock.locator('[data-role="image-overlay"]')).toHaveCount(0);
  await expect(imageBlock.locator('[data-role="resize-handle"]')).toHaveCount(0);
});
