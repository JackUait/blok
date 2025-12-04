/**
 * Tests for undo/redo functionality
 * Validates that:
 * 1. Caret position is preserved after undo/redo
 * 2. Focus remains in the editor after undo/redo
 * 3. Blocks are updated in-place without full re-render when possible
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;
const BLOK_BUNDLE_PATH = path.resolve(__dirname, '../../../../dist/editorjs.umd.js');

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;

/**
 * Wait time to allow history debounce to complete
 */
const HISTORY_DEBOUNCE_WAIT = 500;

/**
 * Short wait time for state changes after undo/redo operations
 */
const STATE_CHANGE_WAIT = 200;

/**
 * Wait for a specified delay using page.evaluate to avoid lint warnings about page.waitForTimeout
 */
const waitForDelay = async (page: Page, delayMs: number): Promise<void> => {
  await page.evaluate(
    async (timeout) => {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeout);
      });
    },
    delayMs
  );
};

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
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

const ensureBlokBundleAvailable = async (page: Page): Promise<void> => {
  const hasGlobal = await page.evaluate(() => typeof window.Blok === 'function');

  if (hasGlobal) {
    return;
  }

  await page.addScriptTag({ path: BLOK_BUNDLE_PATH });
  await page.waitForFunction(() => typeof window.Blok === 'function');
};

