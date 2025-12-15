import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;

/**
 * Helper function to get bounding box and throw if it doesn't exist.
 * @param locator Locator for the element.
 * @returns Bounding box of the element.
 */
const getBoundingBox = async (
  locator: ReturnType<Page['locator']>
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Could not get bounding box for element');
  }

  return box;
};

/**
 * Helper function to perform drag and drop using pointer-based mouse events.
 * This uses mousedown/mousemove/mouseup events which is how our custom DragManager works.
 * @param page Playwright page instance used to perform drag actions.
 * @param sourceLocator Locator for the element that will be dragged (the drag handle).
 * @param targetLocator Locator for the target element where the source will be dropped.
 * @param targetVerticalPosition Vertical position within the target element to drop onto.
 */
const performDragDrop = async (
  page: Page,
  sourceLocator: ReturnType<Page['locator']>,
  targetLocator: ReturnType<Page['locator']>,
  targetVerticalPosition: 'top' | 'bottom'
): Promise<void> => {
  const sourceBox = await getBoundingBox(sourceLocator);
  const targetBox = await getBoundingBox(targetLocator);

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  /**
   * For edge detection:
   * For 'top', we position just 1px from the top edge to ensure unambiguous edge detection.
   * For 'bottom', we position just 1px from the bottom edge.
   */
  const targetY = targetVerticalPosition === 'top'
    ? targetBox.y + 1 // Very close to the top edge
    : targetBox.y + targetBox.height - 1; // Very close to the bottom edge

  /**
   * Perform pointer-based drag using Playwright's mouse API.
   * This matches how our custom DragManager handles drag operations.
   */
  // Move to source and press down
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag initialization
  await page.waitForTimeout(50);

  // Move to target position with steps to trigger drag threshold
  await page.mouse.move(targetX, targetY, { steps: 15 });

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drop target detection
  await page.waitForTimeout(50);

  // Release to complete the drop
  await page.mouse.up();

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for state updates
  await page.waitForTimeout(100);
};

type CreateBlokOptions = {
  data?: OutputData;
  config?: Record<string, unknown>;
};

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  const { data = null, config = {} } = options;

  await page.evaluate(async ({ holder, data: initialData, config: blokConfig }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);

    const configToUse: Record<string, unknown> = {
      holder: holder,
      ...blokConfig,
    };

    if (initialData) {
      configToUse.data = initialData;
    }

    const blok = new window.Blok(configToUse);

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    data,
    config,
  });
};

