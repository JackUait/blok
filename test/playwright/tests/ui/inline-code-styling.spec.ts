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

const createBlok = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === 'function');

  await page.evaluate(
    async ({ holder, blokBlocks }) => {
      const blok = new window.Blok({
        holder,
        data: { blocks: blokBlocks },
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    { holder: HOLDER_ID, blokBlocks: blocks }
  );
};

const readInlineCodeStyles = async (page: Page) => {
  return page.evaluate((holder) => {
    const wrapper = document.getElementById(holder);
    const codeEl = wrapper?.querySelector('code');

    if (!codeEl) {
      throw new Error('Inline code element not found');
    }

    const computed = window.getComputedStyle(codeEl);

    return {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      paddingLeft: computed.paddingLeft,
      paddingRight: computed.paddingRight,
      paddingTop: computed.paddingTop,
      paddingBottom: computed.paddingBottom,
      borderRadius: computed.borderRadius,
    };
  }, HOLDER_ID);
};

const BLOCK_DATA: OutputData['blocks'] = [
  { type: 'paragraph', data: { text: 'Plain text <code>Technical Documentation Team</code>' } },
];

test.describe('Inline code styling', () => {
  test.beforeAll(ensureBlokBundleBuilt);

  test.describe('light theme', () => {
    test.use({ colorScheme: 'light' });

    test.beforeEach(async ({ page }) => {
      await page.goto(TEST_PAGE_URL);
    });

    test('inline code has coral/red text on light gray background', async ({ page }) => {
      await createBlok(page, BLOCK_DATA);

      const styles = await readInlineCodeStyles(page);

      // --blok-color-red-text light: #d44c47 → rgb(212, 76, 71)
      expect(styles.color).toBe('rgb(212, 76, 71)');

      // Background must be visible (not transparent)
      expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(styles.backgroundColor).not.toBe('transparent');
    });

    test('inline code has 2px vertical / 4px horizontal padding and rounded corners', async ({ page }) => {
      await createBlok(page, BLOCK_DATA);

      const styles = await readInlineCodeStyles(page);

      expect(styles.paddingTop).toBe('2px');
      expect(styles.paddingBottom).toBe('2px');
      expect(styles.paddingLeft).toBe('4px');
      expect(styles.paddingRight).toBe('4px');
      expect(parseFloat(styles.borderRadius)).toBeGreaterThan(0);
    });
  });

  test.describe('dark theme', () => {
    test.use({ colorScheme: 'dark' });

    test.beforeEach(async ({ page }) => {
      await page.goto(TEST_PAGE_URL);
    });

    test('inline code has coral/red text on dark background', async ({ page }) => {
      await createBlok(page, BLOCK_DATA);

      const styles = await readInlineCodeStyles(page);

      // --blok-color-red-text dark: #dd5e5a → rgb(221, 94, 90)
      expect(styles.color).toBe('rgb(221, 94, 90)');

      // Background must be visible (not transparent)
      expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(styles.backgroundColor).not.toBe('transparent');
    });
  });
});
