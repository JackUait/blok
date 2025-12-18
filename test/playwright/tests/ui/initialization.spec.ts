import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const BLOK_ROOT_SELECTOR = BLOK_INTERFACE_SELECTOR;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const STYLE_TAG_SELECTOR = '[id="blok-styles"]';

type InitializationOptions = {
  readOnly?: boolean;
  style?: {
    nonce?: string;
  };
};
declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const waitForBlokConstructor = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const candidate = (window as unknown as { Blok?: unknown }).Blok;

    if (typeof candidate === 'function') {
      return true;
    }

    if (candidate && typeof candidate === 'object') {
      const defaultExport = (candidate as { default?: unknown }).default;

      return typeof defaultExport === 'function';
    }

    return false;
  });
};

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

const normalizeBlokConstructor = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const candidate = (window as unknown as { Blok?: unknown }).Blok;

    if (!candidate) {
      throw new Error('Blok constructor is not available on window');
    }

    if (typeof candidate === 'object') {
      const defaultExport = (candidate as { default?: unknown }).default;

      if (typeof defaultExport === 'function') {
        (window as unknown as { Blok: unknown }).Blok = defaultExport;
      }
    }
  });
};

const createBlok = async (page: Page, options: InitializationOptions = {}): Promise<void> => {
  await resetBlok(page);
  await waitForBlokConstructor(page);
  await normalizeBlokConstructor(page);

  await page.evaluate(async ({ serializedOptions, holder }) => {
    if (typeof window.Blok !== 'function') {
      throw new Error('Blok constructor is not available on window');
    }

    const blokConfig: Record<string, unknown> = {
      holder: holder,
    };

    if (serializedOptions.readOnly !== undefined) {
      blokConfig.readOnly = serializedOptions.readOnly;
    }

    if (serializedOptions.style) {
      blokConfig.style = serializedOptions.style;
    }

    const blok = new window.Blok(blokConfig);

    window.blokInstance = blok;
    await blok.isReady;
  }, { serializedOptions: options, holder: HOLDER_ID });
};

test.describe('blok basic initialization', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe('zero-config initialization', () => {
    test('@smoke creates a visible UI', async ({ page }) => {
      await createBlok(page, {});

      await expect(page.locator(BLOK_ROOT_SELECTOR)).toBeVisible();
    });
  });

  test.describe('configuration', () => {
    test.describe('readOnly', () => {
      test('creates blok without editing ability when true passed', async ({ page }) => {
        await createBlok(page, {
          readOnly: true,
        });

        // The contenteditable attribute is on the paragraph element inside the block wrapper
        const readOnlyParagraph = page.locator(`${PARAGRAPH_SELECTOR} [contenteditable="false"]`);

        await expect(readOnlyParagraph).toBeVisible();
      });
    });

    test('adds passed nonce attribute to blok styles when nonce provided', async ({ page }) => {
      await createBlok(page, {
        style: {
          nonce: 'test-nonce',
        },
      });

      await expect(page.locator(STYLE_TAG_SELECTOR)).toHaveAttribute('nonce', 'test-nonce');
    });
  });
});


