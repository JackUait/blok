import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
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

type CreateBlokOptions = {
  data?: OutputData;
  style?: { contentAlign?: 'left' | 'center' | 'right' };
};

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { data, style } = options;

  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokData, blokStyle }) => {
      const blokConfig: Record<string, unknown> = {
        holder,
      };

      if (blokData !== undefined) {
        blokConfig.data = blokData;
      }

      if (blokStyle !== undefined) {
        blokConfig.style = blokStyle;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokData: data ?? null, blokStyle: style ?? null }
  );
};

const BLOCK_DATA: OutputData = {
  blocks: [
    { id: 'block-1', type: 'paragraph', data: { text: 'Hello world' } },
  ],
};

test.describe('Content alignment', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('left-aligned content has margin-left: 0px (not auto from mx-auto)', async ({ page }) => {
    await createBlok(page, { data: BLOCK_DATA });

    const marginLeft = await page.evaluate(() => {
      const content = document.querySelector('[data-blok-element-content]');

      if (!content) {
        throw new Error('Block content element not found');
      }

      return window.getComputedStyle(content).marginLeft;
    });

    // Default contentAlign is 'left' — block content should NOT be centered
    expect(marginLeft).toBe('0px');
  });

  test('explicitly left-aligned content has margin-left: 0px', async ({ page }) => {
    await createBlok(page, { data: BLOCK_DATA, style: { contentAlign: 'left' } });

    const marginLeft = await page.evaluate(() => {
      const content = document.querySelector('[data-blok-element-content]');

      if (!content) {
        throw new Error('Block content element not found');
      }

      return window.getComputedStyle(content).marginLeft;
    });

    expect(marginLeft).toBe('0px');
  });

  test('center-aligned content has margin-left: auto', async ({ page }) => {
    await createBlok(page, { data: BLOCK_DATA, style: { contentAlign: 'center' } });

    const marginLeft = await page.evaluate(() => {
      const content = document.querySelector('[data-blok-element-content]');

      if (!content) {
        throw new Error('Block content element not found');
      }

      return window.getComputedStyle(content).marginLeft;
    });

    // When centered, margin-left should be auto (computed as a pixel value > 0)
    expect(parseInt(marginLeft, 10)).toBeGreaterThan(0);
  });

  test('right-aligned content has margin-left: auto', async ({ page }) => {
    await createBlok(page, { data: BLOCK_DATA, style: { contentAlign: 'right' } });

    const marginLeft = await page.evaluate(() => {
      const content = document.querySelector('[data-blok-element-content]');

      if (!content) {
        throw new Error('Block content element not found');
      }

      return window.getComputedStyle(content).marginLeft;
    });

    // When right-aligned, margin-left should be auto (computed as a pixel value > 0)
    expect(parseInt(marginLeft, 10)).toBeGreaterThan(0);
  });
});
