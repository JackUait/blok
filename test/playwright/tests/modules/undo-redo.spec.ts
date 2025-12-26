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
});