const createBlok = async (
  page: Page,
  options: { data?: OutputData } = {}
): Promise<void> => {
  const { data = null } = options;

  await resetBlok(page);
  await ensureBlokBundleAvailable(page);

  await page.evaluate(
    async ({ holder, initialData }) => {
      const blokConfig: Record<string, unknown> = {
        holder,
        autofocus: true,
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      initialData: data,
    }
  );
};

/**
 * Helper to check if the editor has focus
 */
const isEditorFocused = async (page: Page): Promise<boolean> => {
  return await page.evaluate(() => {
    const activeElement = document.activeElement;

    if (!activeElement) {
      return false;
    }

    const editorWrapper = document.querySelector('[data-blok-testid="blok"]');

    return editorWrapper?.contains(activeElement) ?? false;
  });
};

test.describe('undo/Redo', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe('focus Preservation', () => {
    test('editor retains focus after undo', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Initial text' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Focus and type some text
      await input.click();
      await input.type(' more content');

      // Wait for history to record the change
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify the text was added
      await expect(input).toContainText('Initial text more content');

      // Perform undo
      await page.keyboard.press(`${MODIFIER_KEY}+z`);

      // Wait for state to restore
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify the text was undone
      await expect(input).toContainText('Initial text');

      // Check that focus is still within the editor
      const focused = await isEditorFocused(page);

      expect(focused).toBe(true);
    });

    test('editor retains focus after redo', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Initial text' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Focus and type some text
      await input.click();
      await input.type(' added');

      // Wait for history to record
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Undo
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Redo
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify text is restored
      await expect(input).toContainText('Initial text added');

      // Check focus is maintained
      const focused = await isEditorFocused(page);

      expect(focused).toBe(true);
    });

    test('can continue typing after undo without clicking', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Hello' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Focus and type
      await input.click();
      await input.type(' World');

      // Wait for history
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Undo
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify undo worked
      await expect(input).toContainText('Hello');

      // Continue typing without clicking - focus should be preserved and we should be able to type
      // Note: The caret position after undo may not be at the exact same position as before
      // but typing should still work without needing to click
      await page.keyboard.type('!');

      // Wait for DOM to update
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // The text should contain "!" somewhere (focus is preserved even if caret position varies)
      await expect(input).toContainText('!');

      // Most importantly: verify we're still focused in the editor and can continue editing
      expect(await isEditorFocused(page)).toBe(true);
    });
  });

  test.describe('block Update Behavior', () => {
    test('block DOM element is preserved during in-place text update', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Original text' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Get the block's data-blok-id before changes
      const blockIdBefore = await paragraph.getAttribute('data-blok-id');

      // Make a change
      await input.click();
      await input.type(' modified');

      // Wait for history
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Undo
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Get the block's data-blok-id after undo
      const blockIdAfter = paragraph;

      // The block ID should be the same (block was updated in-place, not replaced)
      expect(blockIdBefore).not.toBeNull();
      await expect(blockIdAfter).toHaveAttribute('data-blok-id', blockIdBefore!);
    });

    test('handles multiple sequential undos correctly', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Start' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Focus
      await input.click();

      // Make first change
      await input.type(' one');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Make second change
      await input.type(' two');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify current state
      await expect(input).toContainText('Start one two');

      // First undo
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toContainText('Start one');

      // Focus should still be in editor
      expect(await isEditorFocused(page)).toBe(true);

      // Second undo
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toContainText('Start');

      // Focus should still be in editor
      expect(await isEditorFocused(page)).toBe(true);
    });
  });

  test.describe('multi-block scenarios', () => {
    test('focuses correct block after undo when editing second block', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'First block' },
            },
            {
              type: 'paragraph',
              data: { text: 'Second block' },
            },
          ],
        },
      });

      const secondParagraph = page.locator(`${PARAGRAPH_SELECTOR}:nth-of-type(2)`);
      const secondInput = secondParagraph.locator('[contenteditable="true"]');

      // Focus second block and type
      await secondInput.click();
      await secondInput.type(' edited');

      // Wait for history
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify change
      await expect(secondInput).toContainText('Second block edited');

      // Undo
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Focus should be in the editor
      expect(await isEditorFocused(page)).toBe(true);

      // The second block should have the original text
      await expect(secondInput).toContainText('Second block');
    });
  });

  test.describe('caret Positioning', () => {
    test('caret is positioned correctly after undo when offset becomes 0', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: '' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Focus and type some text
      await input.click();
      await input.type('Hello');

      // Wait for history to record
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Undo to restore empty state
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify text was undone
      await expect(input).toHaveText('');

      // Focus should be preserved and caret should be set (offset 0)
      expect(await isEditorFocused(page)).toBe(true);

      // Should be able to type immediately without clicking
      await page.keyboard.type('New text');
      await expect(input).toContainText('New text');
    });

    test('caret is clamped to content length when offset exceeds content after undo', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Hello World' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Focus at the end and add more text
      await input.click();
      await page.keyboard.press('End');
      await input.type(' extra long content here');

      // Wait for history to record
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Undo to restore shorter text
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify text was undone
      await expect(input).toHaveText('Hello World');

      // Focus should be preserved - caret should be clamped to end of content
      expect(await isEditorFocused(page)).toBe(true);

      // Should be able to type immediately - text should appear at the end (clamped position)
      await page.keyboard.type('!');
      await expect(input).toContainText('Hello World!');
    });
  });

  test.describe('placeholder Visibility', () => {
    test('placeholder disappears after undoing block deletion and text deletion', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Hello' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Focus and select all text
      await input.click();
      await page.keyboard.press(`${MODIFIER_KEY}+a`);

      // Delete all text
      await page.keyboard.press('Backspace');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify block is now empty (has data-blok-empty=true)
      await expect(input).toHaveAttribute('data-blok-empty', 'true');

      // Delete the empty block by pressing backspace again
      await page.keyboard.press('Backspace');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Undo block deletion - block should come back (empty)
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Undo text deletion - text "Hello" should come back
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Get the restored paragraph and input
      const restoredParagraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const restoredInput = restoredParagraph.locator('[contenteditable="true"]');

      // Verify text is restored
      await expect(restoredInput).toHaveText('Hello');

      // Verify placeholder is hidden (data-blok-empty should be false)
      await expect(restoredInput).toHaveAttribute('data-blok-empty', 'false');
    });

    test('placeholder shows correctly when undoing to empty state', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: '' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Verify initially empty
      await expect(input).toHaveAttribute('data-blok-empty', 'true');

      // Type some text
      await input.click();
      await input.type('Some text');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify no longer empty
      await expect(input).toHaveAttribute('data-blok-empty', 'false');

      // Undo to restore empty state
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify text is gone and placeholder should show
      await expect(input).toHaveText('');
      await expect(input).toHaveAttribute('data-blok-empty', 'true');
    });
  });
});
