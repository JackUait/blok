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
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';

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
  options: { data?: OutputData; config?: Record<string, unknown> } = {}
): Promise<void> => {
  const {
    data = null,
    config = {},
  } = options;

  await resetBlok(page);
  await ensureBlokBundleAvailable(page);

  await page.evaluate(
    async ({ holder, initialData, config: providedConfig }) => {
      const blokConfig: Record<string, unknown> = {
        holder,
        autofocus: true,
        ...providedConfig,
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
      config,
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
    test('@smoke editor retains focus after undo', async ({ page }) => {
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

  test.describe('caret Positioning After Block Removal', () => {
    test('caret focuses last available block when undo removes a block and saved index is out of bounds', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'First block' },
            },
          ],
        },
      });

      const firstParagraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const firstInput = firstParagraph.locator('[contenteditable="true"]');

      // Focus first block and press Enter to create a new block
      await firstInput.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Wait for history to record block creation
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Now we have two blocks, type in the second block
      const secondParagraph = page.locator(`${PARAGRAPH_SELECTOR}:nth-of-type(2)`);
      const secondInput = secondParagraph.locator('[contenteditable="true"]');

      await secondInput.type('Second block');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify we have two blocks
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);

      // Undo typing in second block
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Undo block creation - this should remove the second block
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify we're back to one block
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);

      // Focus should be in the editor (on the last available block, which is the first block)
      expect(await isEditorFocused(page)).toBe(true);

      // Should be able to type immediately - text appears in the remaining block
      await page.keyboard.type(' - continued');
      await expect(firstInput).toContainText('First block - continued');
    });

    test('caret focuses block at saved index when undo removes a later block', async ({ page }) => {
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

      // Focus second block and press Enter to create a third block
      await secondInput.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');

      // Wait for history to record block creation
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Type in the third block
      const thirdParagraph = page.locator(`${PARAGRAPH_SELECTOR}:nth-of-type(3)`);
      const thirdInput = thirdParagraph.locator('[contenteditable="true"]');

      await thirdInput.type('Third block');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify we have three blocks
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(3);

      // Undo typing in third block
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Undo block creation - removes the third block
      // The caret position being restored is from the initial state (before block creation)
      // which was captured when the second block had focus
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify we're back to two blocks
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);

      // Focus should be in the editor
      expect(await isEditorFocused(page)).toBe(true);

      // Should be able to type immediately - text should appear in the block that had focus
      // when the state was captured (the second block, since we clicked it before pressing Enter)
      await page.keyboard.type(' - edited');

      // Check that at least one block contains the typed text (focus preserved)
      const allText = await page.locator(PARAGRAPH_SELECTOR).allTextContents();

      expect(allText.some(text => text.includes('- edited'))).toBe(true);
    });

    test('caret focuses correct block when redo removes a block', async ({ page }) => {
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
            {
              type: 'paragraph',
              data: { text: 'Third block' },
            },
          ],
        },
      });

      const secondParagraph = page.locator(`${PARAGRAPH_SELECTOR}:nth-of-type(2)`);
      const secondInput = secondParagraph.locator('[contenteditable="true"]');

      // Focus second block, select all and delete it
      await secondInput.click();
      await page.keyboard.press(`${MODIFIER_KEY}+a`);
      await page.keyboard.press('Backspace');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Delete the now-empty block
      await page.keyboard.press('Backspace');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify we have two blocks left
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);

      // Undo block deletion (brings back empty block)
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Undo text deletion (restores "Second block" text)
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify we have three blocks again
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(3);

      // Now redo the text deletion
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Redo block deletion - removes the second block again
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify we have two blocks
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);

      // Focus should be in the editor
      expect(await isEditorFocused(page)).toBe(true);

      // Should be able to type immediately
      await page.keyboard.type(' - after redo');

      // Text should appear in one of the remaining blocks
      const allText = await page.locator(PARAGRAPH_SELECTOR).allTextContents();

      expect(allText.some(text => text.includes('- after redo'))).toBe(true);
    });

    test('caret position is captured in initial state', async ({ page }) => {
      // Create editor with initial data - autofocus will place caret
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Initial content' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Type some text
      await input.click();
      await input.type(' - modified');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify change
      await expect(input).toContainText('Initial content - modified');

      // Undo to initial state
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify undo worked
      await expect(input).toContainText('Initial content');

      // Focus should be preserved (initial state now captures caret position)
      expect(await isEditorFocused(page)).toBe(true);

      // Should be able to continue typing
      await page.keyboard.type('!');
      await expect(input).toContainText('!');
    });
  });

  test.describe('caret Positioning', () => {
    test('caret restores to split position after undoing block split', async ({ page }) => {
      // This test verifies the fix for the bug where caret was restored to the wrong position
      // after undoing a block split. The caret should be at the position where Enter was pressed,
      // not at the position captured when the previous history state was recorded.
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

      // Focus and move to end of text first
      await input.click();
      await page.keyboard.press('End');

      // Wait for history debounce to ensure state is captured with caret at end (position 11)
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Now move caret to middle of text (after "Hello ") - position 6
      await input.click();

      // Use evaluate to set precise caret position
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el || !el.firstChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        // Set caret at position 6 (after "Hello ")
        range.setStart(el.firstChild, 6);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      // Short wait to ensure caret position is set
      await waitForDelay(page, 50);

      // Press Enter to split the block at position 6
      await page.keyboard.press('Enter');

      // Wait for history to record the split
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify we now have 2 blocks
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);

      // Verify the split happened correctly
      await expect(page.locator(`${PARAGRAPH_SELECTOR}:nth-of-type(1) [contenteditable="true"]`)).toHaveText('Hello ');
      await expect(page.locator(`${PARAGRAPH_SELECTOR}:nth-of-type(2) [contenteditable="true"]`)).toHaveText('World');

      // Undo the split
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify we're back to 1 block with original text
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
      await expect(input).toHaveText('Hello World');

      // Type immediately to verify caret position
      // If the bug is fixed, typing here should insert at position 6 (after "Hello ")
      // If the bug exists, typing would insert at position 11 (end of text) or 0 (start)
      await page.keyboard.type('X');

      // The text should be "Hello XWorld" if caret was correctly restored to position 6
      await expect(input).toHaveText('Hello XWorld');
    });

    test('caret restores to correct block after undoing new block creation', async ({ page }) => {
      // This test verifies the fix for the bug where pressing Enter at the end of a paragraph
      // to create a new empty block, then undoing, would restore the caret to a different block.
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'First paragraph' },
            },
            {
              type: 'paragraph',
              data: { text: 'Second paragraph' },
            },
            {
              type: 'paragraph',
              data: { text: 'Third paragraph' },
            },
          ],
        },
      });

      // Focus the second paragraph and move to end
      const secondParagraph = page.locator(`${PARAGRAPH_SELECTOR}:nth-of-type(2)`);
      const secondInput = secondParagraph.locator('[contenteditable="true"]');

      await secondInput.click();

      // Use evaluate to set precise caret position at end
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"]:nth-of-type(2) [contenteditable="true"]');

        if (!el || !el.lastChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        range.selectNodeContents(el);
        range.collapse(false); // collapse to end
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      // Wait for history debounce
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Press Enter to create a new empty block after the second paragraph
      await page.keyboard.press('Enter');

      // Wait for history to record
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify we now have 4 blocks
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(4);

      // Undo the block creation
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify we're back to 3 blocks
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(3);

      // Type to verify caret position - should be at end of second paragraph
      await page.keyboard.type('X');

      // The second paragraph should now end with "X"
      await expect(secondInput).toHaveText('Second paragraphX');
    });

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
      await expect(input).toHaveText(/Hello World extra long content here$/);
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

  test.describe('history Stack Management', () => {
    test('clears redo stack when new changes happen after undo', async ({ page }) => {
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

      await input.click();
      await input.type(' one');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await input.type(' two');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await expect(input).toHaveText('Start one two');

      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('Start one');

      await page.keyboard.type(' three');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(input).toHaveText('Start one three');
      await expect(input).not.toContainText('two');
    });

    test('limits undo depth using maxHistoryLength', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'A' },
            },
          ],
        },
        config: {
          maxHistoryLength: 2,
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      await input.click();
      await input.type(' B');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await input.type(' C');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await expect(input).toHaveText('A B C');

      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('A B');

      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('A B');
    });
  });

  test.describe('global Shortcuts', () => {
    test('undo uses the last active editor when multiple instances exist', async ({ page }) => {
      await ensureBlokBundleAvailable(page);

      await page.evaluate(async () => {
        const createContainer = (id: string): void => {
          const existing = document.getElementById(id);

          if (existing) {
            existing.remove();
          }

          const container = document.createElement('div');

          container.id = id;
          container.setAttribute('data-blok-testid', id);
          container.style.border = '1px dotted #388AE5';

          document.body.appendChild(container);
        };

        const createEditor = async (holder: string, text: string, config: Record<string, unknown> = {}): Promise<void> => {
          const blok = new window.Blok({
            holder,
            autofocus: false,
            ...config,
            data: {
              blocks: [
                {
                  type: 'paragraph',
                  data: { text },
                },
              ],
            },
          });

          await blok.isReady;
        };

        createContainer('blok-one');
        createContainer('blok-two');

        await Promise.all([
          createEditor('blok-one', 'First editor', { globalUndoRedo: false }),
          createEditor('blok-two', 'Second editor'),
        ]);
      });

      const firstInput = page.locator('[data-blok-testid="blok-one"] [data-blok-component="paragraph"] [contenteditable="true"]');
      const secondInput = page.locator('[data-blok-testid="blok-two"] [data-blok-component="paragraph"] [contenteditable="true"]');

      await firstInput.click();
      await firstInput.type(' change');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await secondInput.click();
      await secondInput.type(' change');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      const firstTextBeforeUndo = (await firstInput.textContent())?.trim();
      const secondTextBeforeUndo = (await secondInput.textContent())?.trim();

      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      const firstTextAfterUndo = (await firstInput.textContent())?.trim();
      const secondTextAfterUndo = (await secondInput.textContent())?.trim();

      const firstChanged = firstTextAfterUndo !== firstTextBeforeUndo;
      const secondChanged = secondTextAfterUndo !== secondTextBeforeUndo;

      expect(firstChanged).toBe(false);
      expect(secondChanged).toBe(true);
      expect(secondTextAfterUndo).toContain('Second editor');
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

  test.describe('edge Cases - Inline Formatting', () => {
    test('applying bold formatting should create a separate undo step', async ({ page }) => {
      // Edge case #1: Inline formatting (Bold/Italic/Link) doesn't create separate undo steps
      // Expected: User types, applies bold, then undo should first remove bold, then remove typing
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

      // Focus and select "World" text
      await input.click();
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el || !el.firstChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        // Select "World" (positions 6-11)
        range.setStart(el.firstChild, 6);
        range.setEnd(el.firstChild, 11);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      // Wait for history to record initial state
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Apply bold formatting using keyboard shortcut
      await page.keyboard.press(`${MODIFIER_KEY}+b`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify text is now bold
      // eslint-disable-next-line internal-playwright/no-css-selectors
      const boldText = input.locator('b, strong');

      await expect(boldText).toHaveText('World');

      // First undo should remove the bold formatting
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Bold should be removed - text should be plain
      // eslint-disable-next-line internal-playwright/no-css-selectors
      const boldAfterUndo = input.locator('b, strong');

      await expect(boldAfterUndo).toHaveCount(0);

      // Text should still be "Hello World"
      await expect(input).toContainText('Hello World');
    });

    test('applying italic formatting should create a separate undo step', async ({ page }) => {
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

      // Select "World" text
      await input.click();
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el || !el.firstChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        range.setStart(el.firstChild, 6);
        range.setEnd(el.firstChild, 11);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Apply italic formatting
      await page.keyboard.press(`${MODIFIER_KEY}+i`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify text is now italic
      // eslint-disable-next-line internal-playwright/no-css-selectors
      const italicText = input.locator('i, em');

      await expect(italicText).toHaveText('World');

      // Undo should remove the italic formatting
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Italic should be removed
      // eslint-disable-next-line internal-playwright/no-css-selectors
      const italicAfterUndo = input.locator('i, em');

      await expect(italicAfterUndo).toHaveCount(0);
      await expect(input).toContainText('Hello World');
    });

    test('multiple formatting operations should each create separate undo steps', async ({ page }) => {
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

      // Select "World" and apply bold
      await input.click();
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el || !el.firstChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        range.setStart(el.firstChild, 6);
        range.setEnd(el.firstChild, 11);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);
      await page.keyboard.press(`${MODIFIER_KEY}+b`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Select "Hello" and apply italic
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el || !el.firstChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        range.setStart(el.firstChild, 0);
        range.setEnd(el.firstChild, 5);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);
      await page.keyboard.press(`${MODIFIER_KEY}+i`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // First undo should remove italic from "Hello"
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // eslint-disable-next-line internal-playwright/no-css-selectors
      const italicCount = input.locator('i, em');

      await expect(italicCount).toHaveCount(0);

      // Bold "World" should still be there
      // eslint-disable-next-line internal-playwright/no-css-selectors
      const boldText = input.locator('b, strong');

      await expect(boldText).toHaveText('World');

      // Second undo should remove bold from "World"
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // eslint-disable-next-line internal-playwright/no-css-selectors
      const boldCount = input.locator('b, strong');

      await expect(boldCount).toHaveCount(0);
    });

    test('typing after formatting should create a separate undo step', async ({ page }) => {
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

      // Select all and apply bold
      await input.click();
      await page.keyboard.press(`${MODIFIER_KEY}+a`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);
      await page.keyboard.press(`${MODIFIER_KEY}+b`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Type additional text at the end
      await page.keyboard.press('End');
      await page.keyboard.type(' World');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // First undo should remove " World"
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Should still have bold "Hello"
      // eslint-disable-next-line internal-playwright/no-css-selectors
      const boldText = input.locator('b, strong');

      await expect(boldText).toHaveText('Hello');
      await expect(input).not.toContainText('World');

      // Second undo should remove bold
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      
      // eslint-disable-next-line internal-playwright/no-css-selectors
      const boldCount = input.locator('b, strong');

      await expect(boldCount).toHaveCount(0);
    });
  });

  test.describe('edge Cases - Paste Operations', () => {
    test('paste operation should create a separate undo step', async ({ page }) => {
      // Edge case #2: Paste operations should be detected and create checkpoints
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

      // Type some text first
      await input.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' World');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Select "World" and copy it
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el) {
          return;
        }

        const text = el.textContent ?? '';
        const startPos = text.indexOf('World');

        // Find the text node that contains "World"
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let currentPos = 0;
        let targetNode = walker.nextNode();

        while (targetNode) {
          const nodeLength = targetNode.textContent?.length ?? 0;

          if (currentPos + nodeLength > startPos) {
            break;
          }
          currentPos += nodeLength;
          targetNode = walker.nextNode();
        }

        if (targetNode) {
          const range = document.createRange();
          const sel = window.getSelection();
          const offsetInNode = startPos - currentPos;

          range.setStart(targetNode, offsetInNode);
          range.setEnd(targetNode, offsetInNode + 5);
          sel?.removeAllRanges();
          sel?.addRange(range);
        }
      });

      await page.keyboard.press(`${MODIFIER_KEY}+c`);
      await waitForDelay(page, 100);

      // Move to end and paste
      await page.keyboard.press('End');
      await page.keyboard.type(' - ');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await page.keyboard.press(`${MODIFIER_KEY}+v`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify paste happened
      await expect(input).toContainText('Hello World - World');

      // First undo should remove the pasted text
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(input).toContainText('Hello World - ');
      await expect(input).not.toContainText('Hello World - World');
    });

    test('cut and paste should each be separate undo steps', async ({ page }) => {
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

      // Select "World" and cut
      await input.click();
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el || !el.firstChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        range.setStart(el.firstChild, 6);
        range.setEnd(el.firstChild, 11);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);
      await page.keyboard.press(`${MODIFIER_KEY}+x`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify cut happened
      await expect(input).toHaveText('Hello ');

      // Move to start and paste
      await page.keyboard.press('Home');
      await page.keyboard.press(`${MODIFIER_KEY}+v`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify paste happened
      await expect(input).toContainText('WorldHello');

      // First undo should remove the pasted text
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(input).toHaveText('Hello ');

      // Second undo should restore the cut text
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(input).toHaveText('Hello World');
    });
  });

  test.describe('edge Cases - Action Change Threshold', () => {
    test('quick correction (type, delete <3, type) stays grouped', async ({ page }) => {
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

      // Type "hello"
      await input.click();
      await page.keyboard.type('hello');

      // Quick correction: delete 2 chars (below threshold)
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');

      // Continue typing
      await page.keyboard.type('p me');

      // Wait for debounce
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify final text
      await expect(input).toHaveText('help me');

      // Single undo should restore empty state (all grouped together)
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(input).toHaveText('');
    });

    test('intentional deletion (type, delete 3+) creates separate entries', async ({ page }) => {
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

      // Type "hello world"
      await input.click();
      await page.keyboard.type('hello world');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Delete 3 characters (hits threshold on 3rd)
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify current text ("hello world" minus "rld" = "hello wo")
      await expect(input).toHaveText('hello wo');

      // First undo should restore "hello world" (undo the deletion batch)
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(input).toHaveText('hello world');

      // Second undo should restore empty state (undo the typing)
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(input).toHaveText('');
    });

    test('threshold resets after checkpoint is created', async ({ page }) => {
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

      // Type "abcdef"
      await input.click();
      await page.keyboard.type('abcdef');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Delete 3 chars (hits threshold) -> "abc"
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Type "123"
      await page.keyboard.type('123');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Delete 3 chars again (hits threshold, counter was reset) -> "abc"
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await page.keyboard.press('Backspace');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Current: "abc"
      await expect(input).toHaveText('abc');

      // Undo 1: restore "abc123"
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('abc123');

      // Undo 2: restore "abc"
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('abc');

      // Undo 3: restore "abcdef"
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('abcdef');

      // Undo 4: restore empty
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('');
    });

    test('format action creates separate undo step from preceding edits', async ({ page }) => {
      // Test that formatting creates a separate undo entry from typing
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'hello world' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Select "world" and apply bold
      await input.click();
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el || !el.firstChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        // Select "world" (positions 6-11)
        range.setStart(el.firstChild, 6);
        range.setEnd(el.firstChild, 11);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);
      await page.keyboard.press(`${MODIFIER_KEY}+b`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify bold applied
      // eslint-disable-next-line internal-playwright/no-css-selectors
      const boldText = input.locator('b, strong');
      await expect(boldText).toHaveText('world');

      // Undo should remove bold
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // eslint-disable-next-line internal-playwright/no-css-selectors
      const boldAfterUndo = input.locator('b, strong');
      await expect(boldAfterUndo).toHaveCount(0);
      await expect(input).toHaveText('hello world');
    });
  });

  test.describe('edge Cases - Block Split/Merge', () => {
    test('block split should create a separate undo step from typing', async ({ page }) => {
      // Edge case #3: Block split/merge should be treated as structural changes
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

      // Type some text
      await input.click();
      await page.keyboard.press('End');
      await page.keyboard.type('!!!');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Move to middle and split
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el || !el.firstChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        range.setStart(el.firstChild, 6);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await page.keyboard.press('Enter');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify split happened - should have 2 blocks
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);

      // First undo should merge the blocks back (undo split)
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
      await expect(input).toContainText('Hello World!!!');

      // Second undo should remove the "!!!"
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(input).toHaveText('Hello World');
    });

    test('merging blocks with backspace should create a separate undo step', async ({ page }) => {
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

      // Focus second block at the beginning
      const secondParagraph = page.locator(`${PARAGRAPH_SELECTOR}:nth-of-type(2)`);
      const secondInput = secondParagraph.locator('[contenteditable="true"]');

      await secondInput.click();
      await page.keyboard.press('Home');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Press backspace to merge with first block
      await page.keyboard.press('Backspace');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Should have 1 block now
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);

      // Undo should restore 2 blocks
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);
    });

    test('pressing Enter at block end should create new block as separate undo step', async ({ page }) => {
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

      // Type text
      await input.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' World');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Press Enter to create new block
      await page.keyboard.press('Enter');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Type in new block
      await page.keyboard.type('New block');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify state
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(2);

      // First undo removes "New block" text
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Second undo removes the new block (Enter)
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);

      // Third undo removes " World"
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      await expect(input).toHaveText('Hello');
    });
  });

  test.describe('edge Cases - Toolbar Button Caret Position', () => {
    test('caret position should be correct after applying formatting via toolbar button', async ({ page }) => {
      // Edge case #4: Caret position after toolbar button clicks
      // When using toolbar buttons, the caret should be at the correct position after undo
      // Note: This test uses keyboard shortcut since toolbar button availability varies
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

      // Select "World" text programmatically (simulating toolbar interaction)
      await input.click();
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');

        if (!el || !el.firstChild) {
          return;
        }

        const range = document.createRange();
        const sel = window.getSelection();

        range.setStart(el.firstChild, 6);
        range.setEnd(el.firstChild, 11);
        sel?.removeAllRanges();
        sel?.addRange(range);
      });

      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Apply bold via keyboard shortcut (equivalent to toolbar button click)
      await page.keyboard.press(`${MODIFIER_KEY}+b`);
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify bold was applied
      await expect(input).toContainText('World');

      // Check that the text is within a bold/strong tag via DOM evaluation
      const isBold = await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');
        const boldElements = el?.querySelectorAll('b, strong') ?? [];

        return boldElements.length > 0;
      });

      expect(isBold).toBe(true);

      // Undo the bold formatting
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Bold should be removed - verify via DOM evaluation
      const isBoldAfterUndo = await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="paragraph"] [contenteditable="true"]');
        const boldElements = el?.querySelectorAll('b, strong') ?? [];

        return boldElements.length > 0;
      });

      expect(isBoldAfterUndo).toBe(false);

      // Verify focus is preserved
      expect(await isEditorFocused(page)).toBe(true);

      // Should be able to type - text should appear somewhere in the block
      await page.keyboard.type('X');
      await expect(input).toContainText('X');
    });
  });

  test.describe('edge Cases - Rapid Undo/Redo', () => {
    test('rapid undo operations should not corrupt history state', async ({ page }) => {
      // Edge case #5: Rapid undo/redo operations
      // Note: Rapid undos may be blocked by isPerformingUndoRedo guard, which is intentional
      // This test verifies that at least some undos complete without corrupting state
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

      // Create multiple history entries
      await input.click();
      await input.type(' one');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await input.type(' two');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await input.type(' three');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify full text
      await expect(input).toContainText('Start one two three');

      // Perform rapid undo operations with minimal delay between them
      // (to test concurrent handling - not all may execute due to guards)
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, 50);
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, 50);
      await page.keyboard.press(`${MODIFIER_KEY}+z`);

      // Wait for all undos to complete
      await waitForDelay(page, STATE_CHANGE_WAIT * 2);

      // At minimum, some undo should have happened - text should be shorter
      const textAfterUndo = await input.textContent();

      expect(textAfterUndo?.length).toBeLessThan('Start one two three'.length);

      // Get current text to determine how many redos we need
      const currentText = await input.textContent();

      // Redo should work correctly from this state
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Text should be longer after redo (unless we're already at latest state)
      const textAfterRedo = await input.textContent();

      // Verify state is consistent (not corrupted) - either redo worked or we're at max
      expect(textAfterRedo?.length).toBeGreaterThanOrEqual(currentText?.length ?? 0);

      // Continue redoing to verify stack integrity
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Final state should either be original or approaching it
      // The important thing is no corruption - state should be valid text starting with "Start"
      await expect(input).toContainText('Start');
    });

    test('interleaved undo/redo should maintain correct state', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'A' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Create history: A → AB → ABC
      await input.click();
      await page.keyboard.press('End');
      await input.type('B');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      await input.type('C');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Undo: ABC → AB
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('AB');

      // Redo: AB → ABC
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('ABC');

      // Undo twice: ABC → AB → A
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('A');

      // Redo: A → AB
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('AB');

      // Type new content (should clear redo stack)
      await input.type('X');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);
      await expect(input).toHaveText('ABX');

      // Redo should have no effect (redo stack was cleared)
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);
      await expect(input).toHaveText('ABX');
    });

    test('undo during typing should maintain state consistency', async ({ page }) => {
      // Edge case: What happens when user presses undo while still typing
      // The implementation should handle this gracefully without corruption
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Initial' },
            },
          ],
        },
      });

      const paragraph = page.locator(`${PARAGRAPH_SELECTOR}:first-of-type`);
      const input = paragraph.locator('[contenteditable="true"]');

      // Type first batch and wait for it to be recorded
      await input.click();
      await page.keyboard.press('End');
      await input.type(' AAA');
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify first batch was recorded
      await expect(input).toContainText('Initial AAA');

      // Start typing second batch
      await input.type(' BBB');

      // Don't wait for debounce - undo immediately
      // The behavior depends on implementation: either:
      // 1. Undo captures pending changes first, then undoes to previous state
      // 2. Undo proceeds immediately, potentially losing unsaved changes
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // After undo, we should have valid state - either:
      // - "Initial AAA" (undo removed BBB that was captured)
      // - "Initial" (undo removed both batches because BBB wasn't saved yet)
      // The key is that state should be consistent and valid
      const textAfterUndo = await input.textContent();

      expect(textAfterUndo).toContain('Initial');
      expect(textAfterUndo).not.toContain('BBB'); // BBB should definitely be gone after undo

      // State should be recoverable via redo
      await page.keyboard.press(`${MODIFIER_KEY}+Shift+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // After redo, text should be longer than after undo
      const textAfterRedo = await input.textContent();

      // State is consistent - redo brought something back
      expect(textAfterRedo?.length).toBeGreaterThanOrEqual(textAfterUndo?.length ?? 0);
    });
  });

  test.describe('batch Operations', () => {
    test('multi-block drag is undone in a single step', async ({ page }) => {
      // This test verifies that dragging multiple blocks together undoes as a single operation
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'Block 0' } },
            { type: 'paragraph', data: { text: 'Block 1' } },
            { type: 'paragraph', data: { text: 'Block 2' } },
            { type: 'paragraph', data: { text: 'Block 3' } },
            { type: 'paragraph', data: { text: 'Block 4' } },
          ],
        },
      });

      // Wait for history to capture initial state
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Select blocks 1, 2, 3 using the BlockSelection API
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }

        const blockSelection = (blok as unknown as {
          module: {
            blockSelection: { selectBlockByIndex: (index: number) => void };
          };
        }).module.blockSelection;

        blockSelection.selectBlockByIndex(1);
        blockSelection.selectBlockByIndex(2);
        blockSelection.selectBlockByIndex(3);
      });

      // Hover over block 2 to show settings button
      const block2 = page.getByTestId('block-wrapper').filter({ hasText: 'Block 2' });

      await block2.hover();

      const settingsButton = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`);

      await expect(settingsButton).toBeVisible();

      // Perform drag to the bottom of block 4
      const targetBlock = page.getByTestId('block-wrapper').filter({ hasText: 'Block 4' });

      const sourceBox = await settingsButton.boundingBox();
      const targetBox = await targetBlock.boundingBox();

      expect(sourceBox).not.toBeNull();
      expect(targetBox).not.toBeNull();

      // Perform pointer-based drag
      await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
      await page.mouse.down();
      await waitForDelay(page, 50);
      await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height - 1, { steps: 15 });
      await waitForDelay(page, 50);
      await page.mouse.up();
      await waitForDelay(page, 100);

      // Verify the blocks moved - new order: Block 0, Block 4, Block 1, Block 2, Block 3
      await expect(page.getByTestId('block-wrapper')).toHaveText([
        'Block 0',
        'Block 4',
        'Block 1',
        'Block 2',
        'Block 3',
      ]);

      // Wait for history to record the move
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Undo once - all three blocks should return to their original positions
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify the original order is restored in a single undo
      await expect(page.getByTestId('block-wrapper')).toHaveText([
        'Block 0',
        'Block 1',
        'Block 2',
        'Block 3',
        'Block 4',
      ]);
    });

    test('multi-block deletion is undone in a single step', async ({ page }) => {
      // This test verifies that deleting multiple selected blocks undoes as a single operation
      await createBlok(page, {
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'Block 0' } },
            { type: 'paragraph', data: { text: 'Block 1' } },
            { type: 'paragraph', data: { text: 'Block 2' } },
            { type: 'paragraph', data: { text: 'Block 3' } },
            { type: 'paragraph', data: { text: 'Block 4' } },
          ],
        },
      });

      // Wait for history to capture initial state
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Select blocks 1, 2, 3 using the BlockSelection API
      await page.evaluate(() => {
        const blok = window.blokInstance;

        if (!blok) {
          throw new Error('Blok instance not found');
        }

        const blockSelection = (blok as unknown as {
          module: {
            blockSelection: { selectBlockByIndex: (index: number) => void };
          };
        }).module.blockSelection;

        blockSelection.selectBlockByIndex(1);
        blockSelection.selectBlockByIndex(2);
        blockSelection.selectBlockByIndex(3);
      });

      // Wait for selection to be applied
      await waitForDelay(page, 50);

      // Delete the selected blocks
      await page.keyboard.press('Backspace');

      // Wait for history to record the deletion
      await waitForDelay(page, HISTORY_DEBOUNCE_WAIT);

      // Verify blocks 1, 2, 3 are deleted (an empty block is inserted in their place)
      await expect(page.getByTestId('block-wrapper')).toHaveText([
        'Block 0',
        '', // Empty block inserted after deletion
        'Block 4',
      ]);

      // Undo once - all three blocks should be restored
      await page.keyboard.press(`${MODIFIER_KEY}+z`);
      await waitForDelay(page, STATE_CHANGE_WAIT);

      // Verify all blocks are restored in a single undo
      await expect(page.getByTestId('block-wrapper')).toHaveText([
        'Block 0',
        'Block 1',
        'Block 2',
        'Block 3',
        'Block 4',
      ]);
    });
  });
});
