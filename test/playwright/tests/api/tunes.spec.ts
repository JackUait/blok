import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const FIRST_BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]:first-of-type`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_SELECTOR = '[data-blok-testid="block-tunes-popover"]';
const POPOVER_CONTAINER_SELECTOR = `${POPOVER_SELECTOR} [data-blok-testid="popover-container"]`;

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
    blokInstance?: Blok;
    __blokBundleInjectionRequested?: boolean;
  }
}

/**
 * Reset the blok holder and destroy existing blok instance.
 * @param page - The Playwright page object
 */
const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }: { holder: string }) => {
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
 * Ensure the Blok bundle is available on the page.
 *
 * Some tests were flaking because the fixture page occasionally loads before the UMD bundle is ready,
 * leaving window.Blok undefined. As a fallback we inject the bundle manually once per run.
 * @param page - The Playwright page object
 */
const ensureBlokBundleLoaded = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    if (typeof window.Blok === 'function') {
      return true;
    }

    if (!window.__blokBundleInjectionRequested) {
      window.__blokBundleInjectionRequested = true;

      const script = document.createElement('script');

      script.src = new URL('../../../dist/editorjs.umd.js', window.location.href).href;
      script.setAttribute('data-blok-test-editor-bundle', 'injected');
      document.head.appendChild(script);
    }

    return false;
  });
};

/**
 * Create an Blok instance configured with a tune that returns the provided render config.
 * @param page - The Playwright page object
 * @param renderConfig - Serializable configuration describing tune render output
 */
const createBlokWithTune = async (
  page: Page,
  renderConfig: SerializableTuneRenderConfig
): Promise<void> => {
  await resetBlok(page);
  await ensureBlokBundleLoaded(page);

  await page.evaluate(
    async ({
      holder,
      config,
    }: {
      holder: string;
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

      const blok = new window.Blok({
        holder: holder,
        tools: {
          testTune: TestTune,
        },
        tunes: [ 'testTune' ],
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
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
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('renders a popover entry for block tune if configured', async ({ page }) => {
    await createBlokWithTune(page, {
      type: 'single',
      item: {
        icon: 'ICON',
        title: 'Test tune',
        name: 'testTune',
      },
    });

    await focusBlockAndType(page, 'some text');
    await openBlockTunes(page);

    await expect(page.locator('[data-blok-item-name="testTune"]')).toBeVisible();
  });

  test('renders several popover entries for block tune if configured', async ({ page }) => {
    await createBlokWithTune(page, {
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

    await expect(page.locator('[data-blok-item-name="testTune1"]')).toBeVisible();
    await expect(page.locator('[data-blok-item-name="testTune2"]')).toBeVisible();
  });

  test('displays custom HTML returned by tune render method inside tunes menu', async ({ page }) => {
    const sampleText = 'sample text';

    await createBlokWithTune(page, {
      type: 'html',
      text: sampleText,
    });

    await focusBlockAndType(page, 'some text');
    await openBlockTunes(page);

    await expect(page.locator(POPOVER_SELECTOR)).toContainText(sampleText);
  });


  test('displays installed tunes above default tunes', async ({ page }) => {
    await createBlokWithTune(page, {
      type: 'single',
      item: {
        icon: 'ICON',
        title: 'Tune entry',
        name: 'test-tune',
      },
    });

    await focusBlockAndType(page, 'some text');
    await openBlockTunes(page);

    const popoverContainer = page.locator(POPOVER_CONTAINER_SELECTOR);

    await expect(popoverContainer).toHaveCount(1);

    const testTuneItem = popoverContainer.locator('[data-blok-testid="popover-item"][data-blok-item-name="test-tune"]');
    const deleteItem = popoverContainer.locator('[data-blok-testid="popover-item"][data-blok-item-name="delete"]');

    await expect(testTuneItem).toBeVisible();
    await expect(deleteItem).toBeVisible();

    // Verify test-tune appears before delete by checking DOM order
    const itemNames = await popoverContainer.locator('[data-blok-testid="popover-item"]').evaluateAll(
      (elements) => elements.map((el) => el.getAttribute('data-blok-item-name'))
    );
    const testTuneIndex = itemNames.indexOf('test-tune');
    const deleteIndex = itemNames.indexOf('delete');

    expect(testTuneIndex).toBeLessThan(deleteIndex);
  });
});


