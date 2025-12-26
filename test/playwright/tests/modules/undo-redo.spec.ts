import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const getParagraphSelectorByIndex = (index: number): string => {
  return `:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`;
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return page.locator(getParagraphSelectorByIndex(index));
};

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

const createBlokWithBlocks = async (
  page: Page,
  blocks: OutputData['blocks']
): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID, blocks });
};

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

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

test.describe('yjs undo/redo', () => {
  // Wait for Yjs captureTimeout (500ms) plus small buffer
  const YJS_CAPTURE_TIMEOUT = 600;

  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('undoes text input with Cmd+Z', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Original text',
        },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    // Click at the end of the paragraph
    await paragraphInput.click();
    await page.keyboard.press('End');

    // Type additional text
    await paragraphInput.type(' added content');

    // Wait for Yjs to capture the change
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Verify the text was added
    await expect(paragraphInput).toContainText('Original text added content');

    // Undo
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    // Verify text is back to original
    await expect(paragraphInput).toContainText('Original text');
    await expect(paragraphInput).not.toContainText('added content');
  });

  test('redoes text input with Cmd+Shift+Z', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Original text',
        },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    // Click at the end of the paragraph
    await paragraphInput.click();
    await page.keyboard.press('End');

    // Type additional text
    await paragraphInput.type(' added');

    // Wait for Yjs to capture the change
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Undo
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    // Verify text is undone
    await expect(paragraphInput).toContainText('Original text');
    await expect(paragraphInput).not.toContainText('added');

    // Redo
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, 200);

    // Verify text is redone
    await expect(paragraphInput).toContainText('Original text added');
  });

  test('undo preserves data correctly after save', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Initial',
        },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    // Click at end and type
    await paragraphInput.click();
    await page.keyboard.press('End');
    await paragraphInput.type(' modified');

    // Wait for Yjs to capture
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Verify modification
    let savedData = await saveBlok(page);

    expect((savedData.blocks[0]?.data as { text?: string }).text).toBe('Initial modified');

    // Undo
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    // Verify undo via save
    savedData = await saveBlok(page);
    expect((savedData.blocks[0]?.data as { text?: string }).text).toBe('Initial');
  });

  test('multiple undos work in sequence', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Base',
        },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    // Make first change
    await paragraphInput.click();
    await page.keyboard.press('End');
    await paragraphInput.type(' first');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Make second change
    await paragraphInput.type(' second');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Verify final state
    await expect(paragraphInput).toContainText('Base first second');

    // First undo
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);
    await expect(paragraphInput).toContainText('Base first');
    await expect(paragraphInput).not.toContainText('second');

    // Second undo
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);
    await expect(paragraphInput).toContainText('Base');
    await expect(paragraphInput).not.toContainText('first');
  });

  test('undo works across different blocks', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
    ]);

    const firstParagraph = getParagraphByIndex(page, 0);
    const secondParagraph = getParagraphByIndex(page, 1);
    const firstInput = firstParagraph.locator('[contenteditable="true"]');
    const secondInput = secondParagraph.locator('[contenteditable="true"]');

    // Modify first block
    await firstInput.click();
    await page.keyboard.press('End');
    await firstInput.type(' modified1');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Modify second block
    await secondInput.click();
    await page.keyboard.press('End');
    await secondInput.type(' modified2');
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Verify both modified
    await expect(firstInput).toContainText('First block modified1');
    await expect(secondInput).toContainText('Second block modified2');

    // Undo second modification
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);
    await expect(secondInput).toContainText('Second block');
    await expect(secondInput).not.toContainText('modified2');

    // First block should still be modified
    await expect(firstInput).toContainText('First block modified1');

    // Undo first modification
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);
    await expect(firstInput).toContainText('First block');
    await expect(firstInput).not.toContainText('modified1');
  });

  test('undo after block insertion removes the block', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Existing block',
        },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    // Focus at end and press Enter to create new block
    await paragraphInput.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Wait for new block to appear
    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Undo should remove the new block
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    // Check that we're back to one block
    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
    await expect(paragraphInput).toContainText('Existing block');
  });

  test('redo after undoing block insertion restores the block', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Existing block',
        },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    // Focus at end and press Enter to create new block
    await paragraphInput.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Undo
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);
    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);

    // Redo should restore the new block
    await page.keyboard.press(REDO_SHORTCUT);
    await waitForDelay(page, 200);

    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);
  });

  test('undo after creating block and typing quickly separates block creation from content', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Existing block',
        },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    // Focus at end and press Enter to create new empty block
    await paragraphInput.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Wait for new block to appear (events are bound synchronously via bindEventsImmediately)
    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);

    // Type quickly using keyboard (focus is already on new block after Enter)
    await page.keyboard.type('hello');

    // Wait for Yjs to capture
    await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

    // Verify state: 2 blocks, second has 'hello'
    const newBlockInput = getParagraphByIndex(page, 1).locator('[contenteditable="true"]');

    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);
    await expect(newBlockInput).toHaveText('hello');

    // Verify data is saved correctly via API
    const savedData = await saveBlok(page);

    expect(savedData.blocks).toHaveLength(2);
    expect((savedData.blocks[1]?.data as { text?: string }).text).toBe('hello');

    // First undo should remove the typed content, leaving empty block
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    // Should still have 2 blocks, but second is empty
    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);
    await expect(newBlockInput).toHaveText('');

    // Second undo should remove the block
    await page.keyboard.press(UNDO_SHORTCUT);
    await waitForDelay(page, 200);

    // Should be back to 1 block
    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
    await expect(paragraphInput).toContainText('Existing block');
  });

  test.describe('edge cases', () => {
    const HEADER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`;

    test('undo after move block restores original position', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          id: 'block-1',
          type: 'paragraph',
          data: { text: 'First paragraph' },
        },
        {
          id: 'block-2',
          type: 'paragraph',
          data: { text: 'Second paragraph' },
        },
        {
          id: 'block-3',
          type: 'paragraph',
          data: { text: 'Third paragraph' },
        },
      ]);

      // Verify initial order
      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);
      const thirdParagraph = getParagraphByIndex(page, 2);

      await expect(firstParagraph.locator('[contenteditable="true"]')).toContainText('First paragraph');
      await expect(secondParagraph.locator('[contenteditable="true"]')).toContainText('Second paragraph');
      await expect(thirdParagraph.locator('[contenteditable="true"]')).toContainText('Third paragraph');

      // Move second block to the end (index 2)
      await page.evaluate(async () => {
        await window.blokInstance?.blocks.move(2, 1);
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify moved order: First, Third, Second
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First paragraph');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Third paragraph');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Second paragraph');

      // Undo should restore original order
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify original order is restored: First, Second, Third
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First paragraph');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Second paragraph');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Third paragraph');

      // Block count should remain the same (block should not disappear)
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);
    });

    test('move block requires single undo (atomic transaction)', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          id: 'block-1',
          type: 'paragraph',
          data: { text: 'First' },
        },
        {
          id: 'block-2',
          type: 'paragraph',
          data: { text: 'Second' },
        },
        {
          id: 'block-3',
          type: 'paragraph',
          data: { text: 'Third' },
        },
      ]);

      // Move second block to the end (index 2)
      await page.evaluate(async () => {
        await window.blokInstance?.blocks.move(2, 1);
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify moved order: First, Third, Second
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Third');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Second');

      // Single undo should restore original order (not require two undos)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify original order: First, Second, Third
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Second');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Third');

      // Second undo should NOT change anything (proves move was atomic, not two operations)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Order should still be: First, Second, Third (no change from previous state)
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Second');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Third');
    });

    test('undo after block convert restores original block type', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Convert me to header' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);

      await expect(paragraph.locator('[contenteditable="true"]')).toContainText('Convert me to header');

      // Convert paragraph to header via API
      await page.evaluate(async () => {
        const block = window.blokInstance?.blocks.getBlockByIndex(0);

        if (block) {
          await window.blokInstance?.blocks.convert(block.id, 'header', { text: 'Convert me to header', level: 2 });
        }
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify it's now a header
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(0);
      await expect(page.locator(HEADER_SELECTOR).locator('[contenteditable="true"]')).toContainText('Convert me to header');

      // Single undo should restore to paragraph
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify it's back to paragraph
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(0);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Convert me to header');
    });

    test('undo after block split rejoins blocks (single undo)', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Hello World' },
        },
      ]);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Click and position cursor after "Hello" (before the space)
      await paragraphInput.click();

      // Position cursor after "Hello" using JavaScript for precision
      await page.evaluate(() => {
        const paragraph = document.querySelector('[data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable="true"]');

        if (paragraph) {
          const textNode = paragraph.firstChild;

          if (textNode) {
            const range = document.createRange();
            const sel = window.getSelection();

            // Position after "Hello" (5 characters)
            range.setStart(textNode, 5);
            range.setEnd(textNode, 5);
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }
      });

      // Press Enter to split the block
      await page.keyboard.press('Enter');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify split happened: now 2 blocks
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('Hello');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toHaveText(' World');

      // Single undo should rejoin the blocks
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify blocks are rejoined: back to 1 block with original text
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('Hello World');
    });

    test('redo after undoing block split re-splits the block', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'First Second' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      await paragraphInput.click();

      // Position cursor after "First"
      await page.evaluate(() => {
        const paragraph = document.querySelector('[data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable="true"]');

        if (paragraph) {
          const textNode = paragraph.firstChild;

          if (textNode) {
            const range = document.createRange();
            const sel = window.getSelection();

            range.setStart(textNode, 5);
            range.setEnd(textNode, 5);
            sel?.removeAllRanges();
            sel?.addRange(range);
          }
        }
      });

      // Split
      await page.keyboard.press('Enter');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('First Second');

      // Redo should re-split the block
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('First');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toHaveText(' Second');
    });

    test('undo after block merge separates blocks (single undo)', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'First part' },
        },
        {
          type: 'paragraph',
          data: { text: 'Second part' },
        },
      ]);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);

      // Click at the beginning of the second block
      const secondParagraph = getParagraphByIndex(page, 1);
      const secondInput = secondParagraph.locator('[contenteditable="true"]');

      await secondInput.click();
      await page.keyboard.press('Home');

      // Press Backspace to merge with previous block
      await page.keyboard.press('Backspace');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify merge happened: now 1 block with combined text
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First partSecond part');

      // Single undo should separate the blocks
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify blocks are separated again
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First part');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Second part');
    });

    test('undo after clear restores all blocks', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Block one' },
        },
        {
          type: 'paragraph',
          data: { text: 'Block two' },
        },
        {
          type: 'paragraph',
          data: { text: 'Block three' },
        },
      ]);

      // Verify initial state
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);

      // Clear all blocks
      await page.evaluate(async () => {
        await window.blokInstance?.blocks.clear();
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify cleared: should have 1 default empty block
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);

      // Single undo should restore all 3 blocks (not 4!)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify all blocks restored
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Block one');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Block two');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Block three');
    });

    test('redo after undoing clear removes blocks again', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Will be cleared' },
        },
        {
          type: 'paragraph',
          data: { text: 'Also cleared' },
        },
      ]);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);

      // Clear
      await page.evaluate(async () => {
        await window.blokInstance?.blocks.clear();
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);

      // Redo should clear again
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
    });

    test('undo/redo cycle after removing last block does not corrupt undo stack', async ({ page }) => {
      // Start with a single block
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Only block' },
        },
      ]);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Only block');

      // Delete the only block via API
      await page.evaluate(async () => {
        await window.blokInstance?.blocks.delete(0);
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Should have 1 default empty block after deletion
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('');

      // Undo should restore "Only block"
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Only block');

      // Redo should delete it again (leaving default empty block)
      // This verifies the default block insertion during undo didn't corrupt the stack
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('');

      // Undo again should still work correctly
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Only block');
    });

  });
});
