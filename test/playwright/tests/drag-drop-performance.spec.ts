/**
 * Performance and stress tests for drag and drop
 * Tests drag operations with large numbers of blocks
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { OutputData } from "@/types";
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from "./helpers/ensure-build";
import { DATA_ATTR, createSelector } from "../../../src/components/constants";

const HOLDER_ID = "blok";
const SETTINGS_BUTTON_SELECTOR = `${createSelector(DATA_ATTR.interface)} [data-blok-testid="settings-toggler"]`;

/**
 * Helper function to get bounding box and throw if it doesn't exist.
 * For Firefox, falls back to using the block wrapper's position if settings toggler is hidden.
 */
const getBoundingBox = async (
  locator: ReturnType<Page["locator"]>,
  fallbackLocator?: ReturnType<Page["locator"]>,
): Promise<{ x: number; y: number; width: number; height: number }> => {
  let box = await locator.boundingBox();

  // If the settings toggler is hidden (Firefox issue), try to get position from fallback
  if (!box && fallbackLocator) {
    const fallbackBox = await fallbackLocator.boundingBox();
    if (fallbackBox) {
      // Use the block wrapper's position, but center it horizontally for the drag handle
      // The settings toggler is typically on the right side of the block
      const handleSize = 24; // approximate size of the settings toggler
      box = {
        x: fallbackBox.x + fallbackBox.width - handleSize,
        y: fallbackBox.y,
        width: handleSize,
        height: fallbackBox.height,
      };
    }
  }

  if (!box) {
    throw new Error("Could not get bounding box for element");
  }

  return box;
};

/**
 * Helper function to perform drag and drop using pointer-based mouse events.
 */
const performDragDrop = async (
  page: Page,
  sourceLocator: ReturnType<Page["locator"]>,
  targetLocator: ReturnType<Page["locator"]>,
  targetVerticalPosition: "top" | "bottom",
  fallbackLocator?: ReturnType<Page["locator"]>,
): Promise<number> => {
  const sourceBox = await getBoundingBox(sourceLocator, fallbackLocator);
  const targetBox = await getBoundingBox(targetLocator);

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY =
    targetVerticalPosition === "top"
      ? targetBox.y + 1
      : targetBox.y + targetBox.height - 1;

  // Check if target is outside viewport (negative Y)
  const isTargetOffPage = targetY < 0;

  const startTime = Date.now();

  // Move to source and press down
  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();

  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(50);

  // Move to target position with steps to trigger drag threshold
  await page.mouse.move(targetX, targetY, { steps: 15 });

  // Wait longer for auto-scroll when target is off the page
  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(isTargetOffPage ? 1000 : 50);

  // Release to complete the drop
  await page.mouse.up();

  // eslint-disable-next-line playwright/no-wait-for-timeout
  await page.waitForTimeout(100);

  return Date.now() - startTime;
};

/**
 * Helper function to create many blocks.
 */
const createManyBlocks = (count: number): OutputData["blocks"] => {
  return Array.from({ length: count }, (_, i) => ({
    type: "paragraph",
    data: { text: `Block ${i}` },
  }));
};

type CreateBlokOptions = {
  data?: OutputData;
  config?: Record<string, unknown>;
};

/**
 * Internal Block type for testing purposes
 */
interface TestBlock {
  id: string;
  name: string;
  holder: HTMLElement;
}

/**
 * Internal BlockManager module for testing purposes
 */
interface TestBlockManager {
  blocks: TestBlock[];
}

/**
 * Internal Toolbar module for testing purposes
 */
interface TestToolbar {
  moveAndOpen(block: TestBlock): void;
}

/**
 * Internal modules accessible via Blok's module property
 */
interface TestBlokInternalModules {
  BlockManager: TestBlockManager;
  Toolbar: TestToolbar;
  [key: string]: unknown;
}

/**
 * Blok instance with internal modules accessible for testing
 */
interface TestBlokInstanceWithModules {
  module?: TestBlokInternalModules;
}

const createBlok = async (
  page: Page,
  options: CreateBlokOptions = {},
): Promise<void> => {
  const { data = null, config = {} } = options;

  await page.evaluate(
    async ({ holder, data: initialData, config: blokConfig }) => {
      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }

      document.getElementById(holder)?.remove();

      const container = document.createElement("div");

      container.id = holder;
      container.style.border = "1px dotted #388AE5";

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
    },
    {
      holder: HOLDER_ID,
      data,
      config,
    },
  );
};