test.describe('drag and drop', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
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

    await createBlok(page, {
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

    // 5. Verify the new order in Blok data
    const savedData = await page.evaluate(() => window.blokInstance?.save());

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

    await createBlok(page, {
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
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks[0].data.text).toBe('Third block');
    expect(savedData?.blocks[1].data.text).toBe('First block');
    expect(savedData?.blocks[2].data.text).toBe('Second block');
  });

  test('should not open block settings menu after dragging', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Second block' },
      },
    ];

    await createBlok(page, {
      data: { blocks },
    });

    // 1. Hover over the first block to show the settings button
    const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First block' });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second block' });

    // 2. Perform drag and drop
    await performDragDrop(page, settingsButton, targetBlock, 'bottom');

    // 3. Verify the block settings menu is NOT open after dragging
    // Check for popover-container inside block-tunes-popover as that's what becomes visible
    const blockTunesPopoverContainer = page.locator('[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]');

    await expect(blockTunesPopoverContainer).toBeHidden();

    // 4. Verify the blocks were reordered (drag worked)
    await expect(page.getByTestId('block-wrapper')).toHaveText([
      'Second block',
      'First block',
    ]);
  });

  test('should open block settings menu on click (without dragging)', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        type: 'paragraph',
        data: { text: 'Second block' },
      },
    ];

    await createBlok(page, {
      data: { blocks },
    });

    // 1. Hover over the first block to show the settings button
    const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First block' });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // 2. Click the settings button (without dragging)
    await settingsButton.click();

    // 3. Verify the block settings menu IS open after clicking
    // Check for popover-container inside block-tunes-popover as that's what becomes visible
    const blockTunesPopoverContainer = page.locator('[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]');

    await expect(blockTunesPopoverContainer).toBeVisible();

    // 4. Verify the blocks were NOT reordered (no drag occurred)
    await expect(page.getByTestId('block-wrapper')).toHaveText([
      'First block',
      'Second block',
    ]);
  });

  test('should drag multiple contiguous selected blocks together', async ({ page }) => {

    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'Block 0' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 1' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 2' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 3' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 4' },
      },
    ];

    await createBlok(page, {
      data: { blocks },
    });

    // Select blocks 1, 2, 3 using the BlockSelection API
    await page.evaluate(() => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }
      // Access blockSelection module via the module property
      const blockSelection = (blok as unknown as { module: { blockSelection: { selectBlockByIndex: (index: number) => void } } }).module.blockSelection;

      blockSelection.selectBlockByIndex(1);
      blockSelection.selectBlockByIndex(2);
      blockSelection.selectBlockByIndex(3);
    });

    // Hover over block 2 to show settings button
    const block2 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 2' });

    await block2.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Drag to the bottom of block 4
    const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Block 4' });

    await performDragDrop(page, settingsButton, targetBlock, 'bottom');

    // Verify the new order: blocks 1, 2, 3 moved to the end
    await expect(page.getByTestId('block-wrapper')).toHaveText([
      'Block 0',
      'Block 4',
      'Block 1',
      'Block 2',
      'Block 3',
    ]);

    // Verify data
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks[0].data.text).toBe('Block 0');
    expect(savedData?.blocks[1].data.text).toBe('Block 4');
    expect(savedData?.blocks[2].data.text).toBe('Block 1');
    expect(savedData?.blocks[3].data.text).toBe('Block 2');
    expect(savedData?.blocks[4].data.text).toBe('Block 3');
  });

  test('should drag multiple non-contiguous selected blocks together', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'Block 0' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 1' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 2' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 3' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 4' },
      },
    ];

    await createBlok(page, {
      data: { blocks },
    });

    // Select blocks 1, 3 using the BlockSelection API
    await page.evaluate(() => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }
      const blockSelection = (blok as unknown as { module: { blockSelection: { selectBlockByIndex: (index: number) => void } } }).module.blockSelection;

      blockSelection.selectBlockByIndex(1);
      blockSelection.selectBlockByIndex(3);
    });

    // Hover over block 3 to show settings button
    const block3 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 3' });

    await block3.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Drag to the top of block 0
    const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Block 0' });

    await performDragDrop(page, settingsButton, targetBlock, 'top');

    // Verify the new order: blocks 1, 3 moved to the beginning (preserving their relative order)
    await expect(page.getByTestId('block-wrapper')).toHaveText([
      'Block 1',
      'Block 3',
      'Block 0',
      'Block 2',
      'Block 4',
    ]);

    // Verify data
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks[0].data.text).toBe('Block 1');
    expect(savedData?.blocks[1].data.text).toBe('Block 3');
    expect(savedData?.blocks[2].data.text).toBe('Block 0');
    expect(savedData?.blocks[3].data.text).toBe('Block 2');
    expect(savedData?.blocks[4].data.text).toBe('Block 4');
  });

  test('should prevent dropping into the middle of a selection', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'Block 0' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 1' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 2' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 3' },
      },
    ];

    await createBlok(page, {
      data: { blocks },
    });

    // Select blocks 1, 2, 3 using the BlockSelection API
    await page.evaluate(() => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }
      const blockSelection = (blok as unknown as { module: { blockSelection: { selectBlockByIndex: (index: number) => void } } }).module.blockSelection;

      blockSelection.selectBlockByIndex(1);
      blockSelection.selectBlockByIndex(2);
      blockSelection.selectBlockByIndex(3);
    });

    // Hover over block 2 to show settings button
    const block2 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 2' });

    await block2.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Try to drag to block 2 (middle of selection) - should be prevented
    await performDragDrop(page, settingsButton, block2, 'bottom');

    // Verify the order did NOT change (drop was prevented)
    await expect(page.getByTestId('block-wrapper')).toHaveText([
      'Block 0',
      'Block 1',
      'Block 2',
      'Block 3',
    ]);

    // Verify data
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks[0].data.text).toBe('Block 0');
    expect(savedData?.blocks[1].data.text).toBe('Block 1');
    expect(savedData?.blocks[2].data.text).toBe('Block 2');
    expect(savedData?.blocks[3].data.text).toBe('Block 3');
  });

  test('should show count badge in multi-block drag preview', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'Block 0' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 1' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 2' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 3' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 4' },
      },
    ];

    await createBlok(page, {
      data: { blocks },
    });

    // Select blocks 1, 2, 3 using the BlockSelection API
    await page.evaluate(() => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }
      const blockSelection = (blok as unknown as { module: { blockSelection: { selectBlockByIndex: (index: number) => void } } }).module.blockSelection;

      blockSelection.selectBlockByIndex(1);
      blockSelection.selectBlockByIndex(2);
      blockSelection.selectBlockByIndex(3);
    });

    // Hover over block 2
    const block2 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 2' });

    await block2.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get source position
    const settingsBox = await getBoundingBox(settingsButton);

    // Start drag
    await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
    await page.mouse.down();

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag initialization
    await page.waitForTimeout(50);

    // Move a bit to trigger drag
    await page.mouse.move(settingsBox.x + 50, settingsBox.y + 50, { steps: 10 });

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for preview to appear
    await page.waitForTimeout(100);

    // Verify count badge appears in the preview
    const badge = page.getByText('3 blocks');

    await expect(badge).toBeVisible();

    // Clean up - release mouse
    await page.mouse.up();
  });

  test('should drag single selected block using multi-block path', async ({ page }) => {
    const blocks = [
      {
        type: 'paragraph',
        data: { text: 'Block 0' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 1' },
      },
      {
        type: 'paragraph',
        data: { text: 'Block 2' },
      },
    ];

    await createBlok(page, {
      data: { blocks },
    });

    // Select just block 1
    const block1 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 1' });

    await block1.click();

    // Hover to show settings button
    await block1.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Drag to the top of block 0
    const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Block 0' });

    await performDragDrop(page, settingsButton, targetBlock, 'top');

    // Verify block 1 moved to the beginning
    await expect(page.getByTestId('block-wrapper')).toHaveText([
      'Block 1',
      'Block 0',
      'Block 2',
    ]);

    // Verify data
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks[0].data.text).toBe('Block 1');
    expect(savedData?.blocks[1].data.text).toBe('Block 0');
    expect(savedData?.blocks[2].data.text).toBe('Block 2');
  });

  test('should auto-scroll viewport down when dragging near bottom edge', async ({ page }) => {
    // Create many blocks to ensure the page is scrollable
    const blocks = Array.from({ length: 20 }, (_, i) => ({
      type: 'paragraph',
      data: { text: `Block ${i}` },
    }));

    await createBlok(page, {
      data: { blocks },
    });

    // Get viewport height from browser
    const viewportHeight = await page.evaluate(() => window.innerHeight);

    // Scroll to top to ensure we start at the beginning
    await page.evaluate(() => window.scrollTo(0, 0));

    // Get initial scroll position
    const initialScrollY = await page.evaluate(() => window.scrollY);

    expect(initialScrollY).toBe(0);

    // Hover over the first block to show the settings button
    const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Block 0' });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get source position
    const settingsBox = await getBoundingBox(settingsButton);

    // Start drag
    await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
    await page.mouse.down();

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag initialization
    await page.waitForTimeout(50);

    // Move to trigger drag threshold
    await page.mouse.move(settingsBox.x + 20, settingsBox.y + 20, { steps: 5 });

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag to start
    await page.waitForTimeout(50);

    // Move cursor to near the bottom edge of the viewport (within 50px auto-scroll zone)
    await page.mouse.move(settingsBox.x, viewportHeight - 25, { steps: 10 });

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for auto-scroll to run
    await page.waitForTimeout(500);

    // Get new scroll position
    const scrolledY = await page.evaluate(() => window.scrollY);

    // Verify the page has scrolled down
    expect(scrolledY).toBeGreaterThan(initialScrollY);

    // Clean up - release mouse
    await page.mouse.up();
  });

  test('should auto-scroll viewport up when dragging near top edge', async ({ page }) => {
    // Create many blocks to ensure the page is scrollable
    const blocks = Array.from({ length: 20 }, (_, i) => ({
      type: 'paragraph',
      data: { text: `Block ${i}` },
    }));

    await createBlok(page, {
      data: { blocks },
    });

    // Scroll down first so we have room to scroll up
    await page.evaluate(() => window.scrollTo(0, 300));

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow scroll to complete
    await page.waitForTimeout(100);

    // Get initial scroll position (should be 300)
    const initialScrollY = await page.evaluate(() => window.scrollY);

    expect(initialScrollY).toBeGreaterThan(0);

    // Hover over a visible block to show the settings button
    const visibleBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Block 5' });

    await visibleBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get source position
    const settingsBox = await getBoundingBox(settingsButton);

    // Start drag
    await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
    await page.mouse.down();

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag initialization
    await page.waitForTimeout(50);

    // Move to trigger drag threshold
    await page.mouse.move(settingsBox.x + 20, settingsBox.y - 20, { steps: 5 });

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag to start
    await page.waitForTimeout(50);

    // Move cursor to near the top edge of the viewport (within 50px auto-scroll zone)
    await page.mouse.move(settingsBox.x, 25, { steps: 10 });

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for auto-scroll to run
    await page.waitForTimeout(500);

    // Get new scroll position
    const scrolledY = await page.evaluate(() => window.scrollY);

    // Verify the page has scrolled up
    expect(scrolledY).toBeLessThan(initialScrollY);

    // Clean up - release mouse
    await page.mouse.up();
  });
});
