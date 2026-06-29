import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from './helpers/ensure-build';
import { DATA_ATTR, createSelector } from '../../../src/components/constants';

const HOLDER_ID = 'blok';
const SETTINGS_BUTTON_SELECTOR = `${createSelector(DATA_ATTR.interface)} [data-blok-testid="settings-toggler"]`;

/**
 * Helper function to get block text data from saved output.
 * @param block - Output block data
 * @returns The text property from block data
 */
const getBlockText = (block: { data: unknown } | undefined): string => {
  if (!block) {
    throw new Error('Block is undefined');
  }
  return (block.data as { text: string }).text;
};

/**
 * Helper function to get block depth from saved output.
 * @param block - Output block data
 * @returns The depth property from block data
 */
const getBlockDepth = (block: { data: unknown } | undefined): number | undefined => {
  if (!block) {
    return undefined;
  }
  return (block.data as { text?: string; depth?: number }).depth;
};

/**
 * Asserts a saved block is structurally nested one level under a list block.
 *
 * Nesting moved from the removed flat `indent` field to the structural
 * parentId/contentIds model: the child carries a `parent` id, and the parent
 * (a list block) lists the child in its `content`. This mirrors the canonical
 * toggle-nesting assertions (`para.parent === toggle.id`,
 * `toggle.content.toContain(para.id)`).
 * @param savedData - Full saved output.
 * @param block - The saved block expected to be nested under a list.
 */