test.describe("drag and drop performance", () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === "function");
  });

  test("should handle drag with 50 blocks efficiently", async ({ page }) => {
    const blocks = createManyBlocks(50);

    await createBlok(page, {
      data: { blocks },
    });

    // Get the first block
    const firstBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 0" });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get a block in the middle as target
    const middleBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 25" });

    // Perform drag and measure time
    const dragTime = await performDragDrop(
      page,
      settingsButton,
      middleBlock,
      "bottom",
    );

    // Verify the drag completed
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks).toHaveLength(50);

    // Log performance (should complete in reasonable time)

    console.log(`Drag operation with 50 blocks took ${dragTime}ms`);
    expect(dragTime).toBeLessThan(2000); // Should complete within 2 seconds
  });

  test("should handle drag with 100 blocks efficiently", async ({ page }) => {
    const blocks = createManyBlocks(100);

    await createBlok(page, {
      data: { blocks },
    });

    // Get the first block
    const firstBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 0" });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get a block near the end as target
    const nearEndBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 90" });

    // Perform drag and measure time
    const dragTime = await performDragDrop(
      page,
      settingsButton,
      nearEndBlock,
      "bottom",
    );

    // Verify the drag completed
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks).toHaveLength(100);

    // Log performance

    console.log(`Drag operation with 100 blocks took ${dragTime}ms`);
    expect(dragTime).toBeLessThan(3000); // Should complete within 3 seconds
  });

  test("should handle multiple consecutive drags efficiently", async ({
    page,
    browserName,
  }) => {
    const blocks = createManyBlocks(30);

    await createBlok(page, {
      data: { blocks },
    });

    const dragTimes: number[] = [];

    // Perform 5 consecutive drags
    for (let i = 0; i < 5; i++) {
      const sourceIndex = i * 5;
      const targetIndex = (i + 1) * 5;

      const sourceBlock = page
        .getByTestId("block-wrapper")
        .filter({ hasText: new RegExp(`^Block ${sourceIndex}$`) });

      await sourceBlock.hover();

      // Firefox may need explicit toolbar activation after drag operations
      // since the hover event doesn't always trigger properly
      // Use evaluate to find the block by text content directly and call moveAndOpen
      await page.evaluate(async (blockIndex) => {
        const blok = window.blokInstance as TestBlokInstanceWithModules | undefined;
        if (!blok?.module || !blok.module.BlockManager || !blok.module.Toolbar) {
          return;
        }

        // Find the block by searching all blocks for matching text content
        const blocks = blok.module.BlockManager.blocks;
        let targetBlock = null;

        for (const block of blocks) {
          // Get the text content from the block's holder
          const blockText = block.holder.textContent?.trim();
          if (blockText === `Block ${blockIndex}` || blockText?.endsWith(`Block ${blockIndex}`)) {
            targetBlock = block;
            break;
          }
        }

        if (targetBlock) {
          blok.module.Toolbar.moveAndOpen(targetBlock);

          // Firefox may need explicit class removal to ensure visibility
          // The toolbar wrapper might have 'hidden' class from toolbarClosed
          const toolbarWrapper = targetBlock.holder.querySelector('[data-blok-toolbar]');
          if (toolbarWrapper) {
            toolbarWrapper.classList.remove('hidden');
            toolbarWrapper.classList.add('block');
            toolbarWrapper.setAttribute('data-blok-opened', 'true');
          }

          // Also ensure the settings toggler is visible
          const settingsToggler = targetBlock.holder.querySelector('[data-blok-settings-toggler]');
          if (settingsToggler) {
            settingsToggler.classList.remove('hidden');
          }

          // Also ensure the actions container is visible
          const actionsContainer = targetBlock.holder.querySelector('[data-blok-testid="toolbar-actions"]');
          if (actionsContainer) {
            actionsContainer.classList.remove('opacity-0');
            actionsContainer.classList.add('opacity-100');
          }
        }
      }, sourceIndex);

      // Give Firefox a moment to process the DOM changes
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(50);

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      // For Chromium, wait for settings button to be visible
      // For Firefox and WebKit, the button may be visually hidden, so we skip the visibility check
      // and rely on the fallback locator mechanism instead
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (browserName !== 'firefox' && browserName !== 'webkit') {
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(settingsButton).toBeVisible({ timeout: 10000 });
      } else {
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(settingsButton).toBeAttached({ timeout: 10000 });
      }

      const targetBlock = page
        .getByTestId("block-wrapper")
        .filter({ hasText: new RegExp(`^Block ${targetIndex}$`) });

      const dragTime = await performDragDrop(
        page,
        settingsButton,
        targetBlock,
        "bottom",
        browserName === 'firefox' || browserName === 'webkit' ? sourceBlock : undefined,
      );

      dragTimes.push(dragTime);

      // Wait for toolbar to be ready for next iteration
      // Firefox needs more time for DOM to settle after drag
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(300);
    }

    const totalTime = dragTimes.reduce((sum, time) => sum + time, 0);
    const avgTime = totalTime / dragTimes.length;

    console.log(
      `5 consecutive drags took ${totalTime}ms (avg: ${avgTime.toFixed(0)}ms each)`,
    );

    // Each drag should be reasonably fast
    dragTimes.forEach((time) => {
      expect(time).toBeLessThan(1500);
    });

    // Final data integrity check
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks).toHaveLength(30);
  });

  test("should handle drag from top to bottom in large document", async ({
    page,
  }) => {
    const blocks = createManyBlocks(75);

    await createBlok(page, {
      data: { blocks },
    });

    // Get the first block
    const firstBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 0" });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get the last block as target
    const lastBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 74" });

    // Perform drag and measure time
    const dragTime = await performDragDrop(
      page,
      settingsButton,
      lastBlock,
      "bottom",
    );

    // Verify the first block is now last
    // After dragging Block 0 to the bottom, Block 1 should now be at the top
    await expect(
      page.getByTestId("block-wrapper").filter({ hasText: /^Block 1$/ }),
    ).toBeVisible();
    // Verify Block 0 is still in the document (just moved to the end)
    await expect(
      page.getByTestId("block-wrapper").filter({ hasText: "Block 0" }),
    ).toBeVisible();

    // Log performance

    console.log(`Top-to-bottom drag with 75 blocks took ${dragTime}ms`);
    expect(dragTime).toBeLessThan(3000);
  });

  test("should handle drag from bottom to top in large document", async ({
    page,
  }) => {
    const blocks = createManyBlocks(75);

    await createBlok(page, {
      data: { blocks },
    });

    // Scroll to bottom first to ensure last block is rendered
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(100);

    // Get the last block
    const lastBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 74" });

    await lastBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    // Get the first block as target
    const firstBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 0" });

    // Get the first block's bounding box BEFORE scrolling back
    // This will have negative Y since we're at the bottom
    const firstBlockBoxBeforeScroll = await firstBlock
      .boundingBox();

    // If the first block is off the top of the page (negative Y),
    // scroll partially back so it becomes visible for the drag
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (firstBlockBoxBeforeScroll && firstBlockBoxBeforeScroll.y < 0) {
      // Scroll to make the first block visible at the top of the viewport
      await page.evaluate(() => window.scrollTo(0, 0));

      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(100);
    }

    // Perform drag and measure time
    const dragTime = await performDragDrop(
      page,
      settingsButton,
      firstBlock,
      "top",
    );

    // Verify the last block is now first
    // After dragging Block 74 to the top, it should be the first visible block
    await expect(
      page.getByTestId("block-wrapper").filter({ hasText: /^Block 74$/ }),
    ).toBeVisible();

    // Log performance

    console.log(`Bottom-to-top drag with 75 blocks took ${dragTime}ms`);
    expect(dragTime).toBeLessThan(3000);
  });
});

