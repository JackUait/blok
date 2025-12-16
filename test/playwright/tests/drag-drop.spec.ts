import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, BLOK_DUPLICATING_SELECTOR } from '../../../src/components/constants';

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

/**
 * Helper function to perform drag and drop with Alt/Option key held (for duplication).
 * @param page Playwright page instance used to perform drag actions.
 * @param sourceLocator Locator for the element that will be dragged (the drag handle).
 * @param targetLocator Locator for the target element where the source will be dropped.
 * @param targetVerticalPosition Vertical position within the target element to drop onto.
 */
const performAltDragDrop = async (
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
  const targetY = targetVerticalPosition === 'top'
    ? targetBox.y + 1
    : targetBox.y + targetBox.height - 1;

  // Move to source and press down
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag initialization
  await page.waitForTimeout(50);

  // Move to target position with steps to trigger drag threshold
  await page.mouse.move(targetX, targetY, { steps: 15 });

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drop target detection
  await page.waitForTimeout(50);

  // Hold Alt key and release mouse to duplicate instead of move
  await page.keyboard.down('Alt');

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for alt key registration
  await page.waitForTimeout(50);

  await page.mouse.up();

  await page.keyboard.up('Alt');

  // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for async duplication to complete
  await page.waitForTimeout(150);
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

  test('should show top drop indicator when hovering over top half of first block', async ({ page }) => {
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

    // Hover over the last block to show the settings button
    const lastBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third block' });

    await lastBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get positions
    const settingsBox = await getBoundingBox(settingsButton);
    const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First block' });
    const firstBlockBox = await getBoundingBox(firstBlock);

    // Start drag
    await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
    await page.mouse.down();

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag initialization
    await page.waitForTimeout(50);

    // Move to the top half of the first block
    await page.mouse.move(
      firstBlockBox.x + firstBlockBox.width / 2,
      firstBlockBox.y + 1, // Very close to top edge
      { steps: 15 }
    );

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for indicator to appear
    await page.waitForTimeout(50);

    // Verify top indicator is shown on the first block
    await expect(firstBlock).toHaveAttribute('data-drop-indicator', 'top');

    // Verify no bottom indicator exists anywhere
    const bottomIndicators = page.locator('[data-drop-indicator="bottom"]');

    await expect(bottomIndicators).toHaveCount(0);

    // Clean up
    await page.mouse.up();
  });

  test('should show bottom indicator on previous block when hovering over top half of non-first block', async ({ page }) => {
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

    // Hover over the last block to show the settings button
    const lastBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third block' });

    await lastBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get positions
    const settingsBox = await getBoundingBox(settingsButton);
    const secondBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second block' });
    const secondBlockBox = await getBoundingBox(secondBlock);

    // Start drag
    await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
    await page.mouse.down();

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag initialization
    await page.waitForTimeout(50);

    // Move to the top half of the second block
    await page.mouse.move(
      secondBlockBox.x + secondBlockBox.width / 2,
      secondBlockBox.y + 1, // Very close to top edge
      { steps: 15 }
    );

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for indicator to appear
    await page.waitForTimeout(50);

    // Verify bottom indicator is shown on the FIRST block (not the second)
    const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First block' });

    await expect(firstBlock).toHaveAttribute('data-drop-indicator', 'bottom');

    // Verify no top indicator exists anywhere
    const topIndicators = page.locator('[data-drop-indicator="top"]');

    await expect(topIndicators).toHaveCount(0);

    // Verify only one indicator total
    const allIndicators = page.locator('[data-drop-indicator]');

    await expect(allIndicators).toHaveCount(1);

    // Clean up
    await page.mouse.up();
  });

  test('should show exactly one drop indicator at any position', async ({ page }) => {
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

    // Hover over block 3 to show the settings button
    const block3 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 3' });

    await block3.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get positions for all blocks
    const block0 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 0' });
    const block1 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 1' });
    const block2 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 2' });

    const settingsBox = await getBoundingBox(settingsButton);
    const block0Box = await getBoundingBox(block0);
    const block1Box = await getBoundingBox(block1);
    const block2Box = await getBoundingBox(block2);

    // Start drag
    await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
    await page.mouse.down();

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow time for drag initialization
    await page.waitForTimeout(50);

    // Move over bottom half of block 0
    await page.mouse.move(
      block0Box.x + block0Box.width / 2,
      block0Box.y + block0Box.height - 1,
      { steps: 10 }
    );

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow indicator to update
    await page.waitForTimeout(50);

    let allIndicators = page.locator('[data-drop-indicator]');

    await expect(allIndicators).toHaveCount(1);

    // Move over top half of block 1 (should show indicator on block 0)
    await page.mouse.move(
      block1Box.x + block1Box.width / 2,
      block1Box.y + 1,
      { steps: 10 }
    );

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow indicator to update
    await page.waitForTimeout(50);

    allIndicators = page.locator('[data-drop-indicator]');
    await expect(allIndicators).toHaveCount(1);

    // Move over bottom half of block 1
    await page.mouse.move(
      block1Box.x + block1Box.width / 2,
      block1Box.y + block1Box.height - 1,
      { steps: 10 }
    );

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow indicator to update
    await page.waitForTimeout(50);

    allIndicators = page.locator('[data-drop-indicator]');
    await expect(allIndicators).toHaveCount(1);

    // Move over top half of block 2 (should show indicator on block 1)
    await page.mouse.move(
      block2Box.x + block2Box.width / 2,
      block2Box.y + 1,
      { steps: 10 }
    );

    // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow indicator to update
    await page.waitForTimeout(50);

    allIndicators = page.locator('[data-drop-indicator]');
    await expect(allIndicators).toHaveCount(1);

    // Clean up
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

  test.describe('nested list items drag behavior', () => {
    /**
     * Helper to create list item blocks with depth support.
     */
    const createListBlocks = (
      items: Array<{ text: string; depth?: number }>
    ): OutputData['blocks'] => items.map((item, index) => ({
      id: `list-${index}`,
      type: 'list',
      data: {
        text: item.text,
        style: 'unordered',
        ...(item.depth !== undefined && item.depth > 0 ? { depth: item.depth } : {}),
      },
    }));

    test('should drag parent list item with all nested children', async ({ page }) => {
      // Create a list with parent and nested children:
      // - First (depth 0) <- parent
      //   - Nested A (depth 1) <- child
      //   - Nested B (depth 1) <- child
      // - Second (depth 0)
      const blocks = createListBlocks([
        { text: 'First' },
        { text: 'Nested A', depth: 1 },
        { text: 'Nested B', depth: 1 },
        { text: 'Second' },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over the first block (parent) to show settings button
      const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First' });

      await firstBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the bottom of the last block
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify the new order: parent and children moved together after "Second"
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks[0].data.text).toBe('Second');
      expect(savedData?.blocks[1].data.text).toBe('First');
      expect(savedData?.blocks[2].data.text).toBe('Nested A');
      expect(savedData?.blocks[3].data.text).toBe('Nested B');
    });

    test('should drag nested item with its own children', async ({ page }) => {
      // Create a deeply nested list:
      // - First (depth 0)
      //   - Nested A (depth 1) <- drag this
      //     - Deep A1 (depth 2) <- should come along
      //   - Nested B (depth 1)
      const blocks = createListBlocks([
        { text: 'First' },
        { text: 'Nested A', depth: 1 },
        { text: 'Deep A1', depth: 2 },
        { text: 'Nested B', depth: 1 },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over "Nested A" to show settings button
      const nestedABlock = page.getByTestId('block-wrapper').filter({ hasText: 'Nested A' });

      await nestedABlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the bottom of "Nested B"
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Nested B' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify: Nested A and Deep A1 moved together after Nested B
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks[0].data.text).toBe('First');
      expect(savedData?.blocks[1].data.text).toBe('Nested B');
      expect(savedData?.blocks[2].data.text).toBe('Nested A');
      expect(savedData?.blocks[3].data.text).toBe('Deep A1');
    });

    test('should drag deepest nested item alone (no children)', async ({ page }) => {
      // Create a nested list where the dragged item has no children:
      // - First (depth 0)
      //   - Nested A (depth 1)
      //     - Deep A1 (depth 2) <- drag this (no children)
      //   - Nested B (depth 1)
      const blocks = createListBlocks([
        { text: 'First' },
        { text: 'Nested A', depth: 1 },
        { text: 'Deep A1', depth: 2 },
        { text: 'Nested B', depth: 1 },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over "Deep A1" to show settings button
      const deepBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Deep A1' });

      await deepBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the bottom of "Nested B"
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Nested B' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify: Only Deep A1 moved, rest unchanged
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks[0].data.text).toBe('First');
      expect(savedData?.blocks[1].data.text).toBe('Nested A');
      expect(savedData?.blocks[2].data.text).toBe('Nested B');
      expect(savedData?.blocks[3].data.text).toBe('Deep A1');
    });

    test('should not include sibling list items at the same depth', async ({ page }) => {
      // Create a list where siblings at same depth should NOT be dragged:
      // - First (depth 0) <- drag this
      // - Second (depth 0) <- sibling, should NOT come along
      const blocks = createListBlocks([
        { text: 'First' },
        { text: 'Second' },
        { text: 'Third' },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over "First" to show settings button
      const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First' });

      await firstBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the bottom of "Third"
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify: Only "First" moved, siblings stay in place
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks[0].data.text).toBe('Second');
      expect(savedData?.blocks[1].data.text).toBe('Third');
      expect(savedData?.blocks[2].data.text).toBe('First');
    });

    test('should adjust depth when dropping into nested list context', async ({ page }) => {
      // Test the depth adjustment when dropping a root item between nested items:
      // Before:
      // - First (depth 0)
      //   - Second (depth 1)
      //   - Third (depth 1)
      // - Fourth (depth 0) <- drag this between Second and Third
      //
      // After: Fourth should become depth 1 to not break the list structure
      const blocks = createListBlocks([
        { text: 'First' },
        { text: 'Second', depth: 1 },
        { text: 'Third', depth: 1 },
        { text: 'Fourth' },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over "Fourth" to show settings button
      const fourthBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Fourth' });

      await fourthBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the top of "Third" (between Second and Third)
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third' });

      await performDragDrop(page, settingsButton, targetBlock, 'top');

      // Verify: Fourth is now between Second and Third with depth 1
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks[0].data.text).toBe('First');
      expect(savedData?.blocks[1].data.text).toBe('Second');
      expect(savedData?.blocks[2].data.text).toBe('Fourth');
      expect(savedData?.blocks[3].data.text).toBe('Third');

      // Fourth should have been adjusted to depth 1
      expect(savedData?.blocks[2].data.depth).toBe(1);
    });

    test('should preserve ordering when dragging list subtree', async ({ page }) => {
      // Ensure the order of children is preserved after moving
      const blocks = createListBlocks([
        { text: 'Target' },
        { text: 'Parent' },
        { text: 'Child 1', depth: 1 },
        { text: 'Child 2', depth: 1 },
        { text: 'Child 3', depth: 1 },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over "Parent" to show settings button
      const parentBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Parent' });

      await parentBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the top of "Target"
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Target' });

      await performDragDrop(page, settingsButton, targetBlock, 'top');

      // Verify: Parent and children moved before Target, preserving order
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks[0].data.text).toBe('Parent');
      expect(savedData?.blocks[1].data.text).toBe('Child 1');
      expect(savedData?.blocks[2].data.text).toBe('Child 2');
      expect(savedData?.blocks[3].data.text).toBe('Child 3');
      expect(savedData?.blocks[4].data.text).toBe('Target');
    });

    test('should handle multi-level nesting when dragging', async ({ page }) => {
      // Test dragging with grandchildren:
      // - First (depth 0) <- drag this
      //   - Child (depth 1)
      //     - Grandchild (depth 2)
      // - Second (depth 0)
      const blocks = createListBlocks([
        { text: 'First' },
        { text: 'Child', depth: 1 },
        { text: 'Grandchild', depth: 2 },
        { text: 'Second' },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over "First" to show settings button
      const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First' });

      await firstBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the bottom of "Second"
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify: Entire subtree moved
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks[0].data.text).toBe('Second');
      expect(savedData?.blocks[1].data.text).toBe('First');
      expect(savedData?.blocks[2].data.text).toBe('Child');
      expect(savedData?.blocks[3].data.text).toBe('Grandchild');
    });

    test('should use explicit selection when blocks are selected (not auto-include children)', async ({ page }) => {
      // When user explicitly selects blocks, those should be dragged, not auto-detected children
      const blocks = createListBlocks([
        { text: 'First' },
        { text: 'Child A', depth: 1 },
        { text: 'Child B', depth: 1 },
        { text: 'Second' },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      // Explicitly select only "First" and "Child A" (not Child B)
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }
        const blockSelection = (blok as unknown as { module: { blockSelection: { selectBlockByIndex: (index: number) => void } } }).module.blockSelection;

        blockSelection.selectBlockByIndex(0);
        blockSelection.selectBlockByIndex(1);
      });

      // Hover over "First" to show settings button
      const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First' });

      await firstBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the bottom of "Second"
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify: Only explicitly selected blocks (First, Child A) moved, Child B stays
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks[0].data.text).toBe('Child B');
      expect(savedData?.blocks[1].data.text).toBe('Second');
      expect(savedData?.blocks[2].data.text).toBe('First');
      expect(savedData?.blocks[3].data.text).toBe('Child A');
    });
  });

  test.describe('alt+drag duplication', () => {
    test('should duplicate a single block when Alt key is held during drop', async ({ page }) => {
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

      // Hover over the first block to show the settings button
      const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First block' });

      await firstBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third block' });

      // Perform Alt+drag to duplicate
      await performAltDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify: Original block still exists AND a duplicate was created at the end
      await expect(page.getByTestId('block-wrapper')).toHaveCount(4);
      await expect(page.getByTestId('block-wrapper')).toHaveText([
        'First block',
        'Second block',
        'Third block',
        'First block', // Duplicate
      ]);

      // Verify data - original preserved, duplicate added
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks).toHaveLength(4);
      expect(savedData?.blocks[0].data.text).toBe('First block');
      expect(savedData?.blocks[1].data.text).toBe('Second block');
      expect(savedData?.blocks[2].data.text).toBe('Third block');
      expect(savedData?.blocks[3].data.text).toBe('First block');

      // Verify duplicate has a different ID than original
      expect(savedData?.blocks[3].id).not.toBe(savedData?.blocks[0].id);
    });

    test('should duplicate block to top position when dropping at top edge', async ({ page }) => {
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

      // Hover over the second block
      const secondBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second block' });

      await secondBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First block' });

      // Duplicate to top of first block
      await performAltDragDrop(page, settingsButton, targetBlock, 'top');

      // Verify: Duplicate inserted at position 0
      await expect(page.getByTestId('block-wrapper')).toHaveCount(3);
      await expect(page.getByTestId('block-wrapper')).toHaveText([
        'Second block', // Duplicate at top
        'First block',
        'Second block', // Original
      ]);
    });

    test('should duplicate multiple selected blocks together', async ({ page }) => {
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

      // Select blocks 1 and 2
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }
        const blockSelection = (blok as unknown as { module: { blockSelection: { selectBlockByIndex: (index: number) => void } } }).module.blockSelection;

        blockSelection.selectBlockByIndex(1);
        blockSelection.selectBlockByIndex(2);
      });

      // Hover over block 1 to show settings button
      const block1 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 1' });

      await block1.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Duplicate to bottom of block 3
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Block 3' });

      await performAltDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify: Originals preserved, duplicates added at the end
      await expect(page.getByTestId('block-wrapper')).toHaveCount(6);
      await expect(page.getByTestId('block-wrapper')).toHaveText([
        'Block 0',
        'Block 1', // Original
        'Block 2', // Original
        'Block 3',
        'Block 1', // Duplicate
        'Block 2', // Duplicate
      ]);

      // Verify data
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks).toHaveLength(6);
      expect(savedData?.blocks[4].data.text).toBe('Block 1');
      expect(savedData?.blocks[5].data.text).toBe('Block 2');
    });

    test('should show duplicating visual feedback when Alt key is pressed during drag', async ({ page }) => {
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

      // Hover over the first block
      const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First block' });

      await firstBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Get positions
      const settingsBox = await getBoundingBox(settingsButton);
      const secondBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second block' });
      const secondBlockBox = await getBoundingBox(secondBlock);

      // Start drag
      await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
      await page.mouse.down();

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow drag init
      await page.waitForTimeout(50);

      // Move to trigger drag
      await page.mouse.move(
        secondBlockBox.x + secondBlockBox.width / 2,
        secondBlockBox.y + secondBlockBox.height - 1,
        { steps: 15 }
      );

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow drag start
      await page.waitForTimeout(50);

      // Verify duplicating attribute is NOT set yet
      const blokWrapper = page.locator(BLOK_DUPLICATING_SELECTOR);

      await expect(blokWrapper).toHaveCount(0);

      // Press Alt key
      await page.keyboard.down('Alt');

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow key registration
      await page.waitForTimeout(50);

      // Verify duplicating attribute IS set
      await expect(blokWrapper).toHaveCount(1);

      // Release Alt key
      await page.keyboard.up('Alt');

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow key unregistration
      await page.waitForTimeout(50);

      // Verify duplicating attribute is removed
      await expect(blokWrapper).toHaveCount(0);

      // Clean up
      await page.mouse.up();
    });

    test('should preserve original block positions when duplicating', async ({ page }) => {
      const blocks = [
        {
          type: 'paragraph',
          data: { text: 'Alpha' },
        },
        {
          type: 'paragraph',
          data: { text: 'Beta' },
        },
        {
          type: 'paragraph',
          data: { text: 'Gamma' },
        },
      ];

      await createBlok(page, {
        data: { blocks },
      });

      // Get IDs before duplication
      const idsBefore = await page.evaluate(() =>
        window.blokInstance?.save().then(data => data.blocks.map(b => b.id))
      );

      // Hover over the second block
      const betaBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Beta' });

      await betaBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Duplicate to after Gamma (bottom of Gamma)
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Gamma' });

      await performAltDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify original blocks preserved their IDs
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      // Original blocks should have same IDs
      expect(savedData?.blocks[0].id).toBe(idsBefore?.[0]); // Alpha
      expect(savedData?.blocks[1].id).toBe(idsBefore?.[1]); // Beta
      expect(savedData?.blocks[2].id).toBe(idsBefore?.[2]); // Gamma

      // Duplicate should have new ID
      expect(savedData?.blocks[3].id).not.toBe(idsBefore?.[1]);
      expect(savedData?.blocks[3].data.text).toBe('Beta');
    });

    test('should not duplicate when dropping without Alt key', async ({ page }) => {
      const blocks = [
        {
          type: 'paragraph',
          data: { text: 'First' },
        },
        {
          type: 'paragraph',
          data: { text: 'Second' },
        },
      ];

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over first block
      const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First' });

      await firstBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second' });

      // Normal drag (no Alt) - should move, not duplicate
      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify: Only 2 blocks (moved, not duplicated)
      await expect(page.getByTestId('block-wrapper')).toHaveCount(2);
      await expect(page.getByTestId('block-wrapper')).toHaveText([
        'Second',
        'First', // Moved to end
      ]);
    });

    test('should select all duplicated blocks after duplication', async ({ page }) => {
      const blocks = [
        {
          type: 'paragraph',
          data: { text: 'Block A' },
        },
        {
          type: 'paragraph',
          data: { text: 'Block B' },
        },
        {
          type: 'paragraph',
          data: { text: 'Block C' },
        },
      ];

      await createBlok(page, {
        data: { blocks },
      });

      // Select blocks A and B
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }
        const blockSelection = (blok as unknown as { module: { blockSelection: { selectBlockByIndex: (index: number) => void } } }).module.blockSelection;

        blockSelection.selectBlockByIndex(0);
        blockSelection.selectBlockByIndex(1);
      });

      // Hover over the first block A (original, not duplicate)
      const blockA = page.getByTestId('block-wrapper').filter({ hasText: 'Block A' });

      await blockA.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Duplicate to bottom of block C
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Block C' });

      await performAltDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify duplicated blocks are selected (have selected attribute)
      const selectedBlocks = page.locator('[data-blok-selected="true"]');

      await expect(selectedBlocks).toHaveCount(2);

      // The selected blocks should be the duplicates - verify by checking their text
      await expect(selectedBlocks).toHaveText([
        'Block A',
        'Block B',
      ]);

      // Verify the originals are NOT selected
      const originalBlockA = page.getByTestId('block-wrapper').filter({ hasText: 'Block A' }).and(page.locator(':not([data-blok-selected="true"])'));
      const originalBlockB = page.getByTestId('block-wrapper').filter({ hasText: 'Block B' }).and(page.locator(':not([data-blok-selected="true"])'));

      await expect(originalBlockA).toHaveCount(1);
      await expect(originalBlockB).toHaveCount(1);
    });

    test('should duplicate list items with their nested children', async ({ page }) => {
      // Create a nested list:
      // - Parent (depth 0) <- duplicate this
      //   - Child (depth 1)
      // - Sibling (depth 0)
      const blocks = [
        {
          type: 'list',
          data: { text: 'Parent', style: 'unordered' },
        },
        {
          type: 'list',
          data: { text: 'Child', style: 'unordered', depth: 1 },
        },
        {
          type: 'list',
          data: { text: 'Sibling', style: 'unordered' },
        },
      ];

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over the parent block
      const parentBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Parent' });

      await parentBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Duplicate to bottom of sibling
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Sibling' });

      await performAltDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Verify: Parent and Child duplicated together
      await expect(page.getByTestId('block-wrapper')).toHaveCount(5);

      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(savedData?.blocks).toHaveLength(5);
      expect(savedData?.blocks[0].data.text).toBe('Parent');
      expect(savedData?.blocks[1].data.text).toBe('Child');
      expect(savedData?.blocks[2].data.text).toBe('Sibling');
      expect(savedData?.blocks[3].data.text).toBe('Parent'); // Duplicate
      expect(savedData?.blocks[4].data.text).toBe('Child'); // Duplicate child
    });

    test('should cancel duplication if drop target is invalid', async ({ page }) => {
      const blocks = [
        {
          type: 'paragraph',
          data: { text: 'Only block' },
        },
      ];

      await createBlok(page, {
        data: { blocks },
      });

      // Hover over the block
      const block = page.getByTestId('block-wrapper').filter({ hasText: 'Only block' });

      await block.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Get positions
      const settingsBox = await getBoundingBox(settingsButton);

      // Start drag
      await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
      await page.mouse.down();

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow drag init
      await page.waitForTimeout(50);

      // Move to trigger drag threshold but stay on same block (invalid target)
      await page.mouse.move(settingsBox.x + 20, settingsBox.y + 20, { steps: 10 });

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow drag
      await page.waitForTimeout(50);

      // Release with Alt held - but no valid target
      await page.keyboard.down('Alt');
      await page.mouse.up();
      await page.keyboard.up('Alt');

      // eslint-disable-next-line playwright/no-wait-for-timeout -- Allow state updates
      await page.waitForTimeout(100);

      // Verify: No duplication occurred (still just 1 block)
      await expect(page.getByTestId('block-wrapper')).toHaveCount(1);
    });
  });
});
