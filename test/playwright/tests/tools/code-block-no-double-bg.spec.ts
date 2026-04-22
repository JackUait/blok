import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

/**
 * Regression: code block's inner <code> (inside <pre>) inherited the inline-code
 * styling (background + border-radius) from the scoped preflight rule in
 * src/styles/main.css. The code tool wrapper already paints bg-bg-secondary, so
 * the inner <code> painted a second darker rounded rectangle on top — "double
 * background" visible in the screenshot the user reported.
 */

const HOLDER_ID = 'blok';

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.beforeAll(ensureBlokBundleBuilt);

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

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');
  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({ holder, data: { blocks: blokBlocks } });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const BLOCK_DATA: OutputData['blocks'] = [
  { type: 'code', data: { code: 'const x = 1;', language: 'javascript' } },
];

const readBlockCodeStyles = async (page: Page) => {
  return page.evaluate((holder) => {
    const codeEl = document.getElementById(holder)?.querySelector('pre > code');

    if (!codeEl) {
      throw new Error('Block code <code> element not found');
    }

    const computed = window.getComputedStyle(codeEl);

    return {
      backgroundColor: computed.backgroundColor,
      borderTopLeftRadius: computed.borderTopLeftRadius,
    };
  }, HOLDER_ID);
};

test.describe('Code block — no double background', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('inner <code> inside <pre> has transparent background (inline-code style does not leak)', async ({ page }) => {
    await createBlok(page, BLOCK_DATA);

    const styles = await readBlockCodeStyles(page);

    expect(styles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });

  test('inner <code> inside <pre> has no border-radius (no inner rounded box)', async ({ page }) => {
    await createBlok(page, BLOCK_DATA);

    const styles = await readBlockCodeStyles(page);

    expect(parseFloat(styles.borderTopLeftRadius)).toBe(0);
  });
});