const expectNestedUnderList = (
  savedData: OutputData | undefined,
  block: OutputData['blocks'][number] | undefined
): void => {
  expect(block?.parent).toBeTruthy();

  const parent = savedData?.blocks.find(candidate => candidate.id === block?.parent);

  expect(parent?.type).toBe('list');
  expect(parent?.content).toContain(block?.id);
};

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
  targetVerticalPosition: 'top' | 'bottom',
  /**
   * Optional fraction of the target's height to probe for a 'top' drop instead
   * of the default 1px-from-the-edge. A taller block (e.g. a checklist item,
   * whose 20px checkbox makes its hit-box taller than a plain paragraph) can put
   * the 1px edge in a margin/padding gap where elementFromPoint resolves to an
   * adjacent block. A small fraction (e.g. 0.25) stays unambiguously in the top
   * half while landing on the block's own content. No effect on 'bottom' drops.
   */
  topInsetFraction?: number
): Promise<void> => {
  const sourceBox = await getBoundingBox(sourceLocator);
  const targetBox = await getBoundingBox(targetLocator);

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  /**
   * For edge detection:
   * For 'top', we position just 1px from the top edge to ensure unambiguous edge detection
   * (or at `topInsetFraction` of the height when supplied, for taller hit-boxes).
   * For 'bottom', we position just 1px from the bottom edge.
   */
  const targetY = targetVerticalPosition === 'top'
    ? targetBox.y + (topInsetFraction !== undefined ? targetBox.height * topInsetFraction : 1)
    : targetBox.y + targetBox.height - 1; // Very close to the bottom edge

  /**
   * Perform pointer-based drag using Playwright's mouse API.
   * This matches how our custom DragManager handles drag operations.
   * Note: data-blok-dragging is only set AFTER mouse movement passes the drag threshold.
   */
  // Move to source and press down
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();

  // Move to target position with steps to trigger drag threshold
  // The data-blok-dragging attribute is set during this movement
  await page.mouse.move(targetX, targetY, { steps: 15 });

  // Wait for drag state to be set (confirms drag threshold was passed)
  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[data-blok-interface=blok]');
    return wrapper?.getAttribute('data-blok-dragging') === 'true';
  }, { timeout: 2000 });

  // Release to complete the drop
  await page.mouse.up();

  // Wait for drag state to be cleared (drop completed)
  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[data-blok-interface=blok]');
    return wrapper?.getAttribute('data-blok-dragging') !== 'true';
  }, { timeout: 2000 });

  // The drop motion (ghost settle) finishes before assertions run.
  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
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

  // Move to target position with steps to trigger drag threshold
  await page.mouse.move(targetX, targetY, { steps: 15 });

  // Wait for drag state to be set (confirms drag threshold was passed)
  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[data-blok-interface=blok]');
    return wrapper?.getAttribute('data-blok-dragging') === 'true';
  }, { timeout: 2000 });

  // Hold Alt key to trigger duplication mode
  await page.keyboard.down('Alt');

  // Wait for duplicating state to be set
  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[data-blok-interface=blok]');
    return wrapper?.getAttribute('data-blok-duplicating') === 'true';
  }, { timeout: 2000 });

  await page.mouse.up();

  await page.keyboard.up('Alt');

  // Wait for drag state to be cleared (duplication completed)
  await page.waitForFunction(() => {
    const wrapper = document.querySelector('[data-blok-interface=blok]');
    return wrapper?.getAttribute('data-blok-dragging') !== 'true';
  }, { timeout: 2000 });

  // The drop motion (ghost settle) finishes before assertions run.
  await page.waitForFunction(
    () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
    { timeout: 2000 }
  );
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

  test('@smoke should move block from first position to the last', async ({ page }) => {
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

    expect(getBlockText(savedData?.blocks[0])).toBe('Second block');
    expect(getBlockText(savedData?.blocks[1])).toBe('Third block');
    expect(getBlockText(savedData?.blocks[2])).toBe('First block');
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

    expect(getBlockText(savedData?.blocks[0])).toBe('Third block');
    expect(getBlockText(savedData?.blocks[1])).toBe('First block');
    expect(getBlockText(savedData?.blocks[2])).toBe('Second block');
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

    expect(getBlockText(savedData?.blocks[0])).toBe('Block 0');
    expect(getBlockText(savedData?.blocks[1])).toBe('Block 4');
    expect(getBlockText(savedData?.blocks[2])).toBe('Block 1');
    expect(getBlockText(savedData?.blocks[3])).toBe('Block 2');
    expect(getBlockText(savedData?.blocks[4])).toBe('Block 3');
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

    expect(getBlockText(savedData?.blocks[0])).toBe('Block 1');
    expect(getBlockText(savedData?.blocks[1])).toBe('Block 3');
    expect(getBlockText(savedData?.blocks[2])).toBe('Block 0');
    expect(getBlockText(savedData?.blocks[3])).toBe('Block 2');
    expect(getBlockText(savedData?.blocks[4])).toBe('Block 4');
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

    expect(getBlockText(savedData?.blocks[0])).toBe('Block 0');
    expect(getBlockText(savedData?.blocks[1])).toBe('Block 1');
    expect(getBlockText(savedData?.blocks[2])).toBe('Block 2');
    expect(getBlockText(savedData?.blocks[3])).toBe('Block 3');
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

    // Block-select just block 1 via the BlockSelection API. A plain click only
    // places a caret (block.selected stays false), which routes the drag through
    // the SINGLE-block path — not the multi-block path this test is named for.
    // Selecting through the module sets block.selected = true so the drag goes
    // through selectedBlocks (the multi-block path) with a single member.
    await page.evaluate(() => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }
      const blockSelection = (blok as unknown as { module: { blockSelection: { selectBlockByIndex: (index: number) => void } } }).module.blockSelection;

      blockSelection.selectBlockByIndex(1);
    });

    const block1 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 1' });

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

    expect(getBlockText(savedData?.blocks[0])).toBe('Block 1');
    expect(getBlockText(savedData?.blocks[1])).toBe('Block 0');
    expect(getBlockText(savedData?.blocks[2])).toBe('Block 2');
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

    // Move to trigger drag threshold
    await page.mouse.move(settingsBox.x + 20, settingsBox.y + 20, { steps: 5 });

    // Move cursor to near the bottom edge of the viewport (within 50px auto-scroll zone)
    await page.mouse.move(settingsBox.x, viewportHeight - 25, { steps: 10 });

    // Wait for auto-scroll to happen (scroll position changes)
    await page.waitForFunction((initialY) => window.scrollY > initialY, initialScrollY, { timeout: 5000 });

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

    // Move to the top half of the first block
    await page.mouse.move(
      firstBlockBox.x + firstBlockBox.width / 2,
      firstBlockBox.y + 1, // Very close to top edge
      { steps: 15 }
    );

    // Wait for drop indicator to appear on first block
    await page.waitForFunction(() => {
      return document.querySelector('[data-drop-indicator="top"]') !== null;
    }, { timeout: 2000 });

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

    // Move to the top half of the second block
    await page.mouse.move(
      secondBlockBox.x + secondBlockBox.width / 2,
      secondBlockBox.y + 1, // Very close to top edge
      { steps: 15 }
    );

    // Wait for drop indicator to appear
    await page.waitForFunction(() => {
      return document.querySelector('[data-drop-indicator]') !== null;
    }, { timeout: 2000 });

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

    // Move over bottom half of block 0
    await page.mouse.move(
      block0Box.x + block0Box.width / 2,
      block0Box.y + block0Box.height - 1,
      { steps: 10 }
    );

    // Wait for indicator to appear
    await page.waitForFunction(() => {
      return document.querySelector('[data-drop-indicator]') !== null;
    }, { timeout: 2000 });

    let allIndicators = page.locator('[data-drop-indicator]');

    await expect(allIndicators).toHaveCount(1);

    // Move over top half of block 1 (should show indicator on block 0)
    await page.mouse.move(
      block1Box.x + block1Box.width / 2,
      block1Box.y + 1,
      { steps: 10 }
    );

    // Wait for indicator to update
    await page.waitForFunction(() => {
      return document.querySelector('[data-drop-indicator]') !== null;
    }, { timeout: 2000 });

    allIndicators = page.locator('[data-drop-indicator]');
    await expect(allIndicators).toHaveCount(1);

    // Move over bottom half of block 1
    await page.mouse.move(
      block1Box.x + block1Box.width / 2,
      block1Box.y + block1Box.height - 1,
      { steps: 10 }
    );

    // Wait for indicator to update
    await page.waitForFunction(() => {
      return document.querySelector('[data-drop-indicator]') !== null;
    }, { timeout: 2000 });

    allIndicators = page.locator('[data-drop-indicator]');
    await expect(allIndicators).toHaveCount(1);

    // Move over top half of block 2 (should show indicator on block 1)
    await page.mouse.move(
      block2Box.x + block2Box.width / 2,
      block2Box.y + 1,
      { steps: 10 }
    );

    // Wait for indicator to update
    await page.waitForFunction(() => {
      return document.querySelector('[data-drop-indicator]') !== null;
    }, { timeout: 2000 });

    allIndicators = page.locator('[data-drop-indicator]');
    await expect(allIndicators).toHaveCount(1);

    // Clean up
    await page.mouse.up();
  });

  test('should auto-scroll viewport up when dragging near top edge', async ({ page }) => {
    // Create many blocks to ensure the page is scrollable.
    // 35 blocks are needed because reduced paragraph margins (mt-px) and line-height
    // mean 20 blocks no longer generate enough page height to scroll 300px in a 1280×720 viewport.
    const blocks = Array.from({ length: 35 }, (_, i) => ({
      type: 'paragraph',
      data: { text: `Block ${i}` },
    }));

    await createBlok(page, {
      data: { blocks },
    });

    // Scroll down first so we have room to scroll up
    await page.evaluate(() => window.scrollTo(0, 300));

    // Wait for scroll to complete
    await page.waitForFunction(() => window.scrollY >= 300, { timeout: 2000 });

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

    // Move to trigger drag threshold
    await page.mouse.move(settingsBox.x + 20, settingsBox.y - 20, { steps: 5 });

    // Move cursor to near the top edge of the viewport (within 50px auto-scroll zone)
    await page.mouse.move(settingsBox.x, 25, { steps: 10 });

    // Wait for auto-scroll to happen (scroll position decreases)
    await page.waitForFunction((initialY) => window.scrollY < initialY, initialScrollY, { timeout: 5000 });

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

      expect(getBlockText(savedData?.blocks[0])).toBe('Second');
      expect(getBlockText(savedData?.blocks[1])).toBe('First');
      expect(getBlockText(savedData?.blocks[2])).toBe('Nested A');
      expect(getBlockText(savedData?.blocks[3])).toBe('Nested B');
    });

    test('renumbers the source ordered list when its middle item is dragged into another list', async ({ page }) => {
      // Two separate ordered lists (split by a paragraph). Drag the middle item
      // of the first list into the second list. The first list must renumber the
      // item left behind — regression: moved() only renumbered the destination
      // group, so "Alpha three" stayed "3." instead of becoming "2.".
      const blocks: OutputData['blocks'] = [
        { id: 'a1', type: 'list', data: { text: 'Alpha one', style: 'ordered' } },
        { id: 'a2', type: 'list', data: { text: 'Alpha two', style: 'ordered' } },
        { id: 'a3', type: 'list', data: { text: 'Alpha three', style: 'ordered' } },
        { id: 'sep', type: 'paragraph', data: { text: 'separator' } },
        { id: 'b1', type: 'list', data: { text: 'Bravo one', style: 'ordered' } },
        { id: 'b2', type: 'list', data: { text: 'Bravo two', style: 'ordered' } },
      ];

      await createBlok(page, {
        data: { blocks },
      });

      const markerFor = (text: string): ReturnType<Page['locator']> =>
        page.getByTestId('block-wrapper').filter({ hasText: text }).locator('[data-list-marker]');

      // Sanity: first list is 1./2./3. before the drag.
      await expect(markerFor('Alpha three')).toHaveText('3.');

      // Drag the middle item ("Alpha two") to the bottom of the second list.
      const middleItem = page.getByTestId('block-wrapper').filter({ hasText: 'Alpha two' });

      await middleItem.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Bravo two' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Source list renumbers: the item left behind moves from 3. to 2.
      await expect(markerFor('Alpha one')).toHaveText('1.');
      await expect(markerFor('Alpha three')).toHaveText('2.');

      // Destination list absorbs the moved item as the third entry.
      await expect(markerFor('Bravo one')).toHaveText('1.');
      await expect(markerFor('Bravo two')).toHaveText('2.');
      await expect(markerFor('Alpha two')).toHaveText('3.');
    });

    test('should preserve depth of deeply nested children when dragging parent subtree', async ({ page }) => {
      // Create a list with deeply nested children:
      // - First (depth 0) <- drag this
      //   - Nested A (depth 1) <- comes along
      //     - Deep A1 (depth 2) <- must keep depth 2, not collapse to 1
      // - Second (depth 0)
      //
      // Bug: moveBlocksDown processes in reverse order (DeepA1 → NestedA → First).
      // When DeepA1 fires its `moved()` hook, Second is still the previous block (depth 0),
      // so maxAllowedDepth=1 and depth 2 is incorrectly capped to 1.
      const blocks = createListBlocks([
        { text: 'First' },
        { text: 'Nested A', depth: 1 },
        { text: 'Deep A1', depth: 2 },
        { text: 'Second' },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      const firstBlock = page.getByTestId('block-wrapper').filter({ hasText: 'First' });

      await firstBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      const savedData = await page.evaluate(() => window.blokInstance?.save());

      // Order: Second, First, Nested A, Deep A1
      expect(getBlockText(savedData?.blocks[0])).toBe('Second');
      expect(getBlockText(savedData?.blocks[1])).toBe('First');
      expect(getBlockText(savedData?.blocks[2])).toBe('Nested A');
      expect(getBlockText(savedData?.blocks[3])).toBe('Deep A1');

      // Depths must be preserved — the subtree structure must survive drag & drop
      expect(getBlockDepth(savedData?.blocks[1])).toBeUndefined(); // First: depth 0 (omitted)
      expect(getBlockDepth(savedData?.blocks[2])).toBe(1);         // Nested A: depth 1
      expect(getBlockDepth(savedData?.blocks[3])).toBe(2);         // Deep A1: depth 2 ← this fails without the fix
    });

    // Previously skipped due to toolbar content offset (translateX) interfering with drag
    // detection for nested list items. Fixed in commit 9d7f0c49 by restoring drag handle
    // reachability for all block types (toolbar/positioning.ts applyContentOffset fix).
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

      expect(getBlockText(savedData?.blocks[0])).toBe('First');
      expect(getBlockText(savedData?.blocks[1])).toBe('Nested B');
      expect(getBlockText(savedData?.blocks[2])).toBe('Nested A');
      expect(getBlockText(savedData?.blocks[3])).toBe('Deep A1');
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

      expect(getBlockText(savedData?.blocks[0])).toBe('First');
      expect(getBlockText(savedData?.blocks[1])).toBe('Nested A');
      expect(getBlockText(savedData?.blocks[2])).toBe('Nested B');
      expect(getBlockText(savedData?.blocks[3])).toBe('Deep A1');
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

      expect(getBlockText(savedData?.blocks[0])).toBe('Second');
      expect(getBlockText(savedData?.blocks[1])).toBe('Third');
      expect(getBlockText(savedData?.blocks[2])).toBe('First');
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

      expect(getBlockText(savedData?.blocks[0])).toBe('First');
      expect(getBlockText(savedData?.blocks[1])).toBe('Second');
      expect(getBlockText(savedData?.blocks[2])).toBe('Fourth');
      expect(getBlockText(savedData?.blocks[3])).toBe('Third');

      // Fourth should have been adjusted to depth 1
      expect(getBlockDepth(savedData?.blocks[2])).toBe(1);
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

      expect(getBlockText(savedData?.blocks[0])).toBe('Parent');
      expect(getBlockText(savedData?.blocks[1])).toBe('Child 1');
      expect(getBlockText(savedData?.blocks[2])).toBe('Child 2');
      expect(getBlockText(savedData?.blocks[3])).toBe('Child 3');
      expect(getBlockText(savedData?.blocks[4])).toBe('Target');
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

      expect(getBlockText(savedData?.blocks[0])).toBe('Second');
      expect(getBlockText(savedData?.blocks[1])).toBe('First');
      expect(getBlockText(savedData?.blocks[2])).toBe('Child');
      expect(getBlockText(savedData?.blocks[3])).toBe('Grandchild');
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

      expect(getBlockText(savedData?.blocks[0])).toBe('Child B');
      expect(getBlockText(savedData?.blocks[1])).toBe('Second');
      expect(getBlockText(savedData?.blocks[2])).toBe('First');
      expect(getBlockText(savedData?.blocks[3])).toBe('Child A');
    });

    /**
     * Regression (commit 7baeee54): dropping a top-level list item at the END of
     * a nested sub-list it ALREADY follows lands it at the slot it already
     * occupies (fromIndex === toIndex). The flat-array move is a no-op, and the
     * depth-recalculating moved() hook used to be skipped — so the item kept its
     * depth and the drop silently did nothing ("the item does not get dropped").
     *
     * Regression (commit aeaa598f): the depth DID need to change, and when it
     * does the unordered bullet glyph (•/◦/▪) must refresh — adjustDepthTo only
     * updated margin + data-depth, leaving a depth-2 item showing the depth-0 "•".
     */
    test('nests a top-level item dropped at the end of a deeper sub-list (no-op slot) and refreshes its bullet glyph', async ({ page }) => {
      // - First (depth 0)
      //   - Nested A (depth 1)
      //     - Deep A1 (depth 2)
      // - Second (depth 0) <- already right after Deep A1; drop on Deep A1's bottom
      const blocks = createListBlocks([
        { text: 'First' },
        { text: 'Nested A', depth: 1 },
        { text: 'Deep A1', depth: 2 },
        { text: 'Second' },
      ]);

      await createBlok(page, {
        data: { blocks },
      });

      const secondBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second' });

      await secondBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drop at the bottom edge of "Deep A1" — the end of the nested sub-list.
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Deep A1' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      const savedData = await page.evaluate(() => window.blokInstance?.save());

      // Order is unchanged (it was already last), but the depth must now match the
      // end of the nested list — the drop must actually take effect.
      expect(getBlockText(savedData?.blocks[0])).toBe('First');
      expect(getBlockText(savedData?.blocks[1])).toBe('Nested A');
      expect(getBlockText(savedData?.blocks[2])).toBe('Deep A1');
      expect(getBlockText(savedData?.blocks[3])).toBe('Second');
      expect(getBlockDepth(savedData?.blocks[3])).toBe(2); // ← no-op without the fix

      // The bullet glyph must reflect the new depth (depth 2 → "▪"), not the stale "•".
      const droppedMarker = secondBlock.locator('[data-list-marker]');

      await expect(droppedMarker).toHaveText('▪');
    });

    test('nests a top-level ORDERED item dropped at the end of a nested sub-list and renumbers it', async ({ page }) => {
      // 1. First (depth 0)
      //    a. Second (depth 1)
      // 2. Third (depth 0) <- already right after Second; drop on Second's bottom
      const blocks: OutputData['blocks'] = [
        { id: 'ord-0', type: 'list', data: { text: 'First', style: 'ordered' } },
        { id: 'ord-1', type: 'list', data: { text: 'Second', style: 'ordered', depth: 1 } },
        { id: 'ord-2', type: 'list', data: { text: 'Third', style: 'ordered' } },
      ];

      await createBlok(page, {
        data: { blocks },
      });

      const thirdBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third' });

      await thirdBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drop at the bottom edge of "Second" — the end of the nested sub-list.
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second' });

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(getBlockText(savedData?.blocks[0])).toBe('First');
      expect(getBlockText(savedData?.blocks[1])).toBe('Second');
      expect(getBlockText(savedData?.blocks[2])).toBe('Third');
      expect(getBlockDepth(savedData?.blocks[2])).toBe(1); // ← no-op without the fix

      // Nested ordered item renumbers from "2." to the second sibling "b.".
      const droppedMarker = thirdBlock.locator('[data-list-marker]');

      await expect(droppedMarker).toHaveText('b.');
    });

    test('nests a non-list block dropped at the bottom edge of a nested item (nest from the bottom)', async ({ page }) => {
      // Nest-from-the-bottom: dropped between a depth-1 item and a depth-0 item, a
      // non-list block appends into the nested sub-list at depth 1 — the deeper
      // previous item wins; a shallower next item must NOT pull it back to root
      // (prev(1), dropped(1), next(0) is a valid structure). The indicator must
      // reflect that: tucked under the nested item (indent lead-in present,
      // side-left > 0), and the block saves with indent 1.
      const blocks: OutputData['blocks'] = [
        { id: 'h1', type: 'header', data: { text: 'Section', level: 2 } },
        { id: 'l1', type: 'list', data: { text: 'First step', style: 'ordered' } },
        { id: 'l2', type: 'list', data: { text: 'Second step', style: 'ordered', depth: 1 } },
        { id: 'l3', type: 'list', data: { text: 'Third step', style: 'ordered' } },
      ];

      await createBlok(page, {
        data: { blocks },
      });

      // Grab the header's drag handle.
      const headerBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Section' });

      await headerBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      const settingsBox = await getBoundingBox(settingsButton);
      // Hover the top half of "Third step" (depth 0) — this normalises to the
      // bottom edge of the nested "Second step" (depth 1), the exact drop slot
      // from the report: the gap at the END of the nested sub-list.
      const thirdItem = page.getByTestId('block-wrapper').filter({ hasText: 'Third step' });
      const thirdBox = await getBoundingBox(thirdItem);

      await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        thirdBox.x + thirdBox.width / 2,
        thirdBox.y + 3,
        { steps: 15 }
      );

      await page.waitForFunction(() => {
        return document.querySelector('[data-drop-indicator]') !== null;
      }, { timeout: 2000 });

      // The indicator must be tucked under the nested item: an indent lead-in
      // segment is present and the blue line starts offset from the editor edge
      // (side-left > 0). The drop applies the SAME depth, so the preview is honest.
      const indicator = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-drop-indicator]');

        if (!el) {
          return null;
        }

        return {
          hasLead: el.hasAttribute('data-drop-indicator-lead'),
          sideLeft: parseFloat(el.style.getPropertyValue('--drop-indicator-side-left')),
        };
      });

      expect(indicator).not.toBeNull();
      expect(indicator?.hasLead).toBe(true);
      expect(indicator?.sideLeft).toBeGreaterThan(0);

      await page.mouse.up();

      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');

        return wrapper?.getAttribute('data-blok-dragging') !== 'true';
      }, { timeout: 2000 });

      // The header lands between the two list items and NESTS at depth 1.
      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expect(getBlockText(savedData?.blocks[0])).toBe('First step');
      expect(getBlockText(savedData?.blocks[1])).toBe('Second step');
      expect(getBlockText(savedData?.blocks[2])).toBe('Section');
      expect(getBlockText(savedData?.blocks[3])).toBe('Third step');
      // Nested → the header is a structural child of the depth-0 list head.
      expectNestedUnderList(savedData, savedData?.blocks[2]);

      // The holder is visually indented (data-blok-depth set to level 1).
      const droppedHolder = page.getByTestId('block-wrapper').filter({ hasText: 'Section' });

      await expect(droppedHolder).toHaveAttribute('data-blok-depth', '1');
    });

    /**
     * Drops a non-list block into a clearly-nested slot (top edge of the nested
     * item, i.e. between the depth-0 head and the depth-1 item) and asserts it
     * nests to depth 1: indented holder (data-blok-depth=1) and a structural
     * parent/content link in saved output. Runs for every block type × list
     * style so ANY block nests inside ANY list.
     */
    const nestsIntoList = (
      label: string,
      sourceType: string,
      sourceData: Record<string, unknown>,
      sourceText: string,
      listStyle: 'ordered' | 'unordered' | 'checklist'
    ): void => {
      test(`nests a ${label} into a ${listStyle} list at the nested level`, async ({ page }) => {
        const blocks: OutputData['blocks'] = [
          { id: 'l1', type: 'list', data: { text: 'Head', style: listStyle } },
          { id: 'l2', type: 'list', data: { text: 'Nested', style: listStyle, depth: 1 } },
          { id: 's1', type: sourceType, data: sourceData },
        ];

        await createBlok(page, { data: { blocks } });

        const sourceBlock = page.getByTestId('block-wrapper').filter({ hasText: sourceText });

        await sourceBlock.hover();

        const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

        await expect(settingsButton).toBeVisible();

        // Drop on the TOP half of the nested item → slot between Head (depth 0)
        // and Nested (depth 1) → matches the deeper next item → depth 1. Probe at
        // 25% of the item height (still the top half) rather than 1px from the
        // edge: a checklist item's checkbox makes its hit-box taller, so the 1px
        // edge can fall in a gap that resolves to the wrong block.
        const nestedItem = page.getByTestId('block-wrapper').filter({ hasText: 'Nested' });

        await performDragDrop(page, settingsButton, nestedItem, 'top');

        const savedData = await page.evaluate(() => window.blokInstance?.save());

        // Slot order: the source lands between the two list items at index 1,
        // flanked by the list head and the nested item. (List-item text is not
        // asserted here — some styles, e.g. checklist, store it differently.)
        expect(savedData?.blocks).toHaveLength(3);
        expect(savedData?.blocks[0].type).toBe('list');
        expect(savedData?.blocks[1].type).toBe(sourceType);
        expect(getBlockText(savedData?.blocks[1])).toBe(sourceText);
        expect(savedData?.blocks[2].type).toBe('list');
        // The dropped block nested to depth 1: a structural child of the list head.
        expectNestedUnderList(savedData, savedData?.blocks[1]);

        // The holder is visually indented (margin + data-blok-depth attribute).
        const droppedHolder = page.getByTestId('block-wrapper').filter({ hasText: sourceText });

        await expect(droppedHolder).toHaveAttribute('data-blok-depth', '1');
      });
    };

    nestsIntoList('header', 'header', { text: 'Movable header', level: 2 }, 'Movable header', 'unordered');
    nestsIntoList('paragraph', 'paragraph', { text: 'Movable paragraph' }, 'Movable paragraph', 'ordered');
    nestsIntoList('quote', 'quote', { text: 'Movable quote', caption: '' }, 'Movable quote', 'checklist');

    test('a nested block persists its parent link across a save/reload round-trip', async ({ page }) => {
      const blocks: OutputData['blocks'] = [
        { id: 'l1', type: 'list', data: { text: 'Head', style: 'unordered' } },
        { id: 'l2', type: 'list', data: { text: 'Nested', style: 'unordered', depth: 1 } },
        { id: 's1', type: 'header', data: { text: 'Reloadable', level: 2 } },
      ];

      await createBlok(page, { data: { blocks } });

      const sourceBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Reloadable' });

      await sourceBlock.hover();
      await expect(page.locator(SETTINGS_BUTTON_SELECTOR)).toBeVisible();

      const nestedItem = page.getByTestId('block-wrapper').filter({ hasText: 'Nested' });

      await performDragDrop(page, page.locator(SETTINGS_BUTTON_SELECTOR), nestedItem, 'top');

      const savedData = await page.evaluate(() => window.blokInstance?.save());

      expectNestedUnderList(savedData, savedData?.blocks?.find(b => getBlockText(b) === 'Reloadable'));

      // Re-create the editor from the saved output and confirm the nesting survives.
      await createBlok(page, { data: savedData });

      const reloadedHolder = page.getByTestId('block-wrapper').filter({ hasText: 'Reloadable' });

      await expect(reloadedHolder).toHaveAttribute('data-blok-depth', '1');

      const reSaved = await page.evaluate(() => window.blokInstance?.save());

      expectNestedUnderList(reSaved, reSaved?.blocks?.find(b => getBlockText(b) === 'Reloadable'));
    });
  });

  test.describe('toolbar visibility during drag', () => {
    test('should not show toolbar when hovering over blocks during drag', async ({ page }) => {
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

      // Get positions
      const settingsBox = await getBoundingBox(settingsButton);
      const secondBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second block' });
      const secondBlockBox = await getBoundingBox(secondBlock);

      // Start drag
      await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
      await page.mouse.down();

      // Move to trigger drag threshold
      await page.mouse.move(
        secondBlockBox.x + secondBlockBox.width / 2,
        secondBlockBox.y + secondBlockBox.height / 2,
        { steps: 15 }
      );

      // Verify dragging state is active
      const blokWrapper = page.locator('[data-blok-dragging="true"]');

      await expect(blokWrapper).toHaveCount(1);

      // Now hover over the third block during drag
      const thirdBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third block' });
      const thirdBlockBox = await getBoundingBox(thirdBlock);

      await page.mouse.move(
        thirdBlockBox.x + thirdBlockBox.width / 2,
        thirdBlockBox.y + thirdBlockBox.height / 2,
        { steps: 5 }
      );

      // Verify toolbar is NOT visible on third block during drag
      // The toolbar should be closed/hidden during drag operations
      const toolbar = page.locator('[data-blok-testid="toolbar"][data-blok-opened="true"]');

      await expect(toolbar).toHaveCount(0);

      // Clean up
      await page.mouse.up();
    });

    test('should not open toolbox when hovering over blocks during drag', async ({ page }) => {
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

      // Get positions
      const settingsBox = await getBoundingBox(settingsButton);
      const secondBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second block' });
      const thirdBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third block' });
      const secondBlockBox = await getBoundingBox(secondBlock);
      const thirdBlockBox = await getBoundingBox(thirdBlock);

      // Start drag
      await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
      await page.mouse.down();

      // Move to trigger drag threshold
      await page.mouse.move(
        secondBlockBox.x + secondBlockBox.width / 2,
        secondBlockBox.y + secondBlockBox.height / 2,
        { steps: 15 }
      );

      // Verify dragging state is active
      const blokWrapper = page.locator('[data-blok-dragging="true"]');

      await expect(blokWrapper).toHaveCount(1);

      // Move over multiple blocks during drag to simulate user hovering
      await page.mouse.move(
        thirdBlockBox.x + thirdBlockBox.width / 2,
        thirdBlockBox.y + thirdBlockBox.height / 2,
        { steps: 5 }
      );

      // Back to second block
      await page.mouse.move(
        secondBlockBox.x + secondBlockBox.width / 2,
        secondBlockBox.y + secondBlockBox.height / 2,
        { steps: 5 }
      );

      // Verify toolbox is NOT visible during drag
      const toolbox = page.locator('[data-blok-testid="toolbox"]');

      await expect(toolbox).toBeHidden();

      // Clean up
      await page.mouse.up();
    });

    test('should show toolbar again after drag completes', async ({ page }) => {
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

      // Perform drag and drop
      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // After drag completes, hover over a block
      const secondBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second block' });

      await secondBlock.hover();

      // Verify toolbar is visible again (wait for it to appear)
      const toolbar = page.locator('[data-blok-testid="toolbar"][data-blok-opened="true"]');

      await expect(toolbar).toHaveCount(1);
    });

    test('should show toolbar again after drag is cancelled', async ({ page }) => {
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

      // Get positions
      const settingsBox = await getBoundingBox(settingsButton);
      const secondBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Second block' });
      const secondBlockBox = await getBoundingBox(secondBlock);

      // Start drag
      await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
      await page.mouse.down();

      // Move to second block to trigger drag threshold
      await page.mouse.move(
        secondBlockBox.x + secondBlockBox.width / 2,
        secondBlockBox.y + secondBlockBox.height / 2,
        { steps: 15 }
      );

      // Verify dragging state is active
      const blokWrapper = page.locator('[data-blok-dragging="true"]');

      await expect(blokWrapper).toHaveCount(1);

      // Cancel drag with Escape
      await page.keyboard.press('Escape');

      // Wait for dragging state to be cleared
      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');
        return wrapper?.getAttribute('data-blok-dragging') !== 'true';
      }, { timeout: 2000 });

      // The drop motion (ghost settle) finishes before assertions run.
      await page.waitForFunction(
        () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
        { timeout: 2000 }
      );

      // Move mouse outside the editor first, then hover over a different block
      // This ensures a fresh BlockHovered event is triggered
      await page.mouse.move(0, 0);

      // Now hover over the third block (different from where we were)
      const thirdBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Third block' });

      await thirdBlock.hover();

      // Verify toolbar is visible again
      const toolbar = page.locator('[data-blok-testid="toolbar"][data-blok-opened="true"]');

      await expect(toolbar).toHaveCount(1);
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
      expect(getBlockText(savedData?.blocks[0])).toBe('First block');
      expect(getBlockText(savedData?.blocks[1])).toBe('Second block');
      expect(getBlockText(savedData?.blocks[2])).toBe('Third block');
      expect(getBlockText(savedData?.blocks[3])).toBe('First block');

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
      expect(getBlockText(savedData?.blocks[4])).toBe('Block 1');
      expect(getBlockText(savedData?.blocks[5])).toBe('Block 2');
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

      // Move to trigger drag
      await page.mouse.move(
        secondBlockBox.x + secondBlockBox.width / 2,
        secondBlockBox.y + secondBlockBox.height - 1,
        { steps: 15 }
      );

      // Verify duplicating attribute is NOT set yet
      const blokWrapper = page.locator(createSelector(DATA_ATTR.duplicating));

      await expect(blokWrapper).toHaveCount(0);

      // Press Alt key
      await page.keyboard.down('Alt');

      // Wait for duplicating attribute to be set
      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');
        return wrapper?.getAttribute('data-blok-duplicating') === 'true';
      }, { timeout: 2000 });

      // Verify duplicating attribute IS set
      await expect(blokWrapper).toHaveCount(1);

      // Release Alt key
      await page.keyboard.up('Alt');

      // Wait for duplicating attribute to be removed
      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');
        return wrapper?.getAttribute('data-blok-duplicating') !== 'true';
      }, { timeout: 2000 });

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
      expect(getBlockText(savedData?.blocks[3])).toBe('Beta');
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
      expect(getBlockText(savedData?.blocks[0])).toBe('Parent');
      expect(getBlockText(savedData?.blocks[1])).toBe('Child');
      expect(getBlockText(savedData?.blocks[2])).toBe('Sibling');
      expect(getBlockText(savedData?.blocks[3])).toBe('Parent'); // Duplicate
      expect(getBlockText(savedData?.blocks[4])).toBe('Child'); // Duplicate child
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

      // Move to trigger drag threshold but stay on same block (invalid target)
      await page.mouse.move(settingsBox.x + 20, settingsBox.y + 20, { steps: 10 });

      // Release with Alt held - but no valid target
      await page.keyboard.down('Alt');
      await page.mouse.up();
      await page.keyboard.up('Alt');

      // Wait for drag state to be cleared
      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');
        return wrapper?.getAttribute('data-blok-dragging') !== 'true';
      }, { timeout: 2000 });

      // The drop motion (ghost settle) finishes before assertions run.
      await page.waitForFunction(
        () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
        { timeout: 2000 }
      );

      // Verify: No duplication occurred (still just 1 block)
      await expect(page.getByTestId('block-wrapper')).toHaveCount(1);
    });
  });

  test.describe('drop inside toggle', () => {
    test('should reparent block when dropped on bottom edge of open toggle', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle', isOpen: true } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Outside block' } },
          ],
        },
      });

      // Toggle is explicitly open via isOpen: true
      await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

      // Hover over the paragraph to show settings button
      const outsideBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Outside block' });

      await outsideBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Target the toggle's inner wrapper (not the block-wrapper) to avoid overlap
      // with the next block's negative margins
      const toggleInner = page.locator('[data-blok-toggle-open="true"]');

      await performDragDrop(page, settingsButton, toggleInner, 'bottom');

      // Verify: the block is now a child of the toggle
      const savedData = await page.evaluate(() => window.blokInstance?.save());
      const toggle = savedData?.blocks.find(b => b.type === 'toggle');
      const para = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(toggle?.content).toContain(para?.id);
      expect(para?.parent).toBe(toggle?.id);
    });

    test('should reparent block when dropped on body placeholder of empty open toggle', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'Empty Toggle', isOpen: true } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Drag me' } },
          ],
        },
      });

      await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

      // Body placeholder should be visible (toggle has no children)
      const bodyPlaceholder = page.locator('[data-blok-toggle-body-placeholder]');

      await expect(bodyPlaceholder).toBeVisible();

      // Hover over paragraph to show settings
      const paraBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Drag me' });

      await paraBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the body placeholder
      await performDragDrop(page, settingsButton, bodyPlaceholder, 'bottom');

      // Verify reparenting
      const savedData = await page.evaluate(() => window.blokInstance?.save());
      const toggle = savedData?.blocks.find(b => b.type === 'toggle');
      const para = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(toggle?.content).toContain(para?.id);
      expect(para?.parent).toBe(toggle?.id);
    });

    test('should NOT reparent when dropping on closed toggle', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'Closed Toggle', isOpen: false } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Stay outside' } },
          ],
        },
      });

      // Toggle is explicitly closed
      await expect(page.locator('[data-blok-toggle-open="false"]')).toBeVisible();

      // Hover over paragraph
      const paraBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Stay outside' });

      await paraBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the bottom of the toggle
      const toggleBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Closed Toggle' });

      await performDragDrop(page, settingsButton, toggleBlock, 'bottom');

      // Verify: block is NOT a child
      const savedData = await page.evaluate(() => window.blokInstance?.save());
      const para = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(para?.parent).toBeUndefined();
    });

    test('should auto-expand closed toggle after 500ms hover during drag', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'Closed Toggle', isOpen: false } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Drag me' } },
          ],
        },
      });

      // Toggle is explicitly closed
      await expect(page.locator('[data-blok-toggle-open="false"]')).toBeVisible();

      // Hover over paragraph to reveal drag handle
      const paraBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Drag me' });
      await paraBlock.hover();
      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);
      await expect(settingsButton).toBeVisible();

      // Start drag
      const sourceBox = await getBoundingBox(settingsButton);
      const toggleBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Closed Toggle' });
      const targetBox = await getBoundingBox(toggleBlock);

      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();

      // Move over the closed toggle (triggers drag threshold + spring-load timer)
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 15 });

      // Wait for drag state
      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');
        return wrapper?.getAttribute('data-blok-dragging') === 'true';
      }, { timeout: 2000 });

      // Toggle should now be open (auto-waiting handles the 500ms spring-load delay)
      await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

      // Release mouse
      await page.mouse.up();

      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');
        return wrapper?.getAttribute('data-blok-dragging') !== 'true';
      }, { timeout: 2000 });

      // The drop motion (ghost settle) finishes before assertions run.
      await page.waitForFunction(
        () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
        { timeout: 2000 }
      );
    });

    test('should cancel spring-load when moving away before 500ms', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'Closed Toggle', isOpen: false } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Drag me' } },
          ],
        },
      });

      // Toggle is explicitly closed
      await expect(page.locator('[data-blok-toggle-open="false"]')).toBeVisible();

      // Hover over paragraph to reveal drag handle
      const paraBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Drag me' });
      await paraBlock.hover();
      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);
      await expect(settingsButton).toBeVisible();

      // Start drag
      const sourceBox = await getBoundingBox(settingsButton);
      const toggleBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Closed Toggle' });
      const targetBox = await getBoundingBox(toggleBlock);

      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();

      // Move over the closed toggle
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 15 });

      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');
        return wrapper?.getAttribute('data-blok-dragging') === 'true';
      }, { timeout: 2000 });

      // spring-loading attribute should appear immediately
      await expect(page.locator('[data-blok-spring-loading]')).toBeVisible();

      // Move away before 500ms — attribute should disappear
      const paraBox = await getBoundingBox(paraBlock);
      await page.mouse.move(paraBox.x + paraBox.width / 2, paraBox.y + paraBox.height / 2, { steps: 5 });
      // Wait deterministically for attribute removal (cancellation)
      await page.waitForFunction(() => document.querySelector('[data-blok-spring-loading]') === null, { timeout: 2000 });

      // Toggle should still be closed
      await expect(page.locator('[data-blok-toggle-open="false"]')).toBeVisible();

      await page.mouse.up();
    });

    test('should nest block inside toggle when dropped after spring-load expands it', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'Closed Toggle', isOpen: false } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Drop me in' } },
          ],
        },
      });

      // Toggle is explicitly closed
      await expect(page.locator('[data-blok-toggle-open="false"]')).toBeVisible();

      // Hover over paragraph to reveal drag handle
      const paraBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Drop me in' });
      await paraBlock.hover();
      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);
      await expect(settingsButton).toBeVisible();

      // Start drag
      const sourceBox = await getBoundingBox(settingsButton);
      const toggleBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Closed Toggle' });
      const targetBox = await getBoundingBox(toggleBlock);

      await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
      await page.mouse.down();

      // Move to center of toggle to trigger spring-load
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 15 });

      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');
        return wrapper?.getAttribute('data-blok-dragging') === 'true';
      }, { timeout: 2000 });

      // Wait for spring-load to fire (500ms delay)
      await page.waitForFunction(() => {
        return document.querySelector('[data-blok-toggle-open="true"]') !== null;
      }, { timeout: 3000 });

      // Toggle should be open now
      const openToggle = page.locator('[data-blok-toggle-open="true"]');
      await expect(openToggle).toBeVisible();

      // Move to bottom edge of the now-open toggle inner element to nest the block
      const openToggleBox = await getBoundingBox(openToggle);
      await page.mouse.move(openToggleBox.x + openToggleBox.width / 2, openToggleBox.y + openToggleBox.height - 2, { steps: 5 });
      await page.mouse.up();

      await page.waitForFunction(() => {
        const wrapper = document.querySelector('[data-blok-interface=blok]');
        return wrapper?.getAttribute('data-blok-dragging') !== 'true';
      }, { timeout: 2000 });

      // The drop motion (ghost settle) finishes before assertions run.
      await page.waitForFunction(
        () => document.querySelector('[data-blok-testid="drag-preview"]') === null,
        { timeout: 2000 }
      );

      // Verify para is now a child of the toggle
      const savedData = await page.evaluate(() => window.blokInstance?.save());
      const para = savedData?.blocks.find(b => b.type === 'paragraph');
      const toggle = savedData?.blocks.find(b => b.type === 'toggle');

      expect(para?.parent).toBe(toggle?.id);
      expect(toggle?.content).toContain(para?.id);
    });

    test('should reparent block when dropped between existing toggle children', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'Parent', isOpen: true }, content: ['child-1', 'child-2'] },
            { id: 'child-1', type: 'paragraph', data: { text: 'Child A' }, parent: 'toggle-1' },
            { id: 'child-2', type: 'paragraph', data: { text: 'Child B' }, parent: 'toggle-1' },
            { id: 'outsider', type: 'paragraph', data: { text: 'Outsider' } },
          ],
        },
      });

      // Hover over outsider
      const outsiderBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Outsider' });

      await outsiderBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to the top of Child B (which normalizes to bottom of Child A — same parent)
      const childB = page.locator('[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]').filter({ hasText: 'Child B' });

      await performDragDrop(page, settingsButton, childB, 'top');

      // Verify: Outsider is now a child of toggle
      const savedData = await page.evaluate(() => window.blokInstance?.save());
      const outsider = savedData?.blocks.find(b => b.id === 'outsider');
      const toggle = savedData?.blocks.find(b => b.id === 'toggle-1');

      expect(outsider?.parent).toBe('toggle-1');
      expect(toggle?.content).toContain('outsider');
    });

    // FIXME: Since b530b6c0, hovering a child inside [data-blok-toggle-children]
    // resolves to the parent toggle (blockHover.ts). The settings button therefore
    // belongs to the toggle, so dragging moves the entire toggle — not just the child.
    // Enabling independent child drag requires a source-code change (e.g. adding
    // data-blok-child-toolbar to the toggle children container).
    test.fixme('should clear parent when dragging a child OUT of a toggle', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'Parent', isOpen: true }, content: ['child-1'] },
            { id: 'child-1', type: 'paragraph', data: { text: 'Trapped child' }, parent: 'toggle-1' },
            { id: 'para-1', type: 'paragraph', data: { text: 'Bottom block' } },
          ],
        },
      });

      // Hover over the child block
      const childBlock = page.locator('[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]').filter({ hasText: 'Trapped child' });

      await childBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to below Bottom block (outside the toggle)
      const bottomBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Bottom block' });

      await performDragDrop(page, settingsButton, bottomBlock, 'bottom');

      // Verify: child is now at root level (no parent)
      const savedData = await page.evaluate(() => window.blokInstance?.save());
      const exChild = savedData?.blocks.find(b => b.id === 'child-1');

      expect(exChild?.parent).toBeUndefined();
    });

    test('should reparent block inside toggle heading (isToggleable header)', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'header-1', type: 'header', data: { text: 'Toggle Heading', level: 2, isToggleable: true } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Drop me in' } },
          ],
        },
      });

      // Toggle heading starts expanded
      await expect(page.locator('[data-blok-toggle-open="true"]')).toBeVisible();

      // Hover over paragraph
      const paraBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Drop me in' });

      await paraBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Target the header block-wrapper (which includes the body placeholder) so the
      // bottom edge of the bounding box lands in the bottom half of the block-wrapper.
      // Using only the H2 element ([data-blok-toggle-open="true"]) caused CSS margin
      // collapse to make the bottom edge land in the top half of the block-wrapper,
      // resulting in edge='top' instead of edge='bottom' and no reparenting.
      const headerBlockWrapper = page.getByTestId('block-wrapper').filter({
        has: page.locator('[data-blok-toggle-open="true"]'),
      });

      await performDragDrop(page, settingsButton, headerBlockWrapper, 'bottom');

      // Verify reparenting
      const savedData = await page.evaluate(() => window.blokInstance?.save());
      const header = savedData?.blocks.find(b => b.type === 'header');
      const para = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(header?.content).toContain(para?.id);
      expect(para?.parent).toBe(header?.id);
    });

    test('should hide body placeholder after dropping a block into an empty toggle', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'Empty Toggle', isOpen: true } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Drop me' } },
          ],
        },
      });

      // Body placeholder should be visible initially (toggle has no children)
      const bodyPlaceholder = page.locator('[data-blok-toggle-body-placeholder]');

      await expect(bodyPlaceholder).toBeVisible();

      // Hover over paragraph to show settings
      const paraBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Drop me' });

      await paraBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drop on the body placeholder
      await performDragDrop(page, settingsButton, bodyPlaceholder, 'bottom');

      // Verify: body placeholder should now be hidden (toggle has a child)
      await expect(bodyPlaceholder).toBeHidden();

      // Verify: the block is correctly reparented
      const savedData = await page.evaluate(() => window.blokInstance?.save());
      const toggle = savedData?.blocks.find(b => b.type === 'toggle');
      const para = savedData?.blocks.find(b => b.type === 'paragraph');

      expect(toggle?.content).toContain(para?.id);
      expect(para?.parent).toBe(toggle?.id);
    });

    test('should visually indent a block after dropping it into a toggle', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle', isOpen: true } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Indent me' } },
          ],
        },
      });

      // Get initial state of the paragraph block
      const paraBlock = page.locator('[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]').filter({ hasText: 'Indent me' });
      const initialMargin = await paraBlock.evaluate((el: HTMLElement) => el.style.marginLeft);

      // Root block should have no margin
      expect(initialMargin).toBe('');

      // Hover over paragraph to show settings
      await paraBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Target the toggle's inner wrapper
      const toggleInner = page.locator('[data-blok-toggle-open="true"]');

      await performDragDrop(page, settingsButton, toggleInner, 'bottom');

      // Verify: the block is now nested inside the toggle children container (depth 1).
      // Toggle children are indented via DOM nesting, not margin-left inline style.
      await expect(async () => {
        const depth = await paraBlock.evaluate((el: HTMLElement) => el.getAttribute('data-blok-depth'));

        expect(depth).toBe('1');
      }).toPass({ timeout: 2000 });

      // Verify: block is physically placed inside the toggle children container
      await expect(page.locator('[data-blok-toggle-children]').locator('[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]').filter({ hasText: 'Indent me' })).toBeVisible();
    });

    // FIXME: Same issue as "should clear parent when dragging a child OUT of a toggle" above.
    // Hovering a toggle child resolves to the parent toggle, so the drag moves the
    // toggle itself instead of extracting the child.
    test.fixme('should show body placeholder after dragging last child out of a toggle', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'Has Child', isOpen: true }, content: ['child-1'] },
            { id: 'child-1', type: 'paragraph', data: { text: 'Only child' }, parent: 'toggle-1' },
            { id: 'para-1', type: 'paragraph', data: { text: 'Bottom' } },
          ],
        },
      });

      // Body placeholder should be hidden (toggle has a child)
      const bodyPlaceholder = page.locator('[data-blok-toggle-body-placeholder]');

      await expect(bodyPlaceholder).toBeHidden();

      // Hover over the child block
      const childBlock = page.locator('[data-blok-testid="block-wrapper"][data-blok-component="paragraph"]').filter({ hasText: 'Only child' });

      await childBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag the child to below the bottom block (outside the toggle)
      const bottomBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Bottom' });

      await performDragDrop(page, settingsButton, bottomBlock, 'bottom');

      // Verify: body placeholder should now be visible (toggle is empty again)
      await expect(bodyPlaceholder).toBeVisible();

      // Verify: the child is now at root level
      const savedData = await page.evaluate(() => window.blokInstance?.save());
      const exChild = savedData?.blocks.find(b => b.id === 'child-1');

      expect(exChild?.parent).toBeUndefined();
    });

    test('should show full-width drop indicator when hovering inside open toggle', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'toggle-1', type: 'toggle', data: { text: 'My Toggle', isOpen: true } },
            { id: 'para-1', type: 'paragraph', data: { text: 'Drag source' } },
          ],
        },
      });

      // Hover over paragraph to show settings
      const paraBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Drag source' });

      await paraBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Start drag and move to bottom edge of toggle's inner wrapper
      // (not block-wrapper, to avoid overlap with next block's negative margins)
      const settingsBox = await getBoundingBox(settingsButton);
      const toggleInner = page.locator('[data-blok-toggle-open="true"]');
      const toggleBox = await getBoundingBox(toggleInner);

      await page.mouse.move(settingsBox.x + settingsBox.width / 2, settingsBox.y + settingsBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        toggleBox.x + toggleBox.width / 2,
        toggleBox.y + toggleBox.height - 1,
        { steps: 15 }
      );

      // Wait for drop indicator to appear
      await page.waitForFunction(() => {
        return document.querySelector('[data-drop-indicator="bottom"]') !== null;
      }, { timeout: 2000 });

      // Verify the indicator has depth 0 (full-width, not indented)
      // Check on the block-wrapper which receives the CSS variable
      const toggleBlock = page.getByTestId('block-wrapper').filter({ hasText: 'My Toggle' });
      const depth = await toggleBlock.evaluate((el: HTMLElement) =>
        el.style.getPropertyValue('--drop-indicator-depth')
      );

      expect(parseInt(depth, 10)).toBe(0);

      // Clean up
      await page.mouse.up();
    });
  });

  test.describe('drag toggle block itself', () => {
    test('should keep children inside toggle-list when toggle is dragged to a new position', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'para-above', type: 'paragraph', data: { text: 'Above block' } },
            { id: 'toggle-1', type: 'toggle', data: { text: 'Toggle Header', isOpen: true }, content: ['child-1', 'child-2'] },
            { id: 'child-1', type: 'paragraph', data: { text: 'Child One' }, parent: 'toggle-1' },
            { id: 'child-2', type: 'paragraph', data: { text: 'Child Two' }, parent: 'toggle-1' },
          ],
        },
      });

      // Hover over the toggle's header content area (not the whole block-wrapper which
      // includes children) to ensure we reveal the toggle's own drag handle, not a child's
      const toggleContent = page.locator('[data-blok-toggle-content]');

      await toggleContent.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag toggle above "Above block"
      const aboveBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Above block' });

      await performDragDrop(page, settingsButton, aboveBlock, 'top');

      // Verify: children's DOM holders are still inside the toggle container.
      // Query block-wrappers WITHIN the toggle container to avoid false positives from
      // the toggle's outer block-wrapper (whose textContent includes all children's text).
      const childrenInContainer = await page.evaluate(() => {
        const toggleContainer = document.querySelector('[data-blok-toggle-children]');
        const childBlocksInContainer = toggleContainer
          ? Array.from(toggleContainer.querySelectorAll('[data-blok-testid="block-wrapper"]'))
          : [];

        return {
          child1InContainer: childBlocksInContainer.some(el => el.textContent?.trim() === 'Child One'),
          child2InContainer: childBlocksInContainer.some(el => el.textContent?.trim() === 'Child Two'),
        };
      });

      expect(childrenInContainer.child1InContainer).toBe(true);
      expect(childrenInContainer.child2InContainer).toBe(true);
    });

    test('should keep children inside toggle-heading when toggle is dragged to a new position', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            { id: 'para-above', type: 'paragraph', data: { text: 'Above block' } },
            { id: 'header-1', type: 'header', data: { text: 'Toggle Heading', level: 2, isToggleable: true, isOpen: true }, content: ['child-1'] },
            { id: 'child-1', type: 'paragraph', data: { text: 'Heading Child' }, parent: 'header-1' },
          ],
        },
      });

      // Hover over the toggle arrow (present in both toggle-list and toggle-heading)
      // to reveal the heading block's drag handle, not a child block's
      const toggleArrow = page.locator('[data-blok-toggle-arrow]');

      await toggleArrow.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag toggle heading above "Above block"
      const aboveBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Above block' });

      await performDragDrop(page, settingsButton, aboveBlock, 'top');

      // Verify: child's DOM holder is still inside the toggle container.
      // Query within the toggle container to avoid false positives.
      const childInContainer = await page.evaluate(() => {
        const toggleContainer = document.querySelector('[data-blok-toggle-children]');
        const childBlocksInContainer = toggleContainer
          ? Array.from(toggleContainer.querySelectorAll('[data-blok-testid="block-wrapper"]'))
          : [];

        return childBlocksInContainer.some(el => el.textContent?.trim() === 'Heading Child');
      });

      expect(childInContainer).toBe(true);
    });
  });
});
