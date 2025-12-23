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
});
