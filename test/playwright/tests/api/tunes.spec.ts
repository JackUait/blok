import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const FIRST_BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid="block-wrapper"]:first-of-type`;
const SETTINGS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid="settings-toggler"]`;
const POPOVER_SELECTOR = '[data-testid="block-tunes-popover"]';
const POPOVER_ITEM_SELECTOR = `${POPOVER_SELECTOR} [data-testid="popover-item"]`;
const FIRST_POPOVER_ITEM_SELECTOR = `${POPOVER_ITEM_SELECTOR}:nth-of-type(1)`;
const SECOND_POPOVER_ITEM_SELECTOR = `${POPOVER_ITEM_SELECTOR}:nth-of-type(2)`;

type SerializableTuneMenuItem = {
  icon?: string;
  title?: string;
  name: string;
};

type SerializableTuneRenderConfig =
  | { type: 'single'; item: SerializableTuneMenuItem }
  | { type: 'multiple'; items: SerializableTuneMenuItem[] }
  | { type: 'html'; text: string };

declare global {
  interface Window {
    editorInstance?: EditorJS;
    __editorBundleInjectionRequested?: boolean;
  }
}

/**
 * Reset the editor holder and destroy existing editor instance.
 * @param page - The Playwright page object
 */
const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }: { holderId: string }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.testid = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

/**
 * Ensure the Editor bundle is available on the page.
 *
 * Some tests were flaking because the fixture page occasionally loads before the UMD bundle is ready,
 * leaving window.EditorJS undefined. As a fallback we inject the bundle manually once per run.
 * @param page - The Playwright page object
 */
const ensureEditorBundleLoaded = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    if (typeof window.EditorJS === 'function') {
      return true;
    }

    if (!window.__editorBundleInjectionRequested) {
      window.__editorBundleInjectionRequested = true;

      const script = document.createElement('script');

      script.src = new URL('../../../dist/editorjs.umd.js', window.location.href).href;
      script.dataset.testEditorBundle = 'injected';
      document.head.appendChild(script);
    }

    return false;
  });
};

/**
 * Create an Editor instance configured with a tune that returns the provided render config.
 * @param page - The Playwright page object
 * @param renderConfig - Serializable configuration describing tune render output
 */
const createEditorWithTune = async (
  page: Page,
  renderConfig: SerializableTuneRenderConfig
): Promise<void> => {
  await resetEditor(page);
  await ensureEditorBundleLoaded(page);

  await page.evaluate(
    async ({
      holderId,
      config,
    }: {
      holderId: string;
      config: SerializableTuneRenderConfig;
    }) => {
      const tuneConfig = config;

      /**
       * Tune implementation for testing purposes.
       */
      class TestTune {
        public static readonly isTune = true;

        /**
         * Render tune configuration for block tunes popover.
         * @returns Tune menu configuration or custom element
         */
        public render(): unknown {
          if (tuneConfig.type === 'html') {
            const element = document.createElement('div');

            element.textContent = tuneConfig.text;

            return element;
          }

          const baseItems = tuneConfig.type === 'single'
            ? [ tuneConfig.item ]
            : tuneConfig.items;

          const mappedItems = baseItems.map((item) => ({
            ...item,
            onActivate: (): void => {},
          }));

          return tuneConfig.type === 'single'
            ? mappedItems[0]
            : mappedItems;
        }

        /**
         * Save hook stub required by the tune contract.
         */
        public save(): void {}
      }

      const editor = new window.EditorJS({
        holder: holderId,
        tools: {
          testTune: TestTune,
        },
        tunes: [ 'testTune' ],
      });

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      config: renderConfig,
    }
  );
};

/**
 * Focus the first block and type provided text to expose block tunes controls.
 * @param page - The Playwright page object
 * @param text - Text to type into the block
 */
const focusBlockAndType = async (page: Page, text: string): Promise<void> => {
  const firstBlock = page.locator(FIRST_BLOCK_SELECTOR);

  await firstBlock.click();
  await page.keyboard.type(text);
  await firstBlock.click();
};

/**
 * Open block tunes popover from the currently focused block.
 * @param page - The Playwright page object
 */
const openBlockTunes = async (page: Page): Promise<void> => {
  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();
  await settingsButton.click();
};

test.describe('api.tunes', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('renders a popover entry for block tune if configured', async ({ page }) => {
    await createEditorWithTune(page, {
      type: 'single',
      item: {
        icon: 'ICON',
        title: 'Test tune',
        name: 'testTune',
      },
    });

    await focusBlockAndType(page, 'some text');
    await openBlockTunes(page);

    await expect(page.locator('[data-item-name="testTune"]')).toBeVisible();
  });

  test('renders several popover entries for block tune if configured', async ({ page }) => {
    await createEditorWithTune(page, {
      type: 'multiple',
      items: [
        {
          icon: 'ICON1',
          title: 'Tune entry 1',
          name: 'testTune1',
        },
        {
          icon: 'ICON2',
          title: 'Tune entry 2',
          name: 'testTune2',
        },
      ],
    });

    await focusBlockAndType(page, 'some text');
    await openBlockTunes(page);

    await expect(page.locator('[data-item-name="testTune1"]')).toBeVisible();
    await expect(page.locator('[data-item-name="testTune2"]')).toBeVisible();
  });

  test('displays custom HTML returned by tune render method inside tunes menu', async ({ page }) => {
    const sampleText = 'sample text';

    await createEditorWithTune(page, {
      type: 'html',
      text: sampleText,
    });

    await focusBlockAndType(page, 'some text');
    await openBlockTunes(page);

    await expect(page.locator(POPOVER_SELECTOR)).toContainText(sampleText);
  });


  test('displays installed tunes above default tunes', async ({ page }) => {
    await createEditorWithTune(page, {
      type: 'single',
      item: {
        icon: 'ICON',
        title: 'Tune entry',
        name: 'test-tune',
      },
    });

    await focusBlockAndType(page, 'some text');
    await openBlockTunes(page);

    await expect(page.locator(FIRST_POPOVER_ITEM_SELECTOR)).toHaveAttribute('data-item-name', 'test-tune');
    await expect(page.locator(SECOND_POPOVER_ITEM_SELECTOR)).toHaveAttribute('data-item-name', 'delete');
  });
});