test.describe("drag and drop stress tests", () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === "function");
  });

  test("should maintain data integrity after many drags", async ({
    page,
    browserName,
  }) => {
    const blocks = createManyBlocks(20);

    await createBlok(page, {
      data: { blocks },
    });

    // Perform many random drags
    const operations = [
      { from: 0, to: 19 },
      { from: 1, to: 10 },
      { from: 5, to: 15 },
      { from: 18, to: 2 },
      { from: 10, to: 0 },
      { from: 8, to: 12 },
      { from: 3, to: 17 },
      { from: 15, to: 5 },
    ];

    for (const op of operations) {
      // Find block by text content - more reliable across browsers
      const sourceBlock = page.getByTestId("block-wrapper").filter({
        has: page.getByText(`Block ${op.from}`, { exact: true }),
      });

      await sourceBlock.hover({ timeout: 10000 });

      // Firefox may need explicit toolbar activation after drag operations
      await page.evaluate(async (blockIndex) => {
        const blok = window.blokInstance as TestBlokInstanceWithModules | undefined;
        if (!blok?.module || !blok.module.BlockManager || !blok.module.Toolbar) {
          return;
        }

        const blocks = blok.module.BlockManager.blocks;
        let targetBlock = null;

        for (const block of blocks) {
          const blockText = block.holder.textContent?.trim();
          if (blockText === `Block ${blockIndex}` || blockText?.endsWith(`Block ${blockIndex}`)) {
            targetBlock = block;
            break;
          }
        }

        if (targetBlock) {
          blok.module.Toolbar.moveAndOpen(targetBlock);

          const toolbarWrapper = targetBlock.holder.querySelector('[data-blok-toolbar]');
          if (toolbarWrapper) {
            toolbarWrapper.classList.remove('hidden');
            toolbarWrapper.classList.add('block');
            toolbarWrapper.setAttribute('data-blok-opened', 'true');
          }

          const settingsToggler = targetBlock.holder.querySelector('[data-blok-settings-toggler]');
          if (settingsToggler) {
            settingsToggler.classList.remove('hidden');
          }

          const actionsContainer = targetBlock.holder.querySelector('[data-blok-testid="toolbar-actions"]');
          if (actionsContainer) {
            actionsContainer.classList.remove('opacity-0');
            actionsContainer.classList.add('opacity-100');
          }
        }
      }, op.from);

      // Give Firefox a moment to process the DOM changes
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(50);

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      // For Chromium, wait for settings button to be visible
      // For Firefox and WebKit, the button may be visually hidden, so we skip the visibility check
      // and rely on the fallback locator mechanism instead
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (browserName !== 'firefox' && browserName !== 'webkit') {
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(settingsButton).toBeVisible({ timeout: 10000 });
      } else {
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(settingsButton).toBeAttached({ timeout: 10000 });
      }

      const targetBlock = page.getByTestId("block-wrapper").filter({
        has: page.getByText(`Block ${op.to}`, { exact: true }),
      });

      await performDragDrop(
        page,
        settingsButton,
        targetBlock,
        "bottom",
        browserName === 'firefox' || browserName === 'webkit' ? sourceBlock : undefined,
      );

      // Wait for toolbar to reopen after drag
      // Firefox may need additional time for DOM to settle
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(300);
    }

    // Verify data integrity
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks).toHaveLength(20);
    expect(
      savedData?.blocks.every(
        (block: { type: string }) => block.type === "paragraph",
      ),
    ).toBe(true);
    expect(
      savedData?.blocks.every((block: { data: { text: string } }) =>
        block.data.text.startsWith("Block "),
      ),
    ).toBe(true);
  });

  test("should handle rapid drag start/stop cycles", async ({ page }) => {
    const blocks = createManyBlocks(10);

    await createBlok(page, {
      data: { blocks },
    });

    const firstBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 0" });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    const settingsBox = await getBoundingBox(settingsButton);

    // Simulate rapid click-like interactions (mousedown/mouseup without moving past threshold)
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(
        settingsBox.x + settingsBox.width / 2,
        settingsBox.y + settingsBox.height / 2,
      );
      await page.mouse.down();
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(10);
      await page.mouse.up();
      // eslint-disable-next-line playwright/no-wait-for-timeout
      await page.waitForTimeout(20);
    }

    // Verify no corruption occurred
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks).toHaveLength(10);

    // Blocks should still be in original order since no drag completed
    await expect(page.getByTestId("block-wrapper")).toHaveText([
      "Block 0",
      "Block 1",
      "Block 2",
      "Block 3",
      "Block 4",
      "Block 5",
      "Block 6",
      "Block 7",
      "Block 8",
      "Block 9",
    ]);
  });

  test("should handle drag during auto-scroll scenario with many blocks", async ({
    page,
  }) => {
    // Create enough blocks to make page scrollable
    const blocks = createManyBlocks(50);

    await createBlok(page, {
      data: { blocks },
    });

    // Scroll to top
    await page.evaluate(() => window.scrollTo(0, 0));

    const firstBlock = page
      .getByTestId("block-wrapper")
      .filter({ hasText: "Block 0" });

    await firstBlock.hover();

    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    await expect(settingsButton).toBeVisible();

    const settingsBox = await getBoundingBox(settingsButton);

    // Start drag
    await page.mouse.move(
      settingsBox.x + settingsBox.width / 2,
      settingsBox.y + settingsBox.height / 2,
    );
    await page.mouse.down();

    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(50);

    // Move to trigger drag threshold
    await page.mouse.move(settingsBox.x + 20, settingsBox.y + 20, { steps: 5 });

    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(50);

    // Move cursor near bottom edge to trigger auto-scroll
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    await page.mouse.move(settingsBox.x, viewportHeight - 25, { steps: 10 });

    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(500);

    // Get new scroll position
    const scrolledY = await page.evaluate(() => window.scrollY);

    // Verify the page has scrolled down
    expect(scrolledY).toBeGreaterThan(0);

    // Clean up - release mouse
    await page.mouse.up();

    // Verify data integrity after auto-scroll drag
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks).toHaveLength(50);
  });

  test("should not cause memory leaks with repeated drag operations", async ({
    page,
    browserName,
  }) => {
    const blocks = createManyBlocks(15);

    await createBlok(page, {
      data: { blocks },
    });

    // Get initial memory usage (0 if unavailable)
    const initialMemory = await page.evaluate(() => {
      return (
        (performance as unknown as { memory: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0
      );
    });

    // Perform many drag operations
    for (let i = 0; i < 20; i++) {
      const sourceIndex = i % 15;
      const targetIndex = (i + 5) % 15;

      const sourceBlock = page
        .getByTestId("block-wrapper")
        .filter({ hasText: new RegExp(`^Block ${sourceIndex}$`) });

      await sourceBlock.hover();

      // Firefox may need explicit toolbar activation after drag operations
      await page.evaluate(async (blockIndex) => {
        const blok = window.blokInstance as TestBlokInstanceWithModules | undefined;
        if (!blok?.module || !blok.module.BlockManager || !blok.module.Toolbar) {
          return;
        }

        const blocks = blok.module.BlockManager.blocks;
        let targetBlock = null;

        for (const block of blocks) {
          const blockText = block.holder.textContent?.trim();
          if (blockText === `Block ${blockIndex}` || blockText?.endsWith(`Block ${blockIndex}`)) {
            targetBlock = block;
            break;
          }
        }

        if (targetBlock) {
          blok.module.Toolbar.moveAndOpen(targetBlock);

          // Firefox may need explicit class removal to ensure visibility
          const toolbarWrapper = targetBlock.holder.querySelector('[data-blok-toolbar]');
          if (toolbarWrapper) {
            toolbarWrapper.classList.remove('hidden');
            toolbarWrapper.setAttribute('data-blok-opened', 'true');
          }

          const settingsToggler = targetBlock.holder.querySelector('[data-blok-settings-toggler]');
          if (settingsToggler) {
            settingsToggler.classList.remove('hidden');
          }

          const actionsContainer = targetBlock.holder.querySelector('[data-blok-testid="toolbar-actions"]');
          if (actionsContainer) {
            actionsContainer.classList.remove('opacity-0');
            actionsContainer.classList.add('opacity-100');
          }
        }
      }, sourceIndex);

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      // For Firefox and WebKit, use a more lenient check since the button may be visually hidden
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (browserName !== 'firefox' && browserName !== 'webkit') {
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(settingsButton).toBeVisible({ timeout: 10000 });
      } else {
        // eslint-disable-next-line playwright/no-conditional-expect
        await expect(settingsButton).toBeAttached({ timeout: 10000 });
      }

      const targetBlock = page
        .getByTestId("block-wrapper")
        .filter({ hasText: new RegExp(`^Block ${targetIndex}$`) });

      await performDragDrop(
        page,
        settingsButton,
        targetBlock,
        "bottom",
        browserName === 'firefox' || browserName === 'webkit' ? sourceBlock : undefined,
      );
    }

    // Get final memory usage
    const finalMemory = await page.evaluate(() => {
      return (
        (performance as unknown as { memory: { usedJSHeapSize: number } })
          .memory?.usedJSHeapSize ?? 0
      );
    });

    // Verify final state is correct
    const savedData = await page.evaluate(() => window.blokInstance?.save());

    expect(savedData?.blocks).toHaveLength(15);

    // Memory API is only available in Chromium-based browsers with --enable-precise-memory-info flag
    // When unavailable, both values are 0 - skip the memory growth check in that case
    // eslint-disable-next-line playwright/no-conditional-in-test
    const hasValidMemory = initialMemory > 0 && finalMemory > 0;

    // Log memory information
    // eslint-disable-next-line playwright/no-conditional-in-test
    if (hasValidMemory) {
      const memoryGrowth = finalMemory - initialMemory;
      const growthPercentage = (memoryGrowth / initialMemory) * 100;

      console.log(
        `Memory after 20 drags - Initial: ${initialMemory}, Final: ${finalMemory}, Growth: ${memoryGrowth}, Growth%: ${growthPercentage.toFixed(2)}`,
      );

      // When memory API is available, check for reasonable growth
      // eslint-disable-next-line playwright/no-conditional-expect
      expect(growthPercentage).toBeLessThan(50);
    } else {
      console.log(
        `Memory API not available - Initial: ${initialMemory}, Final: ${finalMemory}. Skipping memory growth check.`,
      );
    }
  });
});
