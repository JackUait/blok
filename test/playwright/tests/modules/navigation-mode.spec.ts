import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const NAVIGATION_FOCUSED_SELECTOR = '[data-blok-navigation-focused="true"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const getBlockWrapperSelectorByIndex = (index: number): string => {
  return `:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`;
};

const getParagraphSelectorByIndex = (index: number): string => {
  return `:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`;
};

const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(getBlockWrapperSelectorByIndex(index));
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
  await page.evaluate(async ({
    holder,
    blocks: blokBlocks,
  }: {
    holder: string;
    blocks: OutputData['blocks'];
  }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    blocks,
  });
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance is not ready');
    }

    return window.blokInstance.save();
  });
};



test.describe('navigation mode', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('entering navigation mode', () => {
    test('should enable navigation mode when pressing Escape while editing a block', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');

      const focusedBlock = page.locator(NAVIGATION_FOCUSED_SELECTOR);

      await expect(focusedBlock).toHaveCount(1);
      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-navigation-focused', 'true');
    });

    test('should focus the current block when entering navigation mode', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      const secondParagraph = getParagraphByIndex(page, 1);

      await secondParagraph.click();
      await page.keyboard.press('Escape');

      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-navigation-focused', 'true');
    });

    test('should remove text selection when entering navigation mode', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Some text content' } },
      ]);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Escape');

      const hasSelection = await page.evaluate(() => {
        const selection = window.getSelection();

        return selection !== null && selection.toString().length > 0;
      });

      expect(hasSelection).toBe(false);
    });
  });

  test.describe('navigating between blocks', () => {
    test('should navigate to next block with ArrowDown', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');

      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('ArrowDown');

      await expect(getBlockByIndex(page, 0)).not.toHaveAttribute('data-blok-navigation-focused', 'true');
      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-navigation-focused', 'true');
    });

    test('should navigate to previous block with ArrowUp', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      const thirdParagraph = getParagraphByIndex(page, 2);

      await thirdParagraph.click();
      await page.keyboard.press('Escape');

      await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('ArrowUp');

      await expect(getBlockByIndex(page, 2)).not.toHaveAttribute('data-blok-navigation-focused', 'true');
      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-navigation-focused', 'true');
    });

    test('should not navigate past the first block', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');

      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-navigation-focused', 'true');
    });

    test('should not navigate past the last block', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const secondParagraph = getParagraphByIndex(page, 1);

      await secondParagraph.click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');

      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-navigation-focused', 'true');
    });

    test('should navigate through multiple blocks sequentially', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
        { type: 'paragraph', data: { text: 'Fourth block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');

      await page.keyboard.press('ArrowDown');
      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('ArrowDown');
      await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('ArrowDown');
      await expect(getBlockByIndex(page, 3)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('ArrowUp');
      await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-navigation-focused', 'true');
    });
  });

  test.describe('exiting navigation mode', () => {
    test('should exit navigation mode and focus block for editing when pressing Enter', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');

      const focusedBlock = page.locator(NAVIGATION_FOCUSED_SELECTOR);

      await expect(focusedBlock).toHaveCount(0);

      const secondParagraphInput = getParagraphByIndex(page, 1).locator('[contenteditable="true"]');

      await expect(secondParagraphInput).toBeFocused();
    });

    test('should exit navigation mode without focusing when pressing Escape again', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');

      await expect(page.locator(NAVIGATION_FOCUSED_SELECTOR)).toHaveCount(1);

      await page.keyboard.press('Escape');

      await expect(page.locator(NAVIGATION_FOCUSED_SELECTOR)).toHaveCount(0);
    });

    test('should exit navigation mode and start editing when typing a printable character', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('ArrowDown');

      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.type('X');

      await expect(page.locator(NAVIGATION_FOCUSED_SELECTOR)).toHaveCount(0);

      const { blocks } = await saveBlok(page);
      const secondBlockText = (blocks[1].data as { text: string }).text;

      expect(secondBlockText).toContain('X');
    });

    test('should place caret at end of block when exiting with Enter', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Hello World' } },
      ]);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');

      await page.keyboard.type('!');

      const { blocks } = await saveBlok(page);
      const text = (blocks[0].data as { text: string }).text;

      expect(text).toBe('Hello World!');
    });
  });

  test.describe('navigation mode with single block', () => {
    test('should work with a single block', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Only block' } },
      ]);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await page.keyboard.press('Escape');

      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('ArrowDown');
      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('ArrowUp');
      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('Enter');
      await expect(page.locator(NAVIGATION_FOCUSED_SELECTOR)).toHaveCount(0);
    });
  });

  test.describe('navigation mode visual feedback', () => {
    test('should apply navigation focus attribute to focused block', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');

      const focusedBlock = getBlockByIndex(page, 0);

      await expect(focusedBlock).toHaveAttribute('data-blok-navigation-focused', 'true');
    });

    test('should move navigation focus attribute when navigating', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');

      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-navigation-focused', 'true');
      await expect(getBlockByIndex(page, 1)).not.toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('ArrowDown');

      await expect(getBlockByIndex(page, 0)).not.toHaveAttribute('data-blok-navigation-focused', 'true');
      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-navigation-focused', 'true');
    });

    test('should remove navigation focus attribute when exiting navigation mode', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
      ]);

      const paragraph = getParagraphByIndex(page, 0);

      await paragraph.click();
      await page.keyboard.press('Escape');

      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('Escape');

      await expect(getBlockByIndex(page, 0)).not.toHaveAttribute('data-blok-navigation-focused', 'true');
    });
  });

  test.describe('navigation mode edge cases', () => {
    test('should not enter navigation mode when toolbox popover is open', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: '' } },
      ]);

      const paragraph = getParagraphByIndex(page, 0);
      const paragraphInput = paragraph.locator('[contenteditable]');

      await paragraphInput.click();

      // Clear and prepare empty block for toolbox
      await paragraphInput.fill('');
      await page.keyboard.press('Backspace');

      // Wait for block to be marked as empty
      await expect(paragraphInput).toHaveAttribute('data-blok-empty', 'true');

      // Type / to open toolbox popover
      await page.keyboard.type('/');

      // Wait for toolbox popover to open
      const popover = page.locator('[data-blok-testid="toolbox-popover"]');

      await expect(popover).toHaveAttribute('data-blok-popover-opened', 'true');

      // Press Escape - should close toolbox, not enter navigation mode
      await page.keyboard.press('Escape');

      // Toolbox popover should be closed
      await expect(popover).not.toHaveAttribute('data-blok-popover-opened', 'true');

      // Navigation mode should not be active
      await expect(page.locator(NAVIGATION_FOCUSED_SELECTOR)).toHaveCount(0);
    });

    test('should handle rapid navigation key presses', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'Block 1' } },
        { type: 'paragraph', data: { text: 'Block 2' } },
        { type: 'paragraph', data: { text: 'Block 3' } },
        { type: 'paragraph', data: { text: 'Block 4' } },
        { type: 'paragraph', data: { text: 'Block 5' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');

      // Rapid navigation
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');

      await expect(getBlockByIndex(page, 4)).toHaveAttribute('data-blok-navigation-focused', 'true');

      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');

      await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-navigation-focused', 'true');
    });

    test('should re-enter navigation mode after exiting', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await page.keyboard.press('Escape');

      await expect(page.locator(NAVIGATION_FOCUSED_SELECTOR)).toHaveCount(1);

      await page.keyboard.press('Enter');

      await expect(page.locator(NAVIGATION_FOCUSED_SELECTOR)).toHaveCount(0);

      await page.keyboard.press('Escape');

      await expect(page.locator(NAVIGATION_FOCUSED_SELECTOR)).toHaveCount(1);
    });
  });
});
