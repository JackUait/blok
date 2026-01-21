import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Blok } from "@/types";
import type { OutputData } from "@/types";
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from "../helpers/ensure-build";
import {
  DATA_ATTR,
  createSelector,
} from "../../../../src/components/constants";

const HOLDER_ID = "blok";
const BLOCK_SELECTOR = `${createSelector(DATA_ATTR.interface)} [data-blok-testid="block-wrapper"]`;
const SETTINGS_BUTTON_SELECTOR = `${createSelector(DATA_ATTR.interface)} [data-blok-testid="settings-toggler"]`;
const BLOCK_TUNES_POPOVER_SELECTOR =
  '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(
    async ({ holder }) => {
      if (window.blokInstance) {
        await window.blokInstance.destroy?.();
        window.blokInstance = undefined;
      }

      document.getElementById(holder)?.remove();

      const container = document.createElement("div");

      container.id = holder;
      container.setAttribute("data-blok-testid", holder);
      container.style.border = "1px dotted #388AE5";

      document.body.appendChild(container);
    },
    { holder: HOLDER_ID },
  );
};

const createBlok = async (page: Page, data?: OutputData): Promise<void> => {
  await resetBlok(page);
  await page.waitForFunction(() => typeof window.Blok === "function");

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
    { holder: HOLDER_ID, blokData: data },
  );
};

const getBoundingBox = async (
  locator: ReturnType<Page["locator"]>,
): Promise<{ x: number; y: number; width: number; height: number }> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error("Could not get bounding box for element");
  }

  return box;
};

const performDragDrop = async (
  page: Page,
  sourceLocator: ReturnType<Page["locator"]>,
  targetLocator: ReturnType<Page["locator"]>,
  targetVerticalPosition: "top" | "bottom",
): Promise<void> => {
  const sourceBox = await getBoundingBox(sourceLocator);
  const targetBox = await getBoundingBox(targetLocator);

  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY =
    targetVerticalPosition === "top"
      ? targetBox.y + 1
      : targetBox.y + targetBox.height - 1;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();

  // Small delay to allow drag state to initialize (mouse down triggers drag start)
  // Playwright's mouse operations don't wait for event handlers, so we need
  // to wait for the drag indicator to appear or a short timeout
  const dragIndicator = page.locator('[data-blok-testid="drag-indicator"]');
  await dragIndicator.waitFor({ state: "visible", timeout: 500 }).catch(() => {
    // Drag indicator might not appear immediately, continue
  });

  await page.mouse.move(targetX, targetY, { steps: 15 });

  // Wait for the drag to reach the target position
  await dragIndicator.waitFor({ state: "attached", timeout: 500 }).catch(() => {
    // Continue even if indicator check fails
  });

  await page.mouse.up();

  // Wait for drag indicator to be removed after mouse up
  await dragIndicator.waitFor({ state: "hidden", timeout: 500 }).catch(() => {
    // Continue even if indicator was never visible
  });
};

