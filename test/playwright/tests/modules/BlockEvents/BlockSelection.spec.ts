import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Blok, OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    // Clear any pending timeouts or async operations from previous instances
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    // Force garbage collection of any detached DOM nodes by clearing body
    // This removes all event listeners and prevents state pollution in WebKit
    document.body.innerHTML = '';

    // Create a fresh container
    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);

    // Force a layout calculation to ensure the DOM is fully updated
    // This helps WebKit and other browsers flush any pending updates
    void container.offsetHeight;
  }, { holder: HOLDER_ID });
};

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
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

const createParagraphBlok = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createBlokWithBlocks(page, blocks);
};

const getBlockByIndex = (page: Page, index: number): ReturnType<Page['locator']> => {
  return page.locator(`:nth-match(${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"], ${index + 1})`);
};

const getBlockWrapper = (page: Page, index: number): ReturnType<Page['locator']> => {
  return page.locator(`:nth-match(${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"], ${index + 1})`);
};

/**
 * Place caret at the start of a contenteditable element
 */
const placeCaretAtStart = async (locator: ReturnType<Page['locator']>): Promise<void> => {
  await locator.evaluate((element) => {
    const doc = element.ownerDocument;
    const selection = doc?.getSelection();

    if (!selection) {
      return;
    }

    const range = doc.createRange();
    const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const firstTextNode = walker.nextNode() as Text | null;

    if (firstTextNode) {
      range.setStart(firstTextNode, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
};

/**
 * Place caret at the end of a contenteditable element
 */
const placeCaretAtEnd = async (locator: ReturnType<Page['locator']>): Promise<void> => {
  await locator.evaluate((element) => {
    const doc = element.ownerDocument;
    const selection = doc?.getSelection();

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
      range.setStart(lastTextNode, lastTextNode.length ?? 0);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
};

/**
 * Helper to trigger synthetic copy event and capture clipboard data
 * Uses synthetic ClipboardEvent to avoid OS clipboard reliability issues in CI
 */
const withClipboardEvent = async (
  page: Page,
  eventName: 'copy' | 'cut'
): Promise<void> => {
  await page.evaluate((type) => {
    const redactor = document.querySelector('[data-blok-interface]');
    if (!redactor) {
      return;
    }

    const dataTransfer = new DataTransfer();

    /**
     * Firefox doesn't properly expose data set via setData() when reading
     * from the DataTransfer after event dispatch. We wrap setData to capture
     * the data directly as it's being set by the event handler.
     */
    const originalSetData = dataTransfer.setData.bind(dataTransfer);

    dataTransfer.setData = (format: string, data: string): void => {
      // Store data on window for retrieval during paste
      if (!window.__syntheticClipboard) {
        window.__syntheticClipboard = {};
      }
      window.__syntheticClipboard[format] = data;
      originalSetData(format, data);
    };

    const event = new ClipboardEvent(type, {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    /**
     * Firefox doesn't always honor the clipboardData passed to the constructor.
     * We force-set it using Object.defineProperty if it differs from our DataTransfer.
     */
    if (event.clipboardData !== dataTransfer) {
      Object.defineProperty(event, 'clipboardData', {
        value: dataTransfer,
        writable: false,
        configurable: true,
      });
    }

    redactor.dispatchEvent(event);
  }, eventName);
};

/**
 * Helper to trigger synthetic paste event with data from synthetic clipboard
 * Uses synthetic ClipboardEvent to avoid OS clipboard reliability issues in CI
 */
const withSyntheticPaste = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const redactor = document.querySelector('[data-blok-interface]');
    if (!redactor) {
      return;
    }

    const clipboardData = window.__syntheticClipboard;

    if (!clipboardData) {
      return;
    }

    const dataTransfer = new DataTransfer();

    // Restore all data types from synthetic clipboard
    Object.entries(clipboardData).forEach(([format, data]) => {
      dataTransfer.setData(format, data);
    });

    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });

    /**
     * Firefox doesn't always honor the clipboardData passed to the constructor.
     * We force-set it using Object.defineProperty if it differs from our DataTransfer.
     */
    if (event.clipboardData !== dataTransfer) {
      Object.defineProperty(event, 'clipboardData', {
        value: dataTransfer,
        writable: false,
        configurable: true,
      });
    }

    // Find the currently focused contenteditable element
    const activeElement = document.activeElement as HTMLElement;
    const targetElement = activeElement?.closest('[contenteditable="true"]') || activeElement || redactor;

    targetElement.dispatchEvent(event);
  });
};

test.describe('block selection keyboard shortcuts', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('shift+ArrowDown for multi-select', () => {
    test('selects multiple blocks when Shift+ArrowDown is pressed', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Second', 'Third']);

      const firstBlock = getBlockByIndex(page, 0);
      const firstBlockInput = firstBlock.locator('[contenteditable="true"]');

      await firstBlockInput.click();
      await placeCaretAtEnd(firstBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      const firstBlockWrapper = getBlockWrapper(page, 0);
      const secondBlockWrapper = getBlockWrapper(page, 1);

      await expect(firstBlockWrapper).toHaveAttribute('data-blok-selected', 'true');
      await expect(secondBlockWrapper).toHaveAttribute('data-blok-selected', 'true');

      const thirdBlockWrapper = getBlockWrapper(page, 2);
      await expect(thirdBlockWrapper).not.toHaveAttribute('data-blok-selected', 'true');
    });

    test('extends selection when Shift+ArrowDown is pressed again', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Second', 'Third']);

      const firstBlock = getBlockByIndex(page, 0);
      const firstBlockInput = firstBlock.locator('[contenteditable="true"]');

      await firstBlockInput.click();
      await placeCaretAtEnd(firstBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      const allBlocks = await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`).all();

      await expect(allBlocks[0]).toHaveAttribute('data-blok-selected', 'true');
      await expect(allBlocks[1]).toHaveAttribute('data-blok-selected', 'true');
      await expect(allBlocks[2]).toHaveAttribute('data-blok-selected', 'true');
    });
  });

  test.describe('shift+ArrowUp for multi-select', () => {
    test('selects multiple blocks when Shift+ArrowUp is pressed from bottom', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Second', 'Third']);

      const lastBlock = getBlockByIndex(page, 2);
      const lastBlockInput = lastBlock.locator('[contenteditable="true"]');

      await lastBlockInput.click();
      await placeCaretAtStart(lastBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.up('Shift');

      const secondBlockWrapper = getBlockWrapper(page, 1);
      const thirdBlockWrapper = getBlockWrapper(page, 2);

      await expect(secondBlockWrapper).toHaveAttribute('data-blok-selected', 'true');
      await expect(thirdBlockWrapper).toHaveAttribute('data-blok-selected', 'true');

      const firstBlockWrapper = getBlockWrapper(page, 0);
      await expect(firstBlockWrapper).not.toHaveAttribute('data-blok-selected', 'true');
    });

    test('extends selection upward when Shift+ArrowUp is pressed again', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Second', 'Third']);

      const lastBlock = getBlockByIndex(page, 2);
      const lastBlockInput = lastBlock.locator('[contenteditable="true"]');

      await lastBlockInput.click();
      await placeCaretAtStart(lastBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.up('Shift');

      const allBlocks = await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`).all();

      await expect(allBlocks[0]).toHaveAttribute('data-blok-selected', 'true');
      await expect(allBlocks[1]).toHaveAttribute('data-blok-selected', 'true');
      await expect(allBlocks[2]).toHaveAttribute('data-blok-selected', 'true');
    });
  });

  test.describe('deleting selected blocks', () => {
    test('deletes selected blocks with Backspace key', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Second', 'Third', 'Fourth']);

      const secondBlock = getBlockByIndex(page, 1);
      const secondBlockInput = secondBlock.locator('[contenteditable="true"]');

      // Select two blocks (Second and Third)
      await secondBlockInput.click();
      await placeCaretAtEnd(secondBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      // Press Backspace to delete selected blocks
      await page.keyboard.press('Backspace');

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => (b.data as { text: string }).text)).toStrictEqual(['First', 'Fourth']);
    });

    test('deletes selected blocks with Delete key', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Second', 'Third', 'Fourth']);

      const secondBlock = getBlockByIndex(page, 1);
      const secondBlockInput = secondBlock.locator('[contenteditable="true"]');

      // Select two blocks (Second and Third)
      await secondBlockInput.click();
      await placeCaretAtEnd(secondBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      // Press Delete to delete selected blocks
      await page.keyboard.press('Delete');

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => (b.data as { text: string }).text)).toStrictEqual(['First', 'Fourth']);
    });

    test('places caret in replacement block after deletion', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Second', 'Third']);

      const firstBlock = getBlockByIndex(page, 0);
      const firstBlockInput = firstBlock.locator('[contenteditable="true"]');

      await firstBlockInput.click();
      await placeCaretAtEnd(firstBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      // Delete selected blocks
      await page.keyboard.press('Backspace');

      // Caret should be in the replacement block
      const currentBlockIndex = await page.evaluate(() => window.blokInstance?.blocks.getCurrentBlockIndex?.() ?? -1);

      expect(currentBlockIndex).toBe(0);
    });
  });

  test.describe('copying selected blocks', () => {
    test('copies selected blocks with Cmd+C', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Selected 1', 'Selected 2']);

      const secondBlock = getBlockByIndex(page, 1);
      const secondBlockInput = secondBlock.locator('[contenteditable="true"]');

      // Select two blocks
      await secondBlockInput.click();
      await placeCaretAtEnd(secondBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      // Verify selection
      const secondBlockWrapper = getBlockWrapper(page, 1);
      const thirdBlockWrapper = getBlockWrapper(page, 2);
      await expect(secondBlockWrapper).toHaveAttribute('data-blok-selected', 'true');
      await expect(thirdBlockWrapper).toHaveAttribute('data-blok-selected', 'true');

      // Trigger synthetic copy event (avoids OS clipboard reliability issues in CI)
      await withClipboardEvent(page, 'copy');

      // Focus the third block for paste
      const thirdBlock = getBlockByIndex(page, 2);
      const thirdBlockInput = thirdBlock.locator('[contenteditable="true"]');
      await thirdBlockInput.click();

      // Trigger synthetic paste event
      await withSyntheticPaste(page);

      // Wait for block count to increase after paste (condition-based wait, not arbitrary timeout)
      await page.waitForFunction(() => {
        const wrappers = document.querySelectorAll('[data-blok-testid="block-wrapper"]');
        return wrappers.length > 3;
      }, { timeout: 2000 });

      // Should have more blocks after paste
      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks.length).toBeGreaterThan(3);
    });

    test('cuts selected blocks with Cmd+X', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'To be cut 1', 'To be cut 2', 'Fourth']);

      const secondBlock = getBlockByIndex(page, 1);
      const secondBlockInput = secondBlock.locator('[contenteditable="true"]');

      // Select two blocks
      await secondBlockInput.click();
      await placeCaretAtEnd(secondBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      // Verify selection
      const secondBlockWrapper = getBlockWrapper(page, 1);
      const thirdBlockWrapper = getBlockWrapper(page, 2);
      await expect(secondBlockWrapper).toHaveAttribute('data-blok-selected', 'true');
      await expect(thirdBlockWrapper).toHaveAttribute('data-blok-selected', 'true');

      // Trigger synthetic cut event (avoids OS clipboard reliability issues in CI)
      await withClipboardEvent(page, 'cut');

      // Wait for block count to decrease after cut (condition-based wait, not arbitrary timeout)
      // The cut operation is async: copySelectedBlocks().then(delete blocks)
      await page.waitForFunction(() => {
        const wrappers = document.querySelectorAll('[data-blok-testid="block-wrapper"]');
        return wrappers.length === 2;
      }, { timeout: 2000 });

      const { blocks } = await page.evaluate(async () => await window.blokInstance?.save() as OutputData);

      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => (b.data as { text: string }).text)).toStrictEqual(['First', 'Fourth']);
    });
  });

  test.describe('arrow keys clear selection', () => {
    test('clears block selection when ArrowLeft is pressed', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Second', 'Third']);

      const secondBlock = getBlockByIndex(page, 1);
      const secondBlockInput = secondBlock.locator('[contenteditable="true"]');

      // Select two blocks
      await secondBlockInput.click();
      await placeCaretAtEnd(secondBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      const secondBlockWrapper = getBlockWrapper(page, 1);
      const thirdBlockWrapper = getBlockWrapper(page, 2);

      await expect(secondBlockWrapper).toHaveAttribute('data-blok-selected', 'true');
      await expect(thirdBlockWrapper).toHaveAttribute('data-blok-selected', 'true');

      // Press ArrowLeft to clear selection
      await page.keyboard.press('ArrowLeft');

      await expect(secondBlockWrapper).not.toHaveAttribute('data-blok-selected', 'true');
      await expect(thirdBlockWrapper).not.toHaveAttribute('data-blok-selected', 'true');
    });

    test('clears block selection when ArrowRight is pressed', async ({ page }) => {
      await createParagraphBlok(page, ['First', 'Second', 'Third']);

      const secondBlock = getBlockByIndex(page, 1);
      const secondBlockInput = secondBlock.locator('[contenteditable="true"]');

      // Select two blocks
      await secondBlockInput.click();
      await placeCaretAtEnd(secondBlockInput);
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');

      const secondBlockWrapper = getBlockWrapper(page, 1);
      const thirdBlockWrapper = getBlockWrapper(page, 2);

      await expect(secondBlockWrapper).toHaveAttribute('data-blok-selected', 'true');
      await expect(thirdBlockWrapper).toHaveAttribute('data-blok-selected', 'true');

      // Press ArrowRight to clear selection
      await page.keyboard.press('ArrowRight');

      await expect(secondBlockWrapper).not.toHaveAttribute('data-blok-selected', 'true');
      await expect(thirdBlockWrapper).not.toHaveAttribute('data-blok-selected', 'true');
    });
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    __syntheticClipboard?: Record<string, string>;
  }
}
