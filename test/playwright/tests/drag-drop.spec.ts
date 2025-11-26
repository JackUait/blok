import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from './helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const SETTINGS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;

/**
 * Helper function to perform drag and drop with SortableJS.
 * Uses manual mouse events with small delays to ensure proper handling.
 * Note: waitForTimeout is intentionally used here because SortableJS's internal
 * drag initialization and drop zone detection timing cannot be observed externally.
 * @param page Playwright page instance used to perform mouse actions.
 * @param sourceLocator Locator for the element that will be dragged.
 * @param targetLocator Locator for the target element where the source will be dropped.
 * @param targetVerticalPosition Vertical position within the target element to drop onto.
 */
const performDragDrop = async (
  page: Page,
  sourceLocator: ReturnType<Page['locator']>,
  targetLocator: ReturnType<Page['locator']>,
  targetVerticalPosition: 'top' | 'bottom'
): Promise<void> => {
  const sourceBox = await sourceLocator.boundingBox();
  const targetBox = await targetLocator.boundingBox();

  if (!sourceBox || !targetBox) {
    throw new Error('Could not get bounding boxes for drag and drop');
  }

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetVerticalPosition === 'top'
    ? targetBox.y + 5
    : targetBox.y + targetBox.height - 5;

  // Move to source and start drag
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Required for SortableJS drag initialization
  await page.waitForTimeout(100);

  // Move to target with multiple steps for reliable event detection
  await page.mouse.move(targetX, targetY, { steps: 30 });

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Required for SortableJS drop zone detection
  await page.waitForTimeout(50);

  await page.mouse.up();

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Required for SortableJS animation completion
  await page.waitForTimeout(200);
};

type CreateEditorOptions = {
  data?: OutputData;
  config?: Record<string, unknown>;
};

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}

const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  const { data = null, config = {} } = options;

  await page.evaluate(async ({ holderId, data: initialData, config: editorConfig }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);

    const configToUse: Record<string, unknown> = {
      holder: holderId,
      ...editorConfig,
    };

    if (initialData) {
      configToUse.data = initialData;
    }

    const editor = new window.EditorJS(configToUse);

    window.editorInstance = editor;
    await editor.isReady;
  }, {
    holderId: HOLDER_ID,
    data,
    config,
  });
};

test.describe('drag and drop', () => {
  // Skip on Webkit: SortableJS's forceFallback mode uses synthetic DOM events
  // that Playwright's mouse simulation cannot properly trigger in Webkit.
  // The drag-drop functionality works correctly in real Webkit browsers.
  // eslint-disable-next-line playwright/no-skipped-test
  test.skip(({ browserName }) => browserName === 'webkit', 'Webkit mouse simulation incompatible with SortableJS');

  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should move block from first position to the last', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Second block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Third block' },
      },
    ];

    await createEditor(page, {
      data: { blocks },
    });

    // 1. Hover over the first block to show the settings button (drag handle)
    const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First block' });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();
    const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third block' });

    // 3. Perform drag and drop
    await performDragDrop(page, settingsButton, targetBlock, 'bottom');

    // 4. Verify the new order in DOM
    await expect(page.getByTestId('block-wrapper')).toHaveText([
      'Second block',
      'Third block',
      'First block',
    ]);

    // 5. Verify the new order in Editor data
    const savedData = await page.evaluate(() => window.editorInstance?.save());

    expect(savedData?.blocks[0].data.text).toBe('Second block');
    expect(savedData?.blocks[1].data.text).toBe('Third block');
    expect(savedData?.blocks[2].data.text).toBe('First block');
  });

  test('should move block from last position to the first', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Second block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Third block' },
      },
    ];

    await createEditor(page, {
      data: { blocks },
    });

    // 1. Hover over the last block to show the settings button
    const lastBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third block' });

    await lastBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();
    const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First block' });

    // 3. Perform drag and drop
    await performDragDrop(page, settingsButton, targetBlock, 'top');

    // 4. Verify the new order
    await expect(page.getByTestId('block-wrapper')).toHaveText([
      'Third block',
      'First block',
      'Second block',
    ]);

    // 5. Verify data
    const savedData = await page.evaluate(() => window.editorInstance?.save());

    expect(savedData?.blocks[0].data.text).toBe('Third block');
    expect(savedData?.blocks[1].data.text).toBe('First block');
    expect(savedData?.blocks[2].data.text).toBe('Second block');
  });
});
