import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"]`;
const IMAGE_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-tool="image"]`;

// Minimal Google Docs clipboard HTML wrapping a single embedded image.
const GDOCS_IMG_HTML = [
  '<b id="docs-internal-guid-test" style="font-weight:normal;">',
  '<p><span style="font-weight:700">Before image</span></p>',
  '<p><span><img src="https://lh3.googleusercontent.com/blok-test-image"></span></p>',
  '<p><span>After image</span></p>',
  '</b>',
].join('');

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
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
    container.style.border = '1px dotted #388AE5';
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, initialData }) => {
      const config: Record<string, unknown> = { holder };

      if (initialData) config.data = initialData;

      const blok = new window.Blok(config);
      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, initialData: data ?? null }
  );
};

const simulatePaste = async (page: Page, html: string): Promise<void> => {
  await page.evaluate((pasteHtml) => {
    const dt = new DataTransfer();
    dt.setData('text/html', pasteHtml);
    dt.setData('text/plain', '');
    const active = document.activeElement ?? document.body;
    active.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dt,
    }));
  }, html);

  // eslint-disable-next-line playwright/no-wait-for-timeout -- async paste pipeline
  await page.waitForTimeout(300);
};

test.describe('Paste Google Docs image', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('creates an image block from a Google Docs HTML paste', async ({ page }) => {
    await createBlok(page);

    const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]').first();
    await paragraphInput.click();

    await simulatePaste(page, GDOCS_IMG_HTML);

    // The image block is created — its <img> may be replaced by the broken-image
    // fallback because googleusercontent.com is unreachable from the test runner;
    // what matters is that the image tool block was inserted (url persisted by save()).
    const image = page.locator(IMAGE_BLOCK_SELECTOR).first();
    await expect(image).toBeAttached();
  });

  test('save() exposes an image block with the pasted url', async ({ page }) => {
    await createBlok(page);

    const paragraphInput = page.locator(PARAGRAPH_BLOCK_SELECTOR).locator('[contenteditable]').first();
    await paragraphInput.click();

    await simulatePaste(page, GDOCS_IMG_HTML);

    const saved = await page.evaluate(async () => window.blokInstance?.save());
    expect(saved).toBeDefined();

    const imageBlocks = saved?.blocks.filter((b) => b.type === 'image') ?? [];
    expect(imageBlocks).toHaveLength(1);
    expect((imageBlocks[0].data as { url?: string }).url).toBe('https://lh3.googleusercontent.com/blok-test-image');
  });
});
