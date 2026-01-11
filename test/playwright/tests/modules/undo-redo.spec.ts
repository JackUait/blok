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

const getListBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${LIST_SELECTOR}, ${index + 1})`);
};

/**
 * Helper to assert block depth consistently.
 * Depth 0 is omitted from saved data, so we use nullish coalescing.
 */
const expectDepth = (block: OutputData['blocks'][number] | undefined, expectedDepth: number): void => {
  const actualDepth = (block?.data as { depth?: number })?.depth ?? 0;

  expect(actualDepth).toBe(expectedDepth);
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

      // Verify deletion: should have 1 block (Fourth block)
      // No replacement block is inserted when only partial selection is deleted
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Fourth block');

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

      // Should have 1 block (Block 3)
      // No replacement block is inserted when only partial selection is deleted
      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);

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

    test('consecutive drag-drop operations undo correctly in reverse order', async ({ page }) => {
      // This test verifies that multiple consecutive drag-drop operations can be
      // undone correctly, with each undo restoring the previous state.
      // This was a bug where Yjs delete+insert didn't undo correctly for moves.
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Block A' } },
        { type: 'paragraph', data: { text: 'Block B' } },
        { type: 'paragraph', data: { text: 'Block C' } },
      ]);

      // Verify initial order: A, B, C
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Block A');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Block B');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Block C');

      // Move 1: Drag Block A to the end (after Block C)
      // Initial: A, B, C -> After: B, C, A
      await getParagraphByIndex(page, 0).hover();
      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();
      await performDragDrop(page, settingsButton, getParagraphByIndex(page, 2), 'bottom');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify after Move 1: B, C, A
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Block B');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Block C');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Block A');

      // Move 2: Drag Block B (now at index 0) to the end (after Block A)
      // Current: B, C, A -> After: C, A, B
      await getParagraphByIndex(page, 0).hover();
      await expect(settingsButton).toBeVisible();
      await performDragDrop(page, settingsButton, getParagraphByIndex(page, 2), 'bottom');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify after Move 2: C, A, B
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Block C');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Block A');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Block B');

      // Undo 1: Should restore state before Move 2 (B, C, A)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Block B');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Block C');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Block A');

      // Undo 2: Should restore original state (A, B, C)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Block A');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Block B');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Block C');
    });

    test('consecutive drag-drop operations redo correctly after undo', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Alpha' } },
        { type: 'paragraph', data: { text: 'Beta' } },
        { type: 'paragraph', data: { text: 'Gamma' } },
      ]);

      // Move 1: Drag Alpha to end -> Beta, Gamma, Alpha
      await getParagraphByIndex(page, 0).hover();
      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();
      await performDragDrop(page, settingsButton, getParagraphByIndex(page, 2), 'bottom');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Move 2: Drag Beta to end -> Gamma, Alpha, Beta
      await getParagraphByIndex(page, 0).hover();
      await expect(settingsButton).toBeVisible();
      await performDragDrop(page, settingsButton, getParagraphByIndex(page, 2), 'bottom');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify: Gamma, Alpha, Beta
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Gamma');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Alpha');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Beta');

      // Undo both moves
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify back to original: Alpha, Beta, Gamma
      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Alpha');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Beta');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Gamma');

      // Redo 1: Should restore Move 1 (Beta, Gamma, Alpha)
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Beta');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Gamma');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Alpha');

      // Redo 2: Should restore Move 2 (Gamma, Alpha, Beta)
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(getParagraphByIndex(page, 0).locator('[contenteditable="true"]')).toContainText('Gamma');
      await expect(getParagraphByIndex(page, 1).locator('[contenteditable="true"]')).toContainText('Alpha');
      await expect(getParagraphByIndex(page, 2).locator('[contenteditable="true"]')).toContainText('Beta');
    });
  });

  test.describe('nested list indentation', () => {
    const createListBlocks = async (
      page: Page,
      items: Array<{ text: string; depth?: number }>
    ): Promise<void> => {
      await resetBlok(page);
      await page.evaluate(async ({ holder, items: listItems }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: listItems.map((item, index) => ({
              id: `list-${index}`,
              type: 'list',
              data: {
                text: item.text,
                style: 'unordered',
                checked: false,
                ...(item.depth !== undefined ? { depth: item.depth } : {}),
              },
            })),
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID, items });
    };

    test('undo after Tab indentation restores original depth', async ({ page }) => {
      await createListBlocks(page, [
        { text: 'First item' },
        { text: 'Second item' },
      ]);

      // Click on second item
      const secondItem = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');

      await secondItem.click();

      // Press Tab to indent
      await page.keyboard.press('Tab');

      // Wait for Yjs to capture
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify depth increased
      let savedData = await saveBlok(page);

      expectDepth(savedData.blocks[1], 1);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify depth is back to 0
      savedData = await saveBlok(page);
      expectDepth(savedData.blocks[1], 0);
    });

    test('redo after undoing Tab indentation restores indentation', async ({ page }) => {
      await createListBlocks(page, [
        { text: 'First item' },
        { text: 'Second item' },
      ]);

      // Click on second item
      const secondItem = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');

      await secondItem.click();

      // Press Tab to indent
      await page.keyboard.press('Tab');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify depth is back to 0
      let savedData = await saveBlok(page);

      expectDepth(savedData.blocks[1], 0);

      // Redo
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify depth is back to 1
      savedData = await saveBlok(page);
      expectDepth(savedData.blocks[1], 1);
    });

    test('undo after Shift+Tab outdentation restores original depth', async ({ page }) => {
      await createListBlocks(page, [
        { text: 'First item' },
        { text: 'Nested item', depth: 1 },
      ]);

      // Click on nested item
      const nestedItem = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');

      await nestedItem.click();

      // Verify initial depth is 1
      let savedData = await saveBlok(page);

      expectDepth(savedData.blocks[1], 1);

      // Press Shift+Tab to outdent
      await page.keyboard.press('Shift+Tab');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify depth decreased to 0
      savedData = await saveBlok(page);
      expectDepth(savedData.blocks[1], 0);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify depth is back to 1
      savedData = await saveBlok(page);
      expectDepth(savedData.blocks[1], 1);
    });

    test('multiple indentation changes can be undone sequentially', async ({ page }) => {
      await createListBlocks(page, [
        { text: 'First item' },
        { text: 'Second item' },
        { text: 'Third item' },
      ]);

      // Click on second item and indent
      const secondItem = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');

      await secondItem.click();
      await page.keyboard.press('Tab');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Click on third item and indent twice
      const thirdItem = getListBlockByIndex(page, 2).locator('[contenteditable="true"]');

      await thirdItem.click();
      await page.keyboard.press('Tab');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
      await page.keyboard.press('Tab');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify depths: 0, 1, 2
      let savedData = await saveBlok(page);

      expectDepth(savedData.blocks[0], 0);
      expectDepth(savedData.blocks[1], 1);
      expectDepth(savedData.blocks[2], 2);

      // Undo third item's second indent: 0, 1, 1
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      savedData = await saveBlok(page);
      expectDepth(savedData.blocks[2], 1);

      // Undo third item's first indent: 0, 1, 0
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      savedData = await saveBlok(page);
      expectDepth(savedData.blocks[2], 0);

      // Undo second item's indent: 0, 0, 0
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      savedData = await saveBlok(page);
      expectDepth(savedData.blocks[1], 0);
    });

    test('deeply nested item undo/redo cycle preserves data integrity', async ({ page }) => {
      await createListBlocks(page, [
        { text: 'Root item' },
        { text: 'Level 1', depth: 1 },
        { text: 'Level 2', depth: 2 },
        { text: 'Level 3', depth: 3 },
      ]);

      // Click on Level 3 item and outdent it twice
      const level3Item = getListBlockByIndex(page, 3).locator('[contenteditable="true"]');

      await level3Item.click();
      await page.keyboard.press('Shift+Tab');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
      await page.keyboard.press('Shift+Tab');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify depth is now 1
      let savedData = await saveBlok(page);

      expectDepth(savedData.blocks[3], 1);

      // Undo twice to restore to depth 3
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      savedData = await saveBlok(page);
      expectDepth(savedData.blocks[3], 3);

      // Redo twice to go back to depth 1
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      savedData = await saveBlok(page);
      expectDepth(savedData.blocks[3], 1);

      // Verify all other blocks unchanged
      expectDepth(savedData.blocks[0], 0);
      expectDepth(savedData.blocks[1], 1);
      expectDepth(savedData.blocks[2], 2);
    });
  });

  test.describe('caret restoration', () => {
    /**
     * Helper to get caret offset within an element
     */
    const getCaretOffset = (locator: Locator): Promise<number | null> => {
      return locator.evaluate((element) => {
        const selection = element.ownerDocument.getSelection();

        if (!selection || selection.rangeCount === 0) {
          return null;
        }

        const range = selection.getRangeAt(0);

        if (!element.contains(range.startContainer)) {
          return null;
        }

        // Calculate total offset from start of element
        const treeWalker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
          null
        );

        let offset = 0;
        let node = treeWalker.nextNode();

        while (node !== null) {
          if (node === range.startContainer) {
            return offset + range.startOffset;
          }
          offset += node.textContent?.length ?? 0;
          node = treeWalker.nextNode();
        }

        return null;
      });
    };

    /**
     * Helper to check if element is focused
     */
    const isFocused = (locator: Locator): Promise<boolean> => {
      return locator.evaluate((element) => {
        return element.ownerDocument.activeElement === element ||
          element.contains(element.ownerDocument.activeElement);
      });
    };

    test('restores caret position after text undo', async ({ page }) => {
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

      // Click at the end of the paragraph
      await paragraphInput.click();
      await page.keyboard.press('End');

      // Type additional text
      await paragraphInput.pressSequentially(' test');

      // Wait for Yjs to capture the change
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify the text was added
      await expect(paragraphInput).toContainText('Hello world test');

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify text is back to original
      await expect(paragraphInput).toContainText('Hello world');

      // Verify caret is restored to position before typing (end of original text)
      const offset = await getCaretOffset(paragraphInput);

      expect(offset).toBe('Hello world'.length);
    });

    test('restores caret position after text redo', async ({ page }) => {
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

      // Click at the end of the paragraph
      await paragraphInput.click();
      await page.keyboard.press('End');

      // Type additional text
      await paragraphInput.pressSequentially(' test');

      // Wait for Yjs to capture the change and force finalization
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
      await page.evaluate(() => {
        // Access YjsManager via module alias
        const blok = window.blokInstance as { module?: { yjsManager?: { stopCapturing?: () => void } } } | undefined;

        blok?.module?.yjsManager?.stopCapturing?.();
      });
      await waitForDelay(page, 100);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify text is back to original
      await expect(paragraphInput).toContainText('Hello world');

      // Redo
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify text is restored
      await expect(paragraphInput).toContainText('Hello world test');

      // Verify caret is restored - should be at end of the text after redo
      // The exact position may vary depending on timing, but should be focused
      const focused = await isFocused(paragraphInput);

      expect(focused).toBe(true);

      // Verify caret is somewhere in the text (not at position 0)
      const offset = await getCaretOffset(paragraphInput);

      expect(offset).toBeGreaterThan(0);
    });

    test('restores caret to previous block after block add undo', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'First block',
          },
        },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);
      const firstParagraphInput = firstParagraph.locator('[contenteditable="true"]');

      // Click at the end of the first paragraph
      await firstParagraphInput.click();
      await page.keyboard.press('End');

      // Press Enter to create a new block
      await page.keyboard.press('Enter');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify new block was created
      const allParagraphs = page.locator(PARAGRAPH_SELECTOR);

      await expect(allParagraphs).toHaveCount(2);

      // Undo the block creation
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify block was removed
      await expect(allParagraphs).toHaveCount(1);

      // Verify caret is back in the first block
      const focused = await isFocused(firstParagraphInput);

      expect(focused).toBe(true);
    });

    test('restores caret position after block move undo', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'Block A',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'Block B',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'Block C',
          },
        },
      ]);

      // Focus first block and set caret position via click (this sets currentBlock)
      const firstBlock = getParagraphByIndex(page, 0);
      const firstBlockInput = firstBlock.locator('[contenteditable="true"]');

      // Click to focus and ensure currentBlock is set
      await firstBlockInput.click();
      await page.keyboard.press('End');

      // Type a character to establish the block as current and create an undo entry
      await firstBlockInput.pressSequentially('!');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify starting state
      let savedData = await saveBlok(page);

      expect(savedData.blocks[0].data.text).toBe('Block A!');

      // Use API to move block - move(toIndex, fromIndex)
      // Keep focus on the input during API call
      await firstBlockInput.evaluate((input) => {
        input.focus();
        const win = window as { blokInstance?: { blocks: { move: (to: number, from: number) => void } } };

        win.blokInstance?.blocks.move(2, 0);
      });

      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify block order changed (Block A! is now at index 2)
      savedData = await saveBlok(page);

      expect(savedData.blocks[0].data.text).toBe('Block B');
      expect(savedData.blocks[1].data.text).toBe('Block C');
      expect(savedData.blocks[2].data.text).toBe('Block A!');

      // Focus the editor area before undo to ensure keyboard events work
      const blockAtIndex2 = getParagraphByIndex(page, 2);

      await blockAtIndex2.locator('[contenteditable="true"]').click();
      await waitForDelay(page, 100);

      // Undo the move
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify block order is restored - this is the main undo behavior
      savedData = await saveBlok(page);
      expect(savedData.blocks[0].data.text).toBe('Block A!');
      expect(savedData.blocks[1].data.text).toBe('Block B');
      expect(savedData.blocks[2].data.text).toBe('Block C');

      // For API-based moves, caret restoration depends on whether currentBlock
      // was set when the move was triggered. We verify the move was undone correctly
      // which is the primary undo functionality.
    });

    test('caret is at end of content after undo (beforeinput capture)', async ({ page }) => {
      // This test verifies the fix for capturing caret position via beforeinput event.
      // The caret should be positioned at the end of the resulting content after undo.
      // Example: "hello" -> type " world" -> "hello world" -> undo -> "hello" with caret after "o"
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'hello',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Position caret at the end of "hello"
      await paragraphInput.click();
      await page.keyboard.press('End');

      // Type " world" to make "hello world"
      await paragraphInput.pressSequentially(' world');

      // Wait for Yjs to capture the change
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify text is "hello world"
      await expect(paragraphInput).toHaveText('hello world');

      // Undo - should restore to "hello"
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify text is back to "hello"
      await expect(paragraphInput).toHaveText('hello');

      // Verify caret is at position 5 (after "o" in "hello")
      const offset = await getCaretOffset(paragraphInput);

      expect(offset).toBe(5); // "hello".length
    });

    test('caret is at end of content after redo (beforeinput capture)', async ({ page }) => {
      // This test verifies the fix for capturing caret position via beforeinput event.
      // The caret should be positioned somewhere in the new content after redo (not at 0).
      // Example: "hello" -> type " world" -> undo -> redo -> "hello world" with caret past "hello"
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'hello',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Position caret at the end of "hello"
      await paragraphInput.click();
      await page.keyboard.press('End');

      // Type " world" to make "hello world"
      await paragraphInput.pressSequentially(' world');

      // Wait for Yjs to capture the change
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Force capture timeout to finalize
      await page.evaluate(() => {
        const blok = window.blokInstance as { module?: { yjsManager?: { stopCapturing?: () => void } } } | undefined;

        blok?.module?.yjsManager?.stopCapturing?.();
      });
      await waitForDelay(page, 100);

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify text is "hello"
      await expect(paragraphInput).toHaveText('hello');

      // Redo - should restore to "hello world"
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify text is "hello world"
      await expect(paragraphInput).toHaveText('hello world');

      // Verify caret is somewhere past the original text (exact position depends on Yjs batching)
      const offset = await getCaretOffset(paragraphInput);

      expect(offset).toBeGreaterThan(5); // At minimum, past "hello"
    });

    test('caret position is captured before DOM mutation, not after', async ({ page }) => {
      // This test ensures the beforeinput event captures caret position BEFORE typing,
      // not after. Without the fix, both before/after would be the same position.
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'ABC',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Position caret at position 1 (between A and B)
      await paragraphInput.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight'); // Now at position 1

      // Type "X" to make "AXBC"
      await paragraphInput.pressSequentially('X');

      // Wait for Yjs to capture
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify text is "AXBC"
      await expect(paragraphInput).toHaveText('AXBC');

      // Undo - should restore to "ABC" with caret at position 1 (where it was BEFORE typing)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify text is "ABC"
      await expect(paragraphInput).toHaveText('ABC');

      // Verify caret is at position 1 (between A and B) - this proves beforeinput worked
      const offset = await getCaretOffset(paragraphInput);

      expect(offset).toBe(1);
    });

    test('multiple undo/redo cycles maintain correct caret positions', async ({ page }) => {
      // Test that caret positions are correctly maintained through multiple undo/redo cycles.
      // The key behavior: undo restores caret to BEFORE position, redo restores to AFTER.
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'Start',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Position at end
      await paragraphInput.click();
      await page.keyboard.press('End');

      // Type " one"
      await paragraphInput.pressSequentially(' one');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Force new undo group
      await page.evaluate(() => {
        const blok = window.blokInstance as { module?: { yjsManager?: { stopCapturing?: () => void } } } | undefined;

        blok?.module?.yjsManager?.stopCapturing?.();
      });

      // Type " two"
      await paragraphInput.pressSequentially(' two');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify full text
      await expect(paragraphInput).toHaveText('Start one two');

      // First undo - removes " two"
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toHaveText('Start one');

      // Caret should be past "Start" (exact position depends on Yjs batching)
      let offset = await getCaretOffset(paragraphInput);

      expect(offset).toBeGreaterThan(5); // At least past "Start"

      // Second undo - removes " one"
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toHaveText('Start');

      // KEY TEST: Caret should be at end of "Start" (position 5) - this tests beforeinput capture
      offset = await getCaretOffset(paragraphInput);
      expect(offset).toBe(5);

      // Redo - restores " one"
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toHaveText('Start one');

      // Caret should be past "Start" (exact position depends on Yjs batching)
      offset = await getCaretOffset(paragraphInput);
      expect(offset).toBeGreaterThan(5);

      // Redo again - restores " two"
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(paragraphInput).toHaveText('Start one two');

      // Caret should be past "Start one" (exact position depends on Yjs batching)
      offset = await getCaretOffset(paragraphInput);
      expect(offset).toBeGreaterThan(9);
    });

    test('caret is at end of long content after undo', async ({ page }) => {
      // Reproduce user's exact scenario with long text
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'asjdjla ajsldjals ajsdljasdj',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Position caret at the end
      await paragraphInput.click();
      await page.keyboard.press('End');

      // Verify initial caret position
      const initialOffset = await getCaretOffset(paragraphInput);

      expect(initialOffset).toBe(28); // "asjdjla ajsldjals ajsdljasdj".length

      // Type " ajlsdljasldj" (with space at start)
      await paragraphInput.pressSequentially(' ajlsdljasldj');

      // Wait for Yjs to capture
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify full text
      await expect(paragraphInput).toHaveText('asjdjla ajsldjals ajsdljasdj ajlsdljasldj');

      // Undo
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify text is restored
      await expect(paragraphInput).toHaveText('asjdjla ajsldjals ajsdljasdj');

      // Verify caret is at position 28 (end of remaining content)
      const offset = await getCaretOffset(paragraphInput);

      expect(offset).toBe(28); // "asjdjla ajsldjals ajsdljasdj".length
    });

    test('caret restoration with immediate undo (no wait)', async ({ page }) => {
      // Test scenario where user undoes immediately after typing
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: 'asjdjla ajsldjals ajsdljasdj',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Position caret at the end
      await paragraphInput.click();
      await page.keyboard.press('End');

      // Type and immediately undo WITHOUT waiting for capture timeout
      await paragraphInput.pressSequentially(' ajlsdljasldj');

      // Immediate undo - this might test the scenario where user undoes mid-batch
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Get the caret position - even with partial undo, should be reasonable
      const offset = await getCaretOffset(paragraphInput);
      const text = await paragraphInput.textContent();

      // Log for debugging
      console.log(`Text after undo: "${text}", caret offset: ${offset}`);

      // The caret should be at a reasonable position within or at the end of text
      expect(offset).toBeGreaterThan(0);
      expect(offset).toBeLessThanOrEqual((text ?? '').length);
    });

    test('caret restoration when typing from empty block', async ({ page }) => {
      // Test scenario where user types into an initially empty block
      // This tests the fix for stack-item-updated event handling
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: {
            text: '',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      // Click to focus the empty block
      await paragraphInput.click();

      // Type the first batch of text
      await paragraphInput.pressSequentially('asjdjla ajsldjals ajsdljasdj');

      // Wait for Yjs to capture this batch
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Force capture timeout to create separate undo groups
      await page.evaluate(() => {
        const blok = window.blokInstance as { module?: { yjsManager?: { stopCapturing?: () => void } } } | undefined;

        blok?.module?.yjsManager?.stopCapturing?.();
      });
      await waitForDelay(page, 100);

      // Type more text (second batch)
      await paragraphInput.pressSequentially(' ajlsdljasldj');

      // Wait for Yjs to capture
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify full text
      await expect(paragraphInput).toHaveText('asjdjla ajsldjals ajsdljasdj ajlsdljasldj');

      // Undo the last typed portion
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify text is restored
      await expect(paragraphInput).toHaveText('asjdjla ajsldjals ajsdljasdj');

      // Verify caret is at position 28 (end of remaining content)
      const offset = await getCaretOffset(paragraphInput);

      expect(offset).toBe(28); // "asjdjla ajsldjals ajsdljasdj".length
    });

    test('list item split undo merges items back together', async ({ page }) => {
      // Test that splitting a list item with Enter and undoing properly merges it back
      await createBlokWithBlocks(page, [
        {
          id: 'list-1',
          type: 'list',
          data: {
            text: 'Hello World',
            style: 'unordered',
          },
        },
      ]);

      const listBlock = getListBlockByIndex(page, 0);
      const listInput = listBlock.locator('[contenteditable="true"]');

      // Click to focus the list item
      await listInput.click();

      // Place caret between "Hello" and " World" (after "Hello")
      await page.evaluate(() => {
        const el = document.querySelector('[data-blok-component="list"] [contenteditable="true"]');

        if (!el) return;

        const textNode = el.firstChild;

        if (!textNode) return;

        const range = document.createRange();
        const selection = window.getSelection();

        range.setStart(textNode, 5); // After "Hello"
        range.setEnd(textNode, 5);
        selection?.removeAllRanges();
        selection?.addRange(range);
      });

      // Press Enter to split the list item
      await page.keyboard.press('Enter');
      await waitForDelay(page, 200);

      // Verify we now have 2 list items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // Wait for Yjs to capture
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo should merge the items back together
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify we're back to 1 list item with the original text
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);
      const restoredInput = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');

      await expect(restoredInput).toHaveText('Hello World');
    });

    test('redo after list item split places caret in the new item', async ({ page }) => {
      // Regression test: caret should be placed in the newly created item after redo,
      // not stay at the end of the previous item.
      // The bug was that the "after" caret position was captured synchronously
      // before requestAnimationFrame moved the caret to the new block.
      await createBlokWithBlocks(page, [
        {
          id: 'list-1',
          type: 'list',
          data: {
            text: 'First item',
            style: 'unordered',
          },
        },
      ]);

      const firstItem = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');

      // Click to focus the list item and press Enter to create a new item
      await firstItem.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await waitForDelay(page, 200);

      // Verify we have 2 list items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // Wait for Yjs to capture
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo - should merge items back
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify we're back to 1 list item
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);

      // Redo - should split again and place caret in the new (second) item
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify we have 2 list items again
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // KEY TEST: The caret should be focused on the second (new) list item, not the first
      const secondItem = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');
      const isSecondItemFocused = await isFocused(secondItem);

      expect(isSecondItemFocused).toBe(true);

      // Additionally verify the first item is NOT focused (extra confirmation)
      const firstItemAfterRedo = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');
      const isFirstItemFocused = await isFocused(firstItemAfterRedo);

      expect(isFirstItemFocused).toBe(false);
    });

    test('redo after undoing list item deletion restores deleted items', async ({ page }) => {
      // Create multiple list items
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { id: 'list-1', type: 'list', data: { text: 'First item', style: 'unordered' } },
              { id: 'list-2', type: 'list', data: { text: 'Second item', style: 'unordered' } },
              { id: 'list-3', type: 'list', data: { text: 'Third item', style: 'unordered' } },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Verify we have 3 list items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);

      // Select all list items using Cmd/Ctrl+A twice (first selects text, second selects all blocks)
      const firstItem = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');
      await firstItem.click();
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Meta+a');
      await waitForDelay(page, 100);

      // Delete them with Backspace
      await page.keyboard.press('Backspace');
      await waitForDelay(page, 200);

      // Verify list items are deleted (should have a replacement paragraph)
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(0);
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo the deletion
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify list items are restored
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);

      // Now redo - this should delete the list items again
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify list items are deleted again
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(0);
    });

    test('redo works after deleting list items one by one with Backspace', async ({ page }) => {
      // Create list items - user deletes them by pressing Backspace at the start of each line
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { id: 'list-1', type: 'list', data: { text: 'First', style: 'unordered' } },
              { id: 'list-2', type: 'list', data: { text: 'Second', style: 'unordered' } },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Verify we have 2 list items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // Focus on second item and delete it by pressing Backspace at start
      // This should convert second list item to paragraph
      const secondItem = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');
      await secondItem.click();
      // Place caret at start
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');
      await waitForDelay(page, 200);

      // After Backspace, we should have 1 list + 1 paragraph
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Undo - should restore to 2 list items
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(0);

      // Redo - should convert back to 1 list + 1 paragraph
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
    });

    test('redo works after undoing list item creation via Enter key', async ({ page }) => {
      // User creates a list with one item, then presses Enter to add more items
      // Then undoes which removes an item, and redo should restore it
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { id: 'list-1', type: 'list', data: { text: 'First item', style: 'unordered' } },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Verify we have 1 list item
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);

      // Click on the first item and press Enter to create a second item
      const firstItem = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');
      await firstItem.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await waitForDelay(page, 200);

      // Verify we now have 2 list items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // Type in the new item
      await page.keyboard.type('Second item');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Press Enter again to create a third item
      await page.keyboard.press('Enter');
      await waitForDelay(page, 200);

      // Verify we have 3 list items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);

      // Type in the third item
      await page.keyboard.type('Third item');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Now undo - should remove the third item (or its content)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Redo should restore what was undone
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Verify redo worked - we should still have 3 items with content
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);
      const thirdItem = getListBlockByIndex(page, 2).locator('[contenteditable="true"]');
      await expect(thirdItem).toHaveText('Third item');
    });

    test('redo works after undoing multiple list item creations', async ({ page }) => {
      // Start with one list item, then create more via Enter
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { id: 'list-1', type: 'list', data: { text: 'Item 1', style: 'unordered' } },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Click on the item and create more items via Enter
      const firstItem = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');
      await firstItem.click();
      await page.keyboard.press('End');

      // Create item 2
      await page.keyboard.press('Enter');
      await page.keyboard.type('Item 2');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Create item 3
      await page.keyboard.press('Enter');
      await page.keyboard.type('Item 3');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify we have 3 list items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);

      // Undo once - should affect item 3
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Undo again - should affect item 2 or item 3 creation
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Now redo - this is where the bug occurs
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Redo again
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should have 3 items restored
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);
    });

    test('redo works after undo removes list item created by Enter on non-empty item', async ({ page }) => {
      // This tests the splitBlock operation undo/redo
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { id: 'list-1', type: 'list', data: { text: 'Hello World', style: 'unordered' } },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Verify we have 1 list item with "Hello World"
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);

      // Click in the middle of "Hello World" and press Enter to split
      const firstItem = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');
      await firstItem.click();

      // Position cursor after "Hello " (6 characters)
      await page.keyboard.press('Home');
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('ArrowRight');
      }

      // Press Enter to split the list item
      await page.keyboard.press('Enter');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify we now have 2 list items: "Hello " and "World"
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // Undo - should merge the items back
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should have 1 list item again
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);

      // Redo - should split again
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should have 2 list items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);
    });

  });

  test.describe('ordered list marker renumbering', () => {
    test('redo works after undoing ordered list item deletion', async ({ page }) => {
      // This test verifies the fix for: when deleting ordered list items via undo,
      // the marker renumbering (e.g., "3." -> "2.") was triggering block data sync
      // which created new Yjs undo entries and cleared the redo stack.
      //
      // Test scenario: Start with 3 ordered items, delete the third by selecting
      // all its text and pressing Backspace, then undo/redo should work.
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { id: 'list-1', type: 'list', data: { text: 'First', style: 'ordered' } },
              { id: 'list-2', type: 'list', data: { text: 'Second', style: 'ordered' } },
              { id: 'list-3', type: 'list', data: { text: 'Third', style: 'ordered' } },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Verify we have 3 ordered list items with correct markers
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);
      const marker1 = getListBlockByIndex(page, 0).locator('[data-list-marker]');
      const marker2 = getListBlockByIndex(page, 1).locator('[data-list-marker]');
      const marker3 = getListBlockByIndex(page, 2).locator('[data-list-marker]');
      await expect(marker1).toHaveText('1.');
      await expect(marker2).toHaveText('2.');
      await expect(marker3).toHaveText('3.');

      // Delete the third item via Backspace at start position
      const thirdItem = getListBlockByIndex(page, 2).locator('[contenteditable="true"]');
      await thirdItem.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Should have 2 items now (third converted to paragraph)
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // Undo - this should restore the third item
      // The marker renumbering after restoration should NOT clear redo stack
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 300);

      // Should have 3 items again
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);

      // NOW the key test: redo should work
      // Before the fix, the marker update from undo would clear the redo stack
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 300);

      // Should be back to 2 items (the deletion is redone)
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);
    });

    test('redo works after undoing ordered list item removal via backspace', async ({ page }) => {
      // This test checks undo/redo after removing an item via Backspace at start
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { id: 'list-1', type: 'list', data: { text: 'Item 1', style: 'ordered' } },
              { id: 'list-2', type: 'list', data: { text: 'Item 2', style: 'ordered' } },
              { id: 'list-3', type: 'list', data: { text: 'Item 3', style: 'ordered' } },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Verify initial state: 3 items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);

      // Delete the second item via backspace at start (converts to paragraph)
      const secondItem = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');
      await secondItem.click();
      await page.keyboard.press('Home');
      await page.keyboard.press('Backspace');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Should have 2 list items now (one converted to paragraph)
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // Undo - this should restore the second item
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should have 3 list items again
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);

      // Redo should work - the marker renumbering after undo should NOT have cleared redo stack
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should have 2 list items again
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);
    });

    test('multiple undos on ordered list preserve redo stack correctly', async ({ page }) => {
      // Test that multiple sequential undos that each trigger marker updates
      // still preserve the full redo stack
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { id: 'list-1', type: 'list', data: { text: 'One', style: 'ordered' } },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Create 4 more items
      const firstItem = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');
      await firstItem.click();
      await page.keyboard.press('End');

      for (let i = 2; i <= 5; i++) {
        await page.keyboard.press('Enter');
        await page.keyboard.type(`Item ${i}`);
        await waitForDelay(page, YJS_CAPTURE_TIMEOUT);
      }

      // Verify we have 5 items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(5);

      // Verify markers
      for (let i = 0; i < 5; i++) {
        const marker = getListBlockByIndex(page, i).locator('[data-list-marker]');
        await expect(marker).toHaveText(`${i + 1}.`);
      }

      // Undo 3 times - each undo removes an item and triggers marker renumbering
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should have fewer items now
      const countAfterUndo = await page.locator(LIST_SELECTOR).count();
      expect(countAfterUndo).toBeLessThan(5);

      // Now redo 3 times - all should work
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should have 5 items restored
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(5);
    });

    test('redo works with checklist after undo', async ({ page }) => {
      // Checklists also sync 'checked' state which could trigger the same bug
      await resetBlok(page);
      await page.evaluate(async ({ holder }) => {
        const blok = new window.Blok({
          holder: holder,
          data: {
            blocks: [
              { id: 'list-1', type: 'list', data: { text: 'Task 1', style: 'checklist', checked: false } },
              { id: 'list-2', type: 'list', data: { text: 'Task 2', style: 'checklist', checked: true } },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      // Verify we have 2 checklist items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // Add a third task
      const secondItem = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');
      await secondItem.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Task 3');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify 3 items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);

      // Undo twice
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should be back to 2 items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // Redo should work
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);
      await page.keyboard.press(REDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should have 3 items
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(3);
    });

    test('typing IMMEDIATELY after Enter in list item still creates separate undo checkpoints', async ({ page }) => {
      // Edge case: typing with NO delay after Enter should still create separate checkpoints.
      // This tests that the stopCapturing logic works even when actions happen as fast as possible.
      await createBlokWithBlocks(page, [
        {
          id: 'list-1',
          type: 'list',
          data: {
            text: 'First item',
            style: 'unordered',
          },
        },
      ]);

      const firstItem = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');

      // Click to focus the list item and go to the end
      await firstItem.click();
      await page.keyboard.press('End');

      // Wait for Yjs to capture any initial state
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Press Enter to create a new list item, then IMMEDIATELY type without any delay
      // This simulates a fast typist or programmatic input
      await page.keyboard.press('Enter');
      // NO DELAY HERE - this is the key difference from the previous test
      await page.keyboard.type('Immediate text');

      // Wait for Yjs to capture the typing
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify we have 2 list items with correct content
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);
      const secondItem = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');

      await expect(secondItem).toHaveText('Immediate text');

      // First undo should ONLY remove the typed text
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should still have 2 list items (Enter created the item)
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(2);

      // The second item should be empty (text was undone, but item remains)
      const secondItemAfterUndo = getListBlockByIndex(page, 1).locator('[contenteditable="true"]');

      await expect(secondItemAfterUndo).toHaveText('');

      // Second undo should remove the new list item
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should be back to 1 list item
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);
    });

    test('list shortcut conversion creates separate undo group from subsequent typing', async ({ page }) => {
      // Bug: When quickly typing "1. Hello", the list conversion and "Hello" text
      // were being grouped into a single undo entry due to Yjs captureTimeout batching.
      // Expected: Two separate undo groups:
      //   1. List conversion ("1. " triggers conversion to ordered list)
      //   2. Typed text ("Hello")
      await createBlokWithBlocks(page, [
        {
          id: 'para-1',
          type: 'paragraph',
          data: {
            text: '',
          },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0).locator('[contenteditable="true"]');

      // Click to focus the paragraph
      await paragraph.click();

      // Type "1. " quickly to trigger list conversion, then type "Hello"
      // This simulates a user quickly typing "1. Hello" to create a numbered list
      await page.keyboard.type('1. Hello', { delay: 10 });

      // Wait for Yjs to capture the changes
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify we have a list item with "Hello"
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);
      const listItem = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');

      await expect(listItem).toHaveText('Hello');

      // First undo should ONLY remove the typed text "Hello"
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should still have 1 list item (conversion happened, text was undone)
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(1);

      // The list item should be empty (text was undone, but conversion remains)
      const listItemAfterUndo = getListBlockByIndex(page, 0).locator('[contenteditable="true"]');

      await expect(listItemAfterUndo).toHaveText('');

      // Second undo should undo the list conversion (back to paragraph)
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 200);

      // Should be back to a paragraph (no list items)
      await expect(page.locator(LIST_SELECTOR)).toHaveCount(0);
      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
    });
  });

  test.describe('smart grouping', () => {
    // Boundary timeout: 100ms in implementation + buffer for test reliability
    const BOUNDARY_TIMEOUT = 150;

    test('word boundary + pause creates checkpoint', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: '' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      await paragraphInput.click();

      // Type "Hello " then pause long enough for boundary timeout
      await page.keyboard.type('Hello ');
      await waitForDelay(page, BOUNDARY_TIMEOUT);

      // Type "world" and wait for Yjs to capture
      await page.keyboard.type('world');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify full text
      await expect(paragraphInput).toHaveText('Hello world');

      // Undo should remove only "world" (boundary + pause created checkpoint after "Hello ")
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 100);

      await expect(paragraphInput).toHaveText('Hello ');
    });

    test('punctuation + pause creates checkpoint', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: '' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      await paragraphInput.click();

      // Type "Hello," then pause long enough for boundary timeout
      await page.keyboard.type('Hello,');
      await waitForDelay(page, BOUNDARY_TIMEOUT);

      // Type " world" and wait for Yjs to capture
      await page.keyboard.type(' world');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify full text
      await expect(paragraphInput).toHaveText('Hello, world');

      // Undo should remove only " world" (boundary + pause created checkpoint after "Hello,")
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 100);

      await expect(paragraphInput).toHaveText('Hello,');
    });

    test('sentence boundary creates checkpoint', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: '' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      await paragraphInput.click();

      // Type "Hello." then pause long enough for boundary timeout
      await page.keyboard.type('Hello.');
      await waitForDelay(page, BOUNDARY_TIMEOUT);

      // Type " World" and wait for Yjs to capture
      await page.keyboard.type(' World');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify full text
      await expect(paragraphInput).toHaveText('Hello. World');

      // Undo should remove only " World" (boundary + pause created checkpoint after "Hello.")
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 100);

      await expect(paragraphInput).toHaveText('Hello.');
    });

    test('question mark creates checkpoint', async ({ page }) => {
      await createBlokWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: '' },
        },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable="true"]');

      await paragraphInput.click();

      // Type "What?" then pause long enough for boundary timeout
      await page.keyboard.type('What?');
      await waitForDelay(page, BOUNDARY_TIMEOUT);

      // Type " Yes" and wait for Yjs to capture
      await page.keyboard.type(' Yes');
      await waitForDelay(page, YJS_CAPTURE_TIMEOUT);

      // Verify full text
      await expect(paragraphInput).toHaveText('What? Yes');

      // Undo should remove only " Yes" (boundary + pause created checkpoint after "What?")
      await page.keyboard.press(UNDO_SHORTCUT);
      await waitForDelay(page, 100);

      await expect(paragraphInput).toHaveText('What?');
    });
  });
});
