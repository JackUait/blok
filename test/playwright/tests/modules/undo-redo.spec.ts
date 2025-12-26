import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const HEADER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`;
const LIST_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="list"]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const TOOLBOX_ITEM_SELECTOR = (itemName: string): string =>
  `[data-blok-testid="popover-item"][data-blok-item-name="${itemName}"]`;
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

  test.describe('inline formatting', () => {
    const INLINE_TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid=inline-toolbar]`;

    /**
     * Select text within a contenteditable element
     */
    const selectText = async (locator: Locator, text: string): Promise<void> => {
      await locator.evaluate((element, targetText) => {
        const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let textNode: Node | null = null;
        let start = -1;

        while (walker.nextNode()) {
          const node = walker.currentNode;
          const content = node.textContent ?? '';
          const idx = content.indexOf(targetText);

          if (idx !== -1) {
            textNode = node;
            start = idx;
            break;
          }
        }

        if (!textNode || start === -1) {
          throw new Error(`Text "${targetText}" was not found in element`);
        }

        const range = element.ownerDocument.createRange();

        range.setStart(textNode, start);
        range.setEnd(textNode, start + targetText.length);

        const selection = element.ownerDocument.getSelection();

        selection?.removeAllRanges();
        selection?.addRange(range);

        element.ownerDocument.dispatchEvent(new Event('selectionchange'));
      }, text);
    };

    test('undo removes bold formatting', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'Hello world',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Select "Hello" and apply bold
      await selectText(paragraphInput, 'Hello');

      // Click bold button
      const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="bold"]`);

      await expect(boldButton).toBeVisible();
      await boldButton.click();

      // Wait for Yjs to capture
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify bold was applied
      const html = await paragraphInput.innerHTML();

      expect(html).toMatch(/<strong>Hello<\/strong>/);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify bold was removed
      const htmlAfterUndo = await paragraphInput.innerHTML();

      expect(htmlAfterUndo).not.toMatch(/<strong>/);
      expect(htmlAfterUndo).toBe('Hello world');
    });

    test('redo restores bold formatting', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'Hello world',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Select "Hello" and apply bold
      await selectText(paragraphInput, 'Hello');

      const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="bold"]`);

      await expect(boldButton).toBeVisible();
      await boldButton.click();

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify bold was applied
      let html = await paragraphInput.innerHTML();

      expect(html).toMatch(/<strong>Hello<\/strong>/);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify bold was removed
      html = await paragraphInput.innerHTML();
      expect(html).not.toMatch(/<strong>/);

      // Redo
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify bold is back
      html = await paragraphInput.innerHTML();
      expect(html).toMatch(/<strong>Hello<\/strong>/);
    });

    test('undo removes italic formatting', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'Hello world',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Select "world" and apply italic
      await selectText(paragraphInput, 'world');

      const italicButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`);

      await expect(italicButton).toBeVisible();
      await italicButton.click();

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify italic was applied (browser uses <i> tag)
      let html = await paragraphInput.innerHTML();

      expect(html).toMatch(/<(i|em)>world<\/(i|em)>/);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify italic was removed
      html = await paragraphInput.innerHTML();
      expect(html).not.toMatch(/<(i|em)>/);
      expect(html).toBe('Hello world');
    });

    test('undo removes link formatting', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'Click here for more',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Select "here" and apply link
      await selectText(paragraphInput, 'here');

      const linkButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="link"]`);

      await expect(linkButton).toBeVisible();
      await linkButton.click();

      // Enter the URL
      const linkInput = page.locator('[data-blok-link-tool-input-opened="true"]');

      await expect(linkInput).toBeVisible();
      await linkInput.fill('https://example.com');
      await linkInput.press('Enter');

      // Wait for link input to close
      await linkInput.waitFor({ state: 'hidden' });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify link was applied
      let html = await paragraphInput.innerHTML();

      expect(html).toMatch(/<a[^>]*href="https:\/\/example\.com"[^>]*>here<\/a>/);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify link was removed
      html = await paragraphInput.innerHTML();
      expect(html).not.toMatch(/<a /);
      expect(html).toBe('Click here for more');
    });

    test('multiple inline format changes can be undone sequentially', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'Hello world',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // First: make "Hello" bold
      await selectText(paragraphInput, 'Hello');
      const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="bold"]`);

      await expect(boldButton).toBeVisible();
      await boldButton.click();
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify bold applied
      let html = await paragraphInput.innerHTML();

      expect(html).toMatch(/<strong>Hello<\/strong>/);

      // Second: make "world" italic
      await selectText(paragraphInput, 'world');
      const italicButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`);

      await expect(italicButton).toBeVisible();
      await italicButton.click();
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify both formats applied
      html = await paragraphInput.innerHTML();
      expect(html).toMatch(/<strong>Hello<\/strong>/);
      expect(html).toMatch(/<(i|em)>world<\/(i|em)>/);

      // First undo: removes italic from "world"
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      html = await paragraphInput.innerHTML();
      expect(html).toMatch(/<strong>Hello<\/strong>/);
      expect(html).not.toMatch(/<(i|em)>/);

      // Second undo: removes bold from "Hello"
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      html = await paragraphInput.innerHTML();
      expect(html).not.toMatch(/<strong>/);
      expect(html).not.toMatch(/<(i|em)>/);
      expect(html).toBe('Hello world');
    });

    test('undo works with existing bold formatting', async ({ page }) => {
      // Start with pre-existing bold text
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: '<strong>Bold</strong> and normal',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Verify initial state
      let html = await paragraphInput.innerHTML();

      expect(html).toMatch(/<strong>Bold<\/strong>/);

      // Select "normal" and make it italic
      await selectText(paragraphInput, 'normal');
      const italicButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`);

      await expect(italicButton).toBeVisible();
      await italicButton.click();
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify italic applied
      html = await paragraphInput.innerHTML();
      expect(html).toMatch(/<strong>Bold<\/strong>/);
      expect(html).toMatch(/<(i|em)>normal<\/(i|em)>/);

      // Undo: removes italic, but bold should remain
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      html = await paragraphInput.innerHTML();
      expect(html).toMatch(/<strong>Bold<\/strong>/);
      expect(html).not.toMatch(/<(i|em)>/);
    });
  });

  test.describe('tune changes', () => {
    /**
     * Example Tune Class that saves its data
     */
    const EXAMPLE_TUNE_SOURCE = `class ExampleTune {
      constructor({ data }) {
        this.data = data;
      }

      static get isTune() {
        return true;
      }

      static get CSS() {
        return {};
      }

      render() {
        return document.createElement('div');
      }

      save() {
        return this.data ?? '';
      }
    }`;

    const createBlokWithTune = async (
      page: Page,
      blocks: OutputData['blocks']
    ): Promise<void> => {
      await resetBlok(page);
      await page.evaluate(
        async ({ holder, blocks: blokBlocks, tuneSource }) => {
          // Use Function constructor instead of eval for slightly better security
          const TuneClass = new Function(`return ${tuneSource}`)();

          const blok = new window.Blok({
            holder: holder,
            data: { blocks: blokBlocks },
            tools: {
              exampleTune: {
                class: TuneClass,
              },
            },
            tunes: ['exampleTune'],
          });

          window.blokInstance = blok;
          await blok.isReady;
        },
        { holder: HOLDER_ID, blocks, tuneSource: EXAMPLE_TUNE_SOURCE }
      );
    };

    test('undoes tune data change with Cmd+Z', async ({ page }) => {
      await createBlokWithTune(page, [
        {
          type: 'paragraph',
          data: { text: 'Test paragraph' },
          tunes: {
            exampleTune: 'original-value',
          },
        },
      ]);

      // Verify initial tune data
      let savedData = await saveBlok(page);

      expect(savedData.blocks[0].tunes?.exampleTune).toBe('original-value');

      // Update tune via API
      await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const block = window.blokInstance.blocks.getBlockByIndex(0);

        if (!block) {
          throw new Error('Block not found');
        }

        await window.blokInstance.blocks.update(block.id, undefined, {
          exampleTune: 'updated-value',
        });
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify tune was updated
      savedData = await saveBlok(page);
      expect(savedData.blocks[0].tunes?.exampleTune).toBe('updated-value');

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify tune reverted to original
      savedData = await saveBlok(page);
      expect(savedData.blocks[0].tunes?.exampleTune).toBe('original-value');
    });

    test('redoes tune data change with Cmd+Shift+Z', async ({ page }) => {
      await createBlokWithTune(page, [
        {
          type: 'paragraph',
          data: { text: 'Test paragraph' },
          tunes: {
            exampleTune: 'original-value',
          },
        },
      ]);

      // Update tune via API
      await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const block = window.blokInstance.blocks.getBlockByIndex(0);

        if (!block) {
          throw new Error('Block not found');
        }

        await window.blokInstance.blocks.update(block.id, undefined, {
          exampleTune: 'updated-value',
        });
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify undo worked
      let savedData = await saveBlok(page);

      expect(savedData.blocks[0].tunes?.exampleTune).toBe('original-value');

      // Redo
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify redo restored the update
      savedData = await saveBlok(page);
      expect(savedData.blocks[0].tunes?.exampleTune).toBe('updated-value');
    });

    test('undoes multiple tune changes in sequence', async ({ page }) => {
      await createBlokWithTune(page, [
        {
          type: 'paragraph',
          data: { text: 'Test paragraph' },
          tunes: {
            exampleTune: 'value-1',
          },
        },
      ]);

      // First tune update
      await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const block = window.blokInstance.blocks.getBlockByIndex(0);

        if (!block) {
          throw new Error('Block not found');
        }

        await window.blokInstance.blocks.update(block.id, undefined, {
          exampleTune: 'value-2',
        });
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Second tune update
      await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        const block = window.blokInstance.blocks.getBlockByIndex(0);

        if (!block) {
          throw new Error('Block not found');
        }

        await window.blokInstance.blocks.update(block.id, undefined, {
          exampleTune: 'value-3',
        });
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify final state
      let savedData = await saveBlok(page);

      expect(savedData.blocks[0].tunes?.exampleTune).toBe('value-3');

      // Undo to value-2
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      savedData = await saveBlok(page);
      expect(savedData.blocks[0].tunes?.exampleTune).toBe('value-2');

      // Undo to value-1
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      savedData = await saveBlok(page);
      expect(savedData.blocks[0].tunes?.exampleTune).toBe('value-1');
    });
  });

  test.describe('paste operations', () => {
    /**
     * Simulates a paste event with the given data
     */
    const paste = async (locator: Locator, data: Record<string, string>): Promise<void> => {
      await locator.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
        const pasteEvent = Object.assign(new Event('paste', {
          bubbles: true,
          cancelable: true,
        }), {
          clipboardData: {
            getData: (type: string): string => pasteData[type] ?? '',
            types: Object.keys(pasteData),
          },
        });

        element.dispatchEvent(pasteEvent);
      }, data);
    };

    test('undo removes pasted plain text', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Initial content' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Click at end and paste
      await paragraphInput.click();
      await page.keyboard.press('End');
      await paste(paragraphInput, {
        'text/plain': ' pasted text',
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify paste worked
      await expect(paragraphInput).toContainText('Initial content pasted text');

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify pasted text was removed
      await expect(paragraphInput).toHaveText('Initial content');
    });

    test('redo restores pasted plain text', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Initial' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Click at end and paste
      await paragraphInput.click();
      await page.keyboard.press('End');
      await paste(paragraphInput, {
        'text/plain': ' pasted',
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify paste worked
      await expect(paragraphInput).toContainText('Initial pasted');

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toHaveText('Initial');

      // Redo
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify redo restored pasted text
      await expect(paragraphInput).toContainText('Initial pasted');
    });

    test('undo removes pasted HTML with formatting', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Start' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Click at end and paste HTML
      await paragraphInput.click();
      await page.keyboard.press('End');
      await paste(paragraphInput, {
        'text/html': '<strong>bold</strong> and <em>italic</em>',
        'text/plain': 'bold and italic',
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify paste worked with formatting
      const html = await paragraphInput.innerHTML();

      expect(html).toMatch(/<strong>bold<\/strong>/);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify pasted HTML was removed
      const htmlAfterUndo = await paragraphInput.innerHTML();

      expect(htmlAfterUndo).not.toMatch(/<strong>/);
      expect(htmlAfterUndo).toBe('Start');
    });

    test('undo removes multiple blocks created from paste (requires multiple undos)', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Existing' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Verify initial state
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);

      // Paste text with newlines (creates multiple blocks)
      await paragraphInput.click();
      await page.keyboard.press('End');
      await paste(paragraphInput, {
        'text/plain': '\n\nSecond block\n\nThird block',
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify multiple blocks were created
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Existing');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Second block');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Third block');

      // Note: Multi-block paste creates separate undo entries per block
      // First undo removes third block
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);

      // Second undo removes second block
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('Existing');
    });

    test('undo removes blocks pasted from application/x-blok format (requires multiple undos)', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Original' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);

      // Paste using Blok's internal format
      await paragraphInput.click();
      await page.keyboard.press('End');
      await paste(paragraphInput, {
        'application/x-blok': JSON.stringify([
          { tool: 'paragraph', data: { text: 'Pasted block 1' } },
          { tool: 'paragraph', data: { text: 'Pasted block 2' } },
        ]),
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify blocks were created
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);

      // Note: Multi-block paste creates separate undo entries per block
      // First undo removes second pasted block
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);

      // Second undo removes first pasted block
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify all pasted blocks removed
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('Original');
    });

    test('paste into empty block can be undone', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: '' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Paste into empty block
      await paragraphInput.click();
      await paste(paragraphInput, {
        'text/plain': 'Content for empty block',
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify paste worked
      await expect(paragraphInput).toHaveText('Content for empty block');

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify block is empty again
      await expect(paragraphInput).toHaveText('');
    });

    test('paste replacing selection can be undone', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Hello world' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Select all text
      await paragraphInput.click();
      await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+a`);

      // Paste to replace selection
      await paste(paragraphInput, {
        'text/plain': 'Replaced',
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify paste replaced the content
      await expect(paragraphInput).toHaveText('Replaced');

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify original content is restored
      await expect(paragraphInput).toHaveText('Hello world');
    });

    test('multiple paste operations can be undone sequentially', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Base' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // First paste
      await paragraphInput.click();
      await page.keyboard.press('End');
      await paste(paragraphInput, {
        'text/plain': ' first',
      });
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Second paste
      await paste(paragraphInput, {
        'text/plain': ' second',
      });
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify both pastes
      await expect(paragraphInput).toContainText('Base first second');

      // First undo removes second paste
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toContainText('Base first');
      await expect(paragraphInput).not.toContainText('second');

      // Second undo removes first paste
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toHaveText('Base');
    });

    test('paste and redo cycle preserves data integrity', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Start' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Paste
      await paragraphInput.click();
      await page.keyboard.press('End');
      await paste(paragraphInput, {
        'text/plain': ' pasted content',
      });
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo, redo, undo, redo cycle
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toHaveText('Start');

      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toContainText('Start pasted content');

      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toHaveText('Start');

      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toContainText('Start pasted content');

      // Verify data integrity via save
      const savedData = await saveBlok(page);

      expect((savedData.blocks[0]?.data as { text?: string }).text).toBe('Start pasted content');
    });
  });

  test.describe('rapid operations', () => {
    // Small delay between rapid keyboard presses to ensure events are processed
    // 50ms is fast enough to feel "rapid" but allows browser to process events
    const RAPID_DELAY = 50;

    test('handles many rapid undos without data corruption', async ({ page }) => {
      // Create editor with multiple blocks
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Block 1' } },
        { type: 'paragraph', data: { text: 'Block 2' } },
        { type: 'paragraph', data: { text: 'Block 3' } },
      ]);

      // Make multiple changes with delays between them to create separate undo entries
      const paragraph1 = getParagraphByIndex(page, 0).locator('[contenteditable="true"]');

      await paragraph1.click();
      await page.keyboard.type(' edited');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      const paragraph2 = getParagraphByIndex(page, 1).locator('[contenteditable="true"]');

      await paragraph2.click();
      await page.keyboard.type(' modified');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      const paragraph3 = getParagraphByIndex(page, 2).locator('[contenteditable="true"]');

      await paragraph3.click();
      await page.keyboard.type(' changed');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify all edits were applied
      await expect(paragraph1).toContainText('Block 1 edited');
      await expect(paragraph2).toContainText('Block 2 modified');
      await expect(paragraph3).toContainText('Block 3 changed');

      // Fire multiple undos in rapid succession
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press(UNDO_SHORTCUT);
        await waitForDelay(page, RAPID_DELAY);
      }

      // Wait for all undos to complete processing
      await waitForDelay(page, 200);

      // Verify all changes were undone correctly
      await expect(paragraph1).toHaveText('Block 1');
      await expect(paragraph2).toHaveText('Block 2');
      await expect(paragraph3).toHaveText('Block 3');

      // Verify data integrity via save
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(3);
      expect(savedData.blocks[0].data.text).toBe('Block 1');
      expect(savedData.blocks[1].data.text).toBe('Block 2');
      expect(savedData.blocks[2].data.text).toBe('Block 3');
    });

    test('handles many rapid redos without data corruption', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Original' } },
      ]);

      const paragraph = getParagraphByIndex(page, 0).locator('[contenteditable="true"]');

      // Create 5 separate undo entries
      for (let i = 1; i <= 5; i++) {
        await paragraph.click();
        await paragraph.selectText();
        await page.keyboard.type(`Version ${i}`);
        await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
      }

      await expect(paragraph).toHaveText('Version 5');

      // Undo all changes
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press(UNDO_SHORTCUT);
        await waitForDelay(page, RAPID_DELAY);
      }

      await waitForDelay(page, 200);
      await expect(paragraph).toHaveText('Original');

      // Now redo rapidly
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press(REDO_SHORTCUT);
        await waitForDelay(page, RAPID_DELAY);
      }

      await waitForDelay(page, 200);

      // Should be back to final version
      await expect(paragraph).toHaveText('Version 5');

      // Verify data integrity
      const savedData = await saveBlok(page);

      expect(savedData.blocks[0].data.text).toBe('Version 5');
    });

    test('handles rapid interleaved undo/redo without corruption', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Start' } },
      ]);

      const paragraph = getParagraphByIndex(page, 0).locator('[contenteditable="true"]');

      // Create some undo entries
      await paragraph.click();
      await paragraph.selectText();
      await page.keyboard.type('Step 1');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      await paragraph.selectText();
      await page.keyboard.type('Step 2');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      await paragraph.selectText();
      await page.keyboard.type('Step 3');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Rapidly interleave undo/redo (simulates user rapidly pressing undo then changing mind)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, RAPID_DELAY);
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, RAPID_DELAY);
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, RAPID_DELAY);
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, RAPID_DELAY);
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, RAPID_DELAY);
      await page.keyboard.press(REDO_SHORTCUT);

      await waitForDelay(page, 200);

      // After: undo undo redo undo redo redo
      // Starting at Step 3:
      // undo -> Step 2, undo -> Step 1, redo -> Step 2, undo -> Step 1, redo -> Step 2, redo -> Step 3
      await expect(paragraph).toHaveText('Step 3');

      // Verify data integrity
      const savedData = await saveBlok(page);

      expect(savedData.blocks[0].data.text).toBe('Step 3');
    });

    test('handles rapid block deletions and undos', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Block A' } },
        { type: 'paragraph', data: { text: 'Block B' } },
        { type: 'paragraph', data: { text: 'Block C' } },
        { type: 'paragraph', data: { text: 'Block D' } },
      ]);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(4);

      // Delete blocks via API with delays to create separate undo entries
      for (let i = 0; i < 3; i++) {
        await page.evaluate(async () => {
          await window.blokInstance?.blocks.delete(0);
        });
        await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
      }

      // Should have only Block D left
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('Block D');

      // Rapidly undo all deletions
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press(UNDO_SHORTCUT);
        await waitForDelay(page, RAPID_DELAY);
      }

      await waitForDelay(page, 200);

      // All blocks should be restored
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(4);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('Block A');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toHaveText('Block B');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toHaveText('Block C');
      await expect(getParagraphByIndex(page, 3).locator('[contenteditable="true"]')).toHaveText('Block D');

      // Verify data integrity
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(4);
    });

    test('undo stack remains stable after 20+ rapid operations', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: '' } },
      ]);

      const paragraph = getParagraphByIndex(page, 0).locator('[contenteditable="true"]');

      await paragraph.click();

      // Create 10 separate undo entries with distinct content
      for (let i = 1; i <= 10; i++) {
        await paragraph.selectText();
        await page.keyboard.type(`Entry ${i}`);
        await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
      }

      await expect(paragraph).toHaveText('Entry 10');

      // Rapidly undo 10 times
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press(UNDO_SHORTCUT);
        await waitForDelay(page, RAPID_DELAY);
      }

      await waitForDelay(page, 200);

      // Should be back to empty
      await expect(paragraph).toHaveText('');

      // Rapidly redo 5 times
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press(REDO_SHORTCUT);
        await waitForDelay(page, RAPID_DELAY);
      }

      await waitForDelay(page, 200);

      await expect(paragraph).toHaveText('Entry 5');

      // Rapidly undo 3 times
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press(UNDO_SHORTCUT);
        await waitForDelay(page, RAPID_DELAY);
      }

      await waitForDelay(page, 200);

      await expect(paragraph).toHaveText('Entry 2');

      // Verify data integrity
      const savedData = await saveBlok(page);

      expect(savedData.blocks[0].data.text).toBe('Entry 2');
    });
  });

  test.describe('toolbox insertions', () => {
    test('undo after inserting Header via toolbox removes the header', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Existing paragraph' },
        },
      ]);

      // Hover on the paragraph to show the toolbar, then click plus
      const paragraph = page.locator(PARAGRAPH_SELECTOR);
      await paragraph.hover();

      // Click plus button to open toolbox
      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
      await expect(plusButton).toBeVisible();
      await plusButton.click();

      // Wait for toolbox item to be available and click it
      const headerOption = page.locator(TOOLBOX_ITEM_SELECTOR('header-2'));
      await expect(headerOption).toBeVisible();
      await headerOption.click();

      // Wait for header to be inserted
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(1);
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo should remove the header
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Check that header is gone and only the original paragraph remains
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(0);
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
      await expect(paragraph).toContainText('Existing paragraph');
    });

    test('undo after inserting Bulleted List via toolbox removes the list', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Existing paragraph' },
        },
      ]);

      // Hover on the paragraph to show the toolbar
      const paragraph = page.locator(PARAGRAPH_SELECTOR);
      await paragraph.hover();

      // Click plus button to open toolbox
      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
      await expect(plusButton).toBeVisible();
      await plusButton.click();

      // Type to filter to list and click on Bulleted List option
      await page.keyboard.type('bullet');
      await waitForDelay(page, 100);

      const listOption = page.locator(TOOLBOX_ITEM_SELECTOR('bulleted-list'));
      await expect(listOption).toBeVisible();
      await listOption.click();

      // Wait for list to be inserted
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo should remove the list
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Check that list is gone and only original paragraph remains
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(0);
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
      await expect(paragraph).toContainText('Existing paragraph');
    });

    test('redo after undoing toolbox header insertion restores the header', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Existing paragraph' },
        },
      ]);

      // Hover on the paragraph to show the toolbar
      const paragraph = page.locator(PARAGRAPH_SELECTOR);
      await paragraph.hover();

      // Click plus button to open toolbox
      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
      await expect(plusButton).toBeVisible();
      await plusButton.click();

      // Wait for toolbox item and click header
      const headerOption = page.locator(TOOLBOX_ITEM_SELECTOR('header-2'));
      await expect(headerOption).toBeVisible();
      await headerOption.click();

      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(1);
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo removes the header
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(0);
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);

      // Redo should restore the header
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(1);
    });

    test('inserting Header 3 via toolbox and undo works correctly', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'Some content' },
        },
      ]);

      // Hover on the paragraph to show the toolbar
      const paragraph = page.locator(PARAGRAPH_SELECTOR);
      await paragraph.hover();

      // Click plus button to open toolbox
      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);
      await expect(plusButton).toBeVisible();
      await plusButton.click();

      // Click on Header 3
      const header3Option = page.locator(TOOLBOX_ITEM_SELECTOR('header-3'));
      await expect(header3Option).toBeVisible();
      await header3Option.click();

      // Should have a header now
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(1);
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Type some content in the header
      await page.keyboard.type('My Heading');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Save and verify the header level
      const savedData = await saveBlok(page);
      const headerBlock = savedData.blocks.find(b => b.type === 'header');
      expect(headerBlock).toBeDefined();
      expect(headerBlock?.data.level).toBe(3);
      expect(headerBlock?.data.text).toBe('My Heading');

      // Undo the typing
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Undo the block creation
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should be back to just the original paragraph
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(0);
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
      await expect(paragraph).toContainText('Some content');
    });

    test('undo/redo cycle with sequential toolbox insertions', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: 'First paragraph' },
        },
      ]);

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      // Hover on paragraph to show toolbar and insert header via toolbox
      // eslint-disable-next-line playwright/no-nth-methods
      const paragraph = page.locator(PARAGRAPH_SELECTOR).first();
      await paragraph.hover();

      await expect(plusButton).toBeVisible();
      await plusButton.click();

      // Click header option
      const headerOption = page.locator(TOOLBOX_ITEM_SELECTOR('header-2'));
      await expect(headerOption).toBeVisible();
      await headerOption.click();

      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(1);
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Now insert a list via toolbox (hover on header)
      const header = page.locator(HEADER_SELECTOR);
      await header.hover();

      await expect(plusButton).toBeVisible();
      await plusButton.click();

      // Type to filter and click list option
      await page.keyboard.type('bullet');
      await waitForDelay(page, 100);
      const listOption = page.locator(TOOLBOX_ITEM_SELECTOR('bulleted-list'));
      await expect(listOption).toBeVisible();
      await listOption.click();

      // Now we have header + list (plus original paragraph may or may not be there)
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(1);
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo should remove the list
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(LIST_SELECTOR)).toHaveCount(0);
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(1);

      // Redo should restore list
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);
      await expect(page.locator(HEADER_SELECTOR)).toHaveCount(1);
    });
  });

  test.describe('multi-block selection delete', () => {
    const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

    const getBlockByIndex = (page: Page, index: number): Locator => {
      return page.locator(`:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`);
    };

    const placeCaretAtEnd = async (locator: Locator): Promise<void> => {
      await locator.evaluate((element) => {
        const doc = element.ownerDocument;
        const selection = doc.getSelection();

        if (!selection) {
          return;
        }

        const range = doc.createRange();
        const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let lastTextNode: Text | null = null;

        while (walker.nextNode()) {
          lastTextNode = walker.currentNode as Text;
        }

        if (lastTextNode) {
          range.setStart(lastTextNode, lastTextNode.textContent?.length ?? 0);
        } else {
          range.selectNodeContents(element);
          range.collapse(false);
        }

        selection.removeAllRanges();
        selection.addRange(range);
        doc.dispatchEvent(new Event('selectionchange'));
      });
    };

    test('undo restores multiple blocks deleted via cross-block selection', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
        { type: 'paragraph', data: { text: 'Fourth block' } },
      ]);

      // Verify initial state
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(4);

      const firstParagraph = getParagraphByIndex(page, 0);
      const firstInput = firstParagraph.locator('[contenteditable="true"]');

      // Select blocks 1-3 using Shift+ArrowDown
      await firstInput.click();
      await placeCaretAtEnd(firstInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      // Verify blocks are selected
      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
      await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');

      // Delete selected blocks
      await page.keyboard.press('Backspace');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify deletion: should have 2 blocks (empty replacement + Fourth block)
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Fourth block');

      // Undo should restore all deleted blocks
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify all blocks are restored
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(4);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First block');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Second block');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Third block');
      await expect(getParagraphByIndex(page, 3).locator('[contenteditable="true"]')).toContainText('Fourth block');
    });

    test('redo after undoing multi-block delete removes blocks again', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Block A' } },
        { type: 'paragraph', data: { text: 'Block B' } },
        { type: 'paragraph', data: { text: 'Block C' } },
      ]);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);

      const firstParagraph = getParagraphByIndex(page, 0);
      const firstInput = firstParagraph.locator('[contenteditable="true"]');

      // Select all blocks using Shift+ArrowDown
      await firstInput.click();
      await placeCaretAtEnd(firstInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      // Delete all selected blocks
      await page.keyboard.press('Backspace');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Should have 1 empty replacement block
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('');

      // Undo restores blocks
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);

      // Redo deletes them again
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toHaveText('');
    });

    test('undo restores blocks deleted via Cmd/Ctrl+A then Backspace', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First content' } },
        { type: 'paragraph', data: { text: 'Second content' } },
        { type: 'paragraph', data: { text: 'Third content' } },
      ]);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);

      const firstParagraph = getParagraphByIndex(page, 0);

      // Focus on first block and select all blocks with Cmd/Ctrl+A twice
      await firstParagraph.click();
      await page.keyboard.press(SELECT_ALL_SHORTCUT);
      await page.keyboard.press(SELECT_ALL_SHORTCUT);

      // Verify all blocks are selected
      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
      await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');

      // Delete all blocks
      await page.keyboard.press('Backspace');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Should have 1 empty block
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);

      // Undo should restore all blocks
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First content');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Second content');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Third content');

      // Verify data integrity
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(3);
      expect(savedData.blocks[0].data.text).toBe('First content');
      expect(savedData.blocks[1].data.text).toBe('Second content');
      expect(savedData.blocks[2].data.text).toBe('Third content');
    });

    test('multi-block delete requires single undo (atomic operation)', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Block 1' } },
        { type: 'paragraph', data: { text: 'Block 2' } },
        { type: 'paragraph', data: { text: 'Block 3' } },
      ]);

      const firstInput = getParagraphByIndex(page, 0).locator('[contenteditable="true"]');

      // Select blocks 1-2
      await firstInput.click();
      await placeCaretAtEnd(firstInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      // Delete selected blocks
      await page.keyboard.press('Backspace');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Should have 2 blocks (empty + Block 3)
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(2);

      // Single undo should restore both deleted blocks (not require two undos)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Block 1');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Block 2');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Block 3');

      // Second undo should NOT affect the restored state (proves delete was atomic)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Block count should still be 3 (no further undo available for this operation)
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);
    });

    test('undo/redo cycle with multi-block delete preserves data integrity', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Alpha' } },
        { type: 'paragraph', data: { text: 'Beta' } },
        { type: 'paragraph', data: { text: 'Gamma' } },
        { type: 'paragraph', data: { text: 'Delta' } },
      ]);

      // Select middle two blocks (Beta and Gamma)
      await getParagraphByIndex(page, 1).locator('[contenteditable="true"]').click();
      await page.keyboard.press('Home');
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      // Delete selected blocks
      await page.keyboard.press('Backspace');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify: Alpha, empty, Delta
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);

      // Multiple undo/redo cycles
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(4);

      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);

      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Final verification of data integrity
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(4);
      expect(savedData.blocks[0].data.text).toBe('Alpha');
      expect(savedData.blocks[1].data.text).toBe('Beta');
      expect(savedData.blocks[2].data.text).toBe('Gamma');
      expect(savedData.blocks[3].data.text).toBe('Delta');
    });
  });

  test.describe('drag-and-drop reorder', () => {
    const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;

    /**
     * Helper function to get bounding box and throw if it doesn't exist.
     */
    const getBoundingBox = async (
      locator: Locator
    ): Promise<{ x: number; y: number; width: number; height: number }> => {
      const box = await locator.boundingBox();

      if (!box) {
        throw new Error('Could not get bounding box for element');
      }

      return box;
    };

    /**
     * Helper function to perform drag and drop using pointer-based mouse events.
     */
    const performDragDrop = async (
      page: Page,
      sourceLocator: Locator,
      targetLocator: Locator,
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

      await page.mouse.move(sourceX, sourceY);
      await page.mouse.down();
      await waitForDelay(page, 50);
      await page.mouse.move(targetX, targetY, { steps: 15 });
      await waitForDelay(page, 50);
      await page.mouse.up();
      await waitForDelay(page, 100);
    };

    test('undo after drag-drop reorder restores original position', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      // Verify initial order
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First block');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Second block');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Third block');

      // Hover over first block to show settings button (drag handle)
      const firstBlock = getParagraphByIndex(page, 0);

      await firstBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag first block to after third block
      const targetBlock = getParagraphByIndex(page, 2);

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');

      // Wait for Yjs capture
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify reordered: Second, Third, First
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Second block');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Third block');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('First block');

      // Undo should restore original order
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify original order is restored: First, Second, Third
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('First block');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Second block');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Third block');

      // Block count should remain the same
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);
    });

    test('redo after undoing drag-drop reorder restores moved position', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Alpha' } },
        { type: 'paragraph', data: { text: 'Beta' } },
        { type: 'paragraph', data: { text: 'Gamma' } },
      ]);

      // Drag last block to first position
      const lastBlock = getParagraphByIndex(page, 2);

      await lastBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      const targetBlock = getParagraphByIndex(page, 0);

      await performDragDrop(page, settingsButton, targetBlock, 'top');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify reordered: Gamma, Alpha, Beta
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Gamma');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Alpha');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Beta');

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify original: Alpha, Beta, Gamma
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Alpha');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Beta');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Gamma');

      // Redo
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify moved order is restored: Gamma, Alpha, Beta
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Gamma');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Alpha');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Beta');
    });

    test('drag-drop reorder requires single undo (atomic transaction)', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'One' } },
        { type: 'paragraph', data: { text: 'Two' } },
        { type: 'paragraph', data: { text: 'Three' } },
        { type: 'paragraph', data: { text: 'Four' } },
      ]);

      // Drag second block to the end
      const secondBlock = getParagraphByIndex(page, 1);

      await secondBlock.hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      const targetBlock = getParagraphByIndex(page, 3);

      await performDragDrop(page, settingsButton, targetBlock, 'bottom');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify reordered: One, Three, Four, Two
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('One');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Three');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Four');
      await expect(getParagraphByIndex(page, 3).locator('[contenteditable="true"]')).toContainText('Two');

      // Single undo should restore original order
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify original order: One, Two, Three, Four
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('One');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Two');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Three');
      await expect(getParagraphByIndex(page, 3).locator('[contenteditable="true"]')).toContainText('Four');

      // Second undo should NOT change order (proves move was atomic)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Order should still be: One, Two, Three, Four
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('One');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Two');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Three');
      await expect(getParagraphByIndex(page, 3).locator('[contenteditable="true"]')).toContainText('Four');
    });

    test('undo/redo cycle with drag-drop preserves data integrity', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First' } },
        { type: 'paragraph', data: { text: 'Second' } },
        { type: 'paragraph', data: { text: 'Third' } },
      ]);

      // Drag middle block to end
      await getParagraphByIndex(page, 1).hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();
      await performDragDrop(page, settingsButton, getParagraphByIndex(page, 2), 'bottom');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Multiple undo/redo cycles
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press(UNDO_SHORTCUT);
        await waitForDelay(page, 200);
        await page.keyboard.press(REDO_SHORTCUT);
        await waitForDelay(page, 200);
      }

      // Final undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify data integrity via save
      const savedData = await saveBlok(page);

      expect(savedData.blocks).toHaveLength(3);
      expect(savedData.blocks[0].data.text).toBe('First');
      expect(savedData.blocks[1].data.text).toBe('Second');
      expect(savedData.blocks[2].data.text).toBe('Third');
    });

    test('undo after multi-block drag-drop restores all blocks to original positions', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Block 0' } },
        { type: 'paragraph', data: { text: 'Block 1' } },
        { type: 'paragraph', data: { text: 'Block 2' } },
        { type: 'paragraph', data: { text: 'Block 3' } },
        { type: 'paragraph', data: { text: 'Block 4' } },
      ]);

      // Select blocks 1, 2, 3 using BlockSelection API
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
      await getParagraphByIndex(page, 2).hover();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      // Drag to bottom of block 4
      await performDragDrop(page, settingsButton, getParagraphByIndex(page, 4), 'bottom');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify reordered: Block 0, Block 4, Block 1, Block 2, Block 3
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Block 0');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Block 4');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Block 1');
      await expect(getParagraphByIndex(page, 3).locator('[contenteditable="true"]')).toContainText('Block 2');
      await expect(getParagraphByIndex(page, 4).locator('[contenteditable="true"]')).toContainText('Block 3');

      // Undo should restore original order
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify original order: Block 0, Block 1, Block 2, Block 3, Block 4
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Block 0');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Block 1');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Block 2');
      await expect(getParagraphByIndex(page, 3).locator('[contenteditable="true"]')).toContainText('Block 3');
      await expect(getParagraphByIndex(page, 4).locator('[contenteditable="true"]')).toContainText('Block 4');
    });
  });
});