test.describe("ui.settings-toggler-after-drag", () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test("should not open block settings menu immediately after drag-drop", async ({
    page,
  }) => {
    await createBlok(page, {
      blocks: [
        { type: "paragraph", data: { text: "First block" } },
        { type: "paragraph", data: { text: "Second block" } },
      ],
    });

    // eslint-disable-next-line playwright/no-nth-methods
    const firstBlock = page.locator(BLOCK_SELECTOR).first();
    // eslint-disable-next-line playwright/no-nth-methods
    const secondBlock = page.locator(BLOCK_SELECTOR).nth(1);

    // Get the visible settings button
    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    // Hover over the first block to make the toolbar visible
    await firstBlock.hover();
    await expect(settingsButton).toBeVisible();

    // Perform drag-drop: move first block below second block
    await performDragDrop(page, settingsButton, secondBlock, "bottom");

    // The block settings menu should NOT be open after drag-drop
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toHaveCount(0);

    // Now click on the settings button - it should open the menu
    await settingsButton.click();

    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
  });

  test("should open block settings menu on click after drag-drop has settled", async ({
    page,
  }) => {
    await createBlok(page, {
      blocks: [
        { type: "paragraph", data: { text: "First block" } },
        { type: "paragraph", data: { text: "Second block" } },
        { type: "paragraph", data: { text: "Third block" } },
      ],
    });

    // eslint-disable-next-line playwright/no-nth-methods
    const firstBlock = page.locator(BLOCK_SELECTOR).first();
    // eslint-disable-next-line playwright/no-nth-methods
    const secondBlock = page.locator(BLOCK_SELECTOR).nth(1);

    // Get the visible settings button
    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    // Hover over the second block to make the toolbar visible
    await secondBlock.hover();
    await expect(settingsButton).toBeVisible();

    // Perform drag-drop to reorder blocks
    await performDragDrop(page, settingsButton, firstBlock, "top");

    // Click on the settings button - it should open the menu for the current block
    await settingsButton.click();

    // Now the menu should open
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
  });

  test("should distinguish between click and drag on settings toggler", async ({
    page,
  }) => {
    await createBlok(page, {
      blocks: [
        { type: "paragraph", data: { text: "First block" } },
        { type: "paragraph", data: { text: "Second block" } },
      ],
    });

    // eslint-disable-next-line playwright/no-nth-methods
    const firstBlock = page.locator(BLOCK_SELECTOR).first();
    // eslint-disable-next-line playwright/no-nth-methods
    const secondBlock = page.locator(BLOCK_SELECTOR).nth(1);

    // Get the visible settings button
    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    // Hover over the first block to make the toolbar visible
    await firstBlock.hover();
    await expect(settingsButton).toBeVisible();

    // Perform a quick click (minimal mouse movement)
    const buttonBox = await getBoundingBox(settingsButton);
    const clickX = buttonBox.x + buttonBox.width / 2;
    const clickY = buttonBox.y + buttonBox.height / 2;

    await page.mouse.move(clickX, clickY);
    await page.mouse.down();
    await page.mouse.up();

    // Block settings should open on click
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();

    // Close the menu
    await page.mouse.click(clickX + 10, clickY + 10);

    // Hover again to make the toolbar visible for the drag
    await firstBlock.hover();
    await expect(settingsButton).toBeVisible();

    // Now perform a drag (movement beyond threshold)
    await performDragDrop(page, settingsButton, secondBlock, "bottom");

    // Block settings should NOT open after drag
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toHaveCount(0);
  });

  test("should allow click after drag-drop has fully completed", async ({
    page,
  }) => {
    await createBlok(page, {
      blocks: [
        { type: "paragraph", data: { text: "First block" } },
        { type: "paragraph", data: { text: "Second block" } },
      ],
    });

    // eslint-disable-next-line playwright/no-nth-methods
    const firstBlock = page.locator(BLOCK_SELECTOR).first();
    // eslint-disable-next-line playwright/no-nth-methods
    const secondBlock = page.locator(BLOCK_SELECTOR).nth(1);

    // Get the visible settings button
    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    // Hover over the first block to make the toolbar visible
    await firstBlock.hover();
    await expect(settingsButton).toBeVisible();

    // Perform drag-drop
    await performDragDrop(page, settingsButton, secondBlock, "bottom");

    // Now click should work
    await settingsButton.click();

    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
  });

  test("should handle multiple consecutive drag-drop operations correctly", async ({
    page,
  }) => {
    await createBlok(page, {
      blocks: [
        { type: "paragraph", data: { text: "Block 1" } },
        { type: "paragraph", data: { text: "Block 2" } },
        { type: "paragraph", data: { text: "Block 3" } },
        { type: "paragraph", data: { text: "Block 4" } },
      ],
    });

    const blocks = page.locator(BLOCK_SELECTOR);
    const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

    // Hover over the first block to make the toolbar visible
    // eslint-disable-next-line playwright/no-nth-methods
    await blocks.nth(0).hover();
    await expect(settingsButton).toBeVisible();

    // Perform multiple drag operations
    await performDragDrop(
      page,
      settingsButton,
      // eslint-disable-next-line playwright/no-nth-methods
      blocks.nth(1),
      "bottom",
    );

    // Hover over the current block (now block 2) for the next drag
    // eslint-disable-next-line playwright/no-nth-methods
    await blocks.nth(2).hover();
    await expect(settingsButton).toBeVisible();

    await performDragDrop(
      page,
      settingsButton,
      // eslint-disable-next-line playwright/no-nth-methods
      blocks.nth(3),
      "bottom",
    );

    // Hover over the current block for the final drag
    // eslint-disable-next-line playwright/no-nth-methods
    await blocks.nth(1).hover();
    await expect(settingsButton).toBeVisible();

    await performDragDrop(
      page,
      settingsButton,
      // eslint-disable-next-line playwright/no-nth-methods
      blocks.nth(2),
      "bottom",
    );

    // No block settings menu should be open after all the dragging
    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toHaveCount(0);

    // But clicking should still work
    await settingsButton.click();

    await expect(page.locator(BLOCK_TUNES_POPOVER_SELECTOR)).toBeVisible();
  });
});
