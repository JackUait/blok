import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = '[data-blok-testid="block-tunes-popover"] [data-blok-testid="popover-container"]';
const DELETE_OPTION_SELECTOR = '[data-blok-testid="popover-item"][data-blok-item-name="delete"]';
const CONVERT_TO_OPTION_SELECTOR = '[data-blok-testid="popover-item"][data-blok-item-name="convert-to"]';
const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`);
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);
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

const selectAllBlocksViaKeyboard = async (page: Page): Promise<void> => {
  const firstParagraph = getParagraphByIndex(page, 0);

  await firstParagraph.click();
  await page.keyboard.press(SELECT_ALL_SHORTCUT);
  await page.keyboard.press(SELECT_ALL_SHORTCUT);
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

const selectBlocksWithShift = async (page: Page, startIndex: number, count: number): Promise<void> => {
  const startBlock = getBlockByIndex(page, startIndex);
  // eslint-disable-next-line playwright/no-nth-methods -- Need first contenteditable element in block
  const contentEditable = startBlock.locator('[contenteditable="true"]').first();

  await contentEditable.click();
  await placeCaretAtEnd(contentEditable);

  await page.keyboard.down('Shift');

  for (let i = 0; i < count - 1; i++) {
    await page.keyboard.press('ArrowDown');
  }

  await page.keyboard.up('Shift');
};

/**
 * Opens block tunes (settings menu) for the currently selected blocks.
 * Uses dispatchEvent to properly simulate mousedown/mouseup events that the toolbar listens for.
 */
const openBlockTunesForSelectedBlocks = async (page: Page): Promise<void> => {
  const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

  await expect(settingsButton).toBeVisible();

  // Use dispatchEvent for mousedown/mouseup to ensure proper event handling
  // The toolbar listens on mousedown and sets up a document-level mouseup listener
  await settingsButton.dispatchEvent('mousedown', { button: 0 });
  await settingsButton.dispatchEvent('mouseup', { button: 0 });

  const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

  await expect(popover).toHaveCount(1);
  await popover.waitFor({ state: 'visible' });
};

test.describe('multi-block selection with toolbar menu', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('selecting multiple blocks', () => {
    test('selects multiple blocks via CMD/CTRL+A twice', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      await selectAllBlocksViaKeyboard(page);

      // Verify all blocks are selected
      for (const index of [0, 1, 2]) {
        await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
      }
    });

    test('selects multiple blocks via Shift+ArrowDown', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      await selectBlocksWithShift(page, 0, 2);

      await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
      await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
      await expect(getBlockByIndex(page, 2)).not.toHaveAttribute('data-blok-selected', 'true');
    });

    test('shows toolbar for multi-block selection via Shift+Arrow', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      await selectBlocksWithShift(page, 0, 2);

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();
    });
  });

  test.describe('opening toolbar menu with multi-block selection', () => {
    test('opens block settings menu when multiple blocks are selected via Shift+Arrow', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      // Select multiple blocks using Shift+Arrow
      await selectBlocksWithShift(page, 0, 3);

      // Verify blocks are selected before opening menu
      for (const index of [0, 1, 2]) {
        await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
      }

      // Open block settings menu
      await openBlockTunesForSelectedBlocks(page);

      // Verify menu is open
      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toBeVisible();

      // Verify all blocks are still selected after opening menu
      for (const index of [0, 1, 2]) {
        await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
      }
    });

    test('opens block settings menu when multiple blocks are selected via CMD/CTRL+A', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      // Select all blocks using CMD+A twice
      await selectAllBlocksViaKeyboard(page);

      // Verify blocks are selected before opening menu
      for (const index of [0, 1, 2]) {
        await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
      }

      // Open block settings menu
      await openBlockTunesForSelectedBlocks(page);

      // Verify menu is open
      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toBeVisible();

      // Verify all blocks are still selected after opening menu
      for (const index of [0, 1, 2]) {
        await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
      }
    });

    test('menu shows delete option for multiple selected blocks', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
      ]);

      // Select multiple blocks
      await selectBlocksWithShift(page, 0, 3);

      // Open block settings menu
      await openBlockTunesForSelectedBlocks(page);

      // Verify delete option is visible in menu
      const deleteOption = page.locator(DELETE_OPTION_SELECTOR);

      await expect(deleteOption).toBeVisible();
    });

    test('menu shows convert-to option for multiple selected blocks', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
      ]);

      // Select multiple blocks
      await selectBlocksWithShift(page, 0, 2);

      // Open block settings menu
      await openBlockTunesForSelectedBlocks(page);

      // Verify convert-to option is visible in menu
      const convertToOption = page.locator(CONVERT_TO_OPTION_SELECTOR);

      await expect(convertToOption).toBeVisible();
    });
  });

  test.describe('user can perform actions on all selected blocks through menu', () => {
    test('can delete multiple selected blocks via menu', async ({ page }) => {
      await createBlokWithBlocks(page, [
        { type: 'paragraph', data: { text: 'First block' } },
        { type: 'paragraph', data: { text: 'Second block' } },
        { type: 'paragraph', data: { text: 'Third block' } },
        { type: 'paragraph', data: { text: 'Fourth block' } },
      ]);

      // Select first three blocks
      await selectBlocksWithShift(page, 0, 3);

      // Verify blocks are selected before opening menu
      for (const index of [0, 1, 2]) {
        await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
      }

      // Open block settings menu
      await openBlockTunesForSelectedBlocks(page);

      // Navigate to delete option and press Enter
      const deleteOption = page.locator(DELETE_OPTION_SELECTOR);

      await expect(deleteOption).toBeVisible();

      while (!await deleteOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await page.keyboard.press('Enter');

      // Wait for popover to close
      const popover = page.locator(POPOVER_CONTAINER_SELECTOR);

      await expect(popover).toHaveCount(0);

      // Verify blocks were deleted - only fourth block should remain
      const blocks = page.locator(BLOCK_WRAPPER_SELECTOR);

      await expect(blocks).toHaveCount(1);

      const savedData = await page.evaluate<OutputData>(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        return await window.blokInstance.save();
      });

      expect(savedData.blocks).toHaveLength(1);
      expect(savedData.blocks[0].data).toMatchObject({ text: 'Fourth block' });
    });
  });
});
