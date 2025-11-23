import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OutputData } from '@/types';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;
const DIST_BUNDLE_PATH = path.resolve(__dirname, '../../../dist/editorjs.umd.js');

const HOLDER_ID = 'editorjs';
const TOOLBAR_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar`;
const TOOLBAR_OPENED_SELECTOR = `${TOOLBAR_SELECTOR}.ce-toolbar--opened`;
const TOOLBAR_ACTIONS_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__actions`;
const TOOLBAR_ACTIONS_OPENED_SELECTOR = `${TOOLBAR_ACTIONS_SELECTOR}.ce-toolbar__actions--opened`;
const TOOLBOX_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbox`;
const TOOLBOX_POPOVER_SELECTOR = `[data-cy=toolbox] .ce-popover__container`;
const BLOCK_TUNES_SELECTOR = `[data-cy=block-tunes]`;
const BLOCK_TUNES_POPOVER_SELECTOR = `${BLOCK_TUNES_SELECTOR} .ce-popover__container`;
const OPENED_BLOCK_TUNES_SELECTOR = `${BLOCK_TUNES_SELECTOR}[data-popover-opened="true"]`;

const expectToolbarToBeOpened = async (page: Page): Promise<void> => {
  await expect(page.locator(TOOLBAR_SELECTOR)).toHaveAttribute('class', /\bce-toolbar--opened\b/);
};

/**
 * Wait until the Editor bundle exposed the global constructor
 *
 * @param page - Playwright page instance
 */
const waitForEditorBundle = async (page: Page): Promise<void> => {
  await page.waitForLoadState('domcontentloaded');

  const editorAlreadyLoaded = await page.evaluate(() => typeof window.EditorJS === 'function');

  if (editorAlreadyLoaded) {
    return;
  }

  await page.addScriptTag({ path: DIST_BUNDLE_PATH });
  await page.waitForFunction(() => typeof window.EditorJS === 'function');
};

/**
 * Ensure Toolbar DOM is rendered (Toolbox lives inside it)
 *
 * @param page - Playwright page instance
 */
const waitForToolbarReady = async (page: Page): Promise<void> => {
  await page.locator(TOOLBOX_SELECTOR).waitFor({ state: 'attached' });
};

/**
 * Reset the editor holder and destroy any existing instance
 *
 * @param page - The Playwright page object
 */
const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.cy = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

/**
 * Create editor with initial data
 *
 * @param page - The Playwright page object
 * @param data - Initial editor data
 */
const createEditor = async (page: Page, data?: OutputData): Promise<void> => {
  await waitForEditorBundle(page);
  await resetEditor(page);
  await page.evaluate(
    async ({ holderId, editorData }) => {
      const editor = new window.EditorJS({
        holder: holderId,
        ...(editorData ? { data: editorData } : {}),
      });

      window.editorInstance = editor;
      await editor.isReady;
      editor.caret.setToFirstBlock();
    },
    { holderId: HOLDER_ID,
      editorData: data }
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
  const editorDataMock: OutputData = {
    blocks: [
      firstBlock,
    ],
  };

  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await createEditor(page, editorDataMock);
  });

  test.describe('*.open()', () => {
    test('should open the toolbar and reveal block actions', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.open();
      });

      await expectToolbarToBeOpened(page);
      await expect(page.locator(TOOLBAR_ACTIONS_OPENED_SELECTOR)).toBeVisible();
    });
  });

  test.describe('*.close()', () => {
    test('should close toolbar, toolbox and block settings', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.open();
        window.editorInstance.toolbar.toggleToolbox(true);
      });

      await expectToolbarToBeOpened(page);
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleBlockSettings(true);
      });

      await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.close();
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
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleBlockSettings(true);
      });

      await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
    });

    test('should close block settings when opening state is false', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleBlockSettings(true);
      });

      await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleBlockSettings(false);
      });

      await expect(page.locator(OPENED_BLOCK_TUNES_SELECTOR)).toHaveCount(0);
    });

    test('should toggle block settings when opening state is omitted', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleBlockSettings();
      });

      await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleBlockSettings();
      });

      await expect(page.locator(OPENED_BLOCK_TUNES_SELECTOR)).toHaveCount(0);
    });
  });

  test.describe('*.toggleToolbox()', () => {
    test('should open the toolbox', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleToolbox(true);
      });

      const toolboxPopover = page.locator(TOOLBOX_POPOVER_SELECTOR);

      await expect(toolboxPopover).toBeVisible();
    });

    test('should close the toolbox', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleToolbox(true);
      });

      // Wait for toolbox to be visible
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleToolbox(false);
      });

      // Wait for toolbox to be hidden
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeHidden();
    });

    test('should toggle the toolbox', async ({ page }) => {
      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleToolbox();
      });

      // Wait for toolbox to be visible
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeVisible();

      await page.evaluate(() => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        window.editorInstance.toolbar.toggleToolbox();
      });

      // Wait for toolbox to be hidden
      await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toBeHidden();
    });
  });
});

