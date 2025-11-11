import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OutputData } from '@/types';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../cypress/fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const TOOLBOX_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbox`;
const TOOLBOX_POPOVER_SELECTOR = `${TOOLBOX_SELECTOR} .ce-popover__container`;

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

