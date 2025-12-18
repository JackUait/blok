import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import type { OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

const DIST_BUNDLE_PATH = path.resolve(__dirname, '../../../dist/editorjs.umd.js');

const HOLDER_ID = 'blok';
const TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbar"]`;
const TOOLBAR_OPENED_SELECTOR = `${TOOLBAR_SELECTOR}[data-blok-opened="true"]`;
const TOOLBAR_ACTIONS_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbar-actions"]`;
const TOOLBAR_ACTIONS_OPENED_SELECTOR = `${TOOLBAR_ACTIONS_SELECTOR}[data-blok-opened="true"]`;
const TOOLBOX_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbox"]`;
const TOOLBOX_POPOVER_SELECTOR = `[data-blok-testid="toolbox-popover"] [data-blok-testid="popover-container"]`;
const BLOCK_TUNES_SELECTOR = `[data-blok-testid="block-tunes-popover"]`;
const BLOCK_TUNES_POPOVER_SELECTOR = `${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"]`;
const OPENED_BLOCK_TUNES_SELECTOR = `${BLOCK_TUNES_SELECTOR}[data-blok-popover-opened="true"]`;

const expectToolbarToBeOpened = async (page: Page): Promise<void> => {
  await expect(page.locator(TOOLBAR_SELECTOR)).toHaveAttribute('data-blok-opened', 'true');
};

/**
 * Wait until the Blok bundle exposed the global constructor
 * @param page - Playwright page instance
 */
const waitForBlokBundle = async (page: Page): Promise<void> => {
  await page.waitForLoadState('domcontentloaded');

  const blokAlreadyLoaded = await page.evaluate(() => typeof window.Blok === 'function');

  if (blokAlreadyLoaded) {
    return;
  }

  await page.addScriptTag({ path: DIST_BUNDLE_PATH });
  await page.waitForFunction(() => typeof window.Blok === 'function');
};

/**
 * Ensure Toolbar DOM is rendered (Toolbox lives inside it)
 * @param page - Playwright page instance
 */
const waitForToolbarReady = async (page: Page): Promise<void> => {
  await page.locator(TOOLBOX_SELECTOR).waitFor({ state: 'attached' });
};

/**
 * Reset the blok holder and destroy any existing instance
 * @param page - The Playwright page object
 */
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

/**
 * Create blok with initial data
 * @param page - The Playwright page object
 * @param data - Initial blok data
 */
const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await waitForBlokBundle(page);
  await resetBlok(page);
  await page.evaluate(
    async ({ holder, blokData }) => {
      const blok = new window.Blok({
        holder: holder,
        ...(blokData ? { data: blokData } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;
      blok.caret.setToFirstBlock();
    },
    { holder: HOLDER_ID,
      blokData: data }
  );
  await waitForToolbarReady(page);
};

test.describe('api.toolbar', () => {
  /**
   * api.toolbar.toggleToolbox(openingState?: boolean)
   */
  const firstBlock = {
    id: 'bwnFX5LoX7',
    type: 'paragraph',
    data: {
      text: 'The first block content mock.',
    },
  };
  const blokDataMock: OutputData = {
    blocks: [
      firstBlock,
    ],
  };

  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await createBlok(page, blokDataMock);
  });

  test.describe('*.open()', () => {
    test('should open the toolbar and reveal block actions', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.open();
      });

      await expectToolbarToBeOpened(page);
      await expect(page.locator(TOOLBAR_ACTIONS_OPENED_SELECTOR)).toBeVisible();
    });
  });

  test.describe('*.close()', () => {
    test('should close toolbar, toolbox and block settings', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.open();
        window.blokInstance.toolbar.toggleToolbox(true);
      });

      await expectToolbarToBeOpened(page);
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleBlockSettings(true);
      });

      await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.close();
      });

      await expect(page.locator(TOOLBAR_OPENED_SELECTOR)).toHaveCount(0);
      await expect(page.locator(TOOLBAR_ACTIONS_OPENED_SELECTOR)).toHaveCount(0);
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeHidden();
      await expect(page.locator(OPENED_BLOCK_TUNES_SELECTOR)).toHaveCount(0);
    });
  });

  test.describe('*.toggleBlockSettings()', () => {
    test('should open block settings when opening state is true', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleBlockSettings(true);
      });

      await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
    });

    test('should close block settings when opening state is false', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleBlockSettings(true);
      });

      await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleBlockSettings(false);
      });

      await expect(page.locator(OPENED_BLOCK_TUNES_SELECTOR)).toHaveCount(0);
    });

    test('should toggle block settings when opening state is omitted', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleBlockSettings();
      });

      await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleBlockSettings();
      });

      await expect(page.locator(OPENED_BLOCK_TUNES_SELECTOR)).toHaveCount(0);
    });
  });

  test.describe('*.toggleToolbox()', () => {
    test('should open the toolbox', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleToolbox(true);
      });

      const toolboxPopover = page.locator(TOOLBOX_POPOVER_SELECTOR);

      await expect(toolboxPopover).toBeVisible();
    });

    test('should close the toolbox', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleToolbox(true);
      });

      // Wait for toolbox to be visible
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleToolbox(false);
      });

      // Wait for toolbox to be hidden
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeHidden();
    });

    test('should toggle the toolbox', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleToolbox();
      });

      // Wait for toolbox to be visible
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.toolbar.toggleToolbox();
      });

      // Wait for toolbox to be hidden
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeHidden();
    });
  });
});

