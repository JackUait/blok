import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../fixtures/test.html')
).href;
const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable="true"]`;

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

const createBlokWithDelimiter = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
    /**
     *
     */
    class ContentlessToolMock {
      /**
       *
       */
      public static get contentless(): boolean {
        return true;
      }

      /**
       *
       */
      public render(): HTMLElement {
        const wrapper = document.createElement('div');

        wrapper.setAttribute('data-blok-testid-type', 'contentless-tool');
        wrapper.textContent = '***';

        return wrapper;
      }

      /**
       *
       */
      public save(): Record<string, never> {
        return {};
      }
    }

    const blok = new window.Blok({
      holder: holder,
      tools: {
        delimiter: ContentlessToolMock,
      },
      data: {
        blocks: [
          {
            id: 'block1',
            type: 'paragraph',
            data: {
              text: '1',
            },
          },
          {
            id: 'block2',
            type: 'delimiter',
            data: {},
          },
          {
            id: 'block3',
            type: 'paragraph',
            data: {
              text: '2',
            },
          },
        ],
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const getCaretInfo = (locator: Locator, options: { normalize?: boolean } = {}): Promise<{ inside: boolean; offset: number; textLength: number } | null> => {
  return locator.evaluate((element, { normalize }) => {
    const selection = element.ownerDocument.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);

    if (normalize) {
      range.startContainer.normalize();
    }

    return {
      inside: element.contains(range.startContainer),
      offset: range.startOffset,
      textLength: element.textContent?.length ?? 0,
    };
  }, { normalize: options.normalize ?? false });
};

const ensureCaretInfo = async (locator: Locator, options?: { normalize?: boolean }): Promise<{ inside: boolean; offset: number; textLength: number }> => {
  const caretInfo = await getCaretInfo(locator, options);

  if (!caretInfo) {
    throw new Error('Caret information is not available.');
  }

  return caretInfo;
};

const waitForCaretInBlock = async (page: Page, locator: Locator, expectedBlockIndex: number): Promise<void> => {
  await expect.poll(async () => {
    const caretInfo = await getCaretInfo(locator);

    if (!caretInfo || !caretInfo.inside) {
      return null;
    }

    const currentIndex = await page.evaluate(() => {
      return window.blokInstance?.blocks.getCurrentBlockIndex?.() ?? -1;
    });

    return currentIndex;
  }, {
    message: `Expected caret to land inside block with index ${expectedBlockIndex}`,
  }).toBe(expectedBlockIndex);
};

const placeCaretAtEnd = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => {
    const selection = window.getSelection();

    if (!selection) {
      return;
    }

    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(false);

    selection.removeAllRanges();
    selection.addRange(range);
  });
};

test.describe('arrowLeft keydown', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('starting whitespaces handling', () => {
    test('should move caret over visible non-breaking space before navigating to previous block', async ({ page }) => {
      await createParagraphBlok(page, ['1', '&nbsp;2']);

      const lastParagraph = getParagraphByIndex(page, 1);

      await lastParagraph.focus();
      await lastParagraph.evaluate((element) => {
        /**
         * Force white-space: pre-wrap to ensure that spaces are treated as visible
         * This is needed because in some environments (e.g. Playwright + Chromium),
         * &nbsp; might be normalized to a regular space, which is collapsed by default.
         */
        element.style.setProperty('white-space', 'pre-wrap');
      });
      await placeCaretAtEnd(lastParagraph);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');

      const firstParagraph = getParagraphByIndex(page, 0);

      await waitForCaretInBlock(page, firstParagraph, 0);

      const caretInfo = await ensureCaretInfo(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should ignore invisible spaces before caret when moving to previous block', async ({ page }) => {
      await createParagraphBlok(page, ['1', ' 2']);

      const lastParagraph = getParagraphByIndex(page, 1);

      await lastParagraph.click();
      await placeCaretAtEnd(lastParagraph);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');

      const firstParagraph = getParagraphByIndex(page, 0);

      await waitForCaretInBlock(page, firstParagraph, 0);

      const caretInfo = await ensureCaretInfo(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should ignore empty tags before caret when moving to previous block', async ({ page }) => {
      await createParagraphBlok(page, ['1', '<b></b>2']);

      const lastParagraph = getParagraphByIndex(page, 1);

      await lastParagraph.click();
      await placeCaretAtEnd(lastParagraph);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');

      const firstParagraph = getParagraphByIndex(page, 0);

      await waitForCaretInBlock(page, firstParagraph, 0);

      const caretInfo = await ensureCaretInfo(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should move caret over non-breaking space that follows empty tag before navigating to previous block', async ({ page }) => {
      await createParagraphBlok(page, ['1', '<b></b>&nbsp;2']);

      const lastParagraph = getParagraphByIndex(page, 1);

      await lastParagraph.click();
      await placeCaretAtEnd(lastParagraph);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');

      const firstParagraph = getParagraphByIndex(page, 0);

      await waitForCaretInBlock(page, firstParagraph, 0);

      const caretInfo = await ensureCaretInfo(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should handle non-breaking space placed before empty tag when moving to previous block', async ({ page }) => {
      await createParagraphBlok(page, ['1', '<b></b>&nbsp;2']);

      const lastParagraph = getParagraphByIndex(page, 1);

      await lastParagraph.click();
      await placeCaretAtEnd(lastParagraph);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');

      const firstParagraph = getParagraphByIndex(page, 0);

      await waitForCaretInBlock(page, firstParagraph, 0);

      const caretInfo = await ensureCaretInfo(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should move caret over non-breaking and regular spaces before navigating to previous block', async ({ page }) => {
      await createParagraphBlok(page, ['1', ' &nbsp;2']);

      const lastParagraph = getParagraphByIndex(page, 1);

      await lastParagraph.click();
      await placeCaretAtEnd(lastParagraph);
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');

      const firstParagraph = getParagraphByIndex(page, 0);

      await waitForCaretInBlock(page, firstParagraph, 0);

      const caretInfo = await ensureCaretInfo(firstParagraph);

      expect(caretInfo.inside).toBe(true);
    });
  });

  test('should move caret to previous block when focused block is contentless', async ({ page }) => {
    await createBlokWithDelimiter(page);

    // Focus on third block's input and position caret at start
    const thirdBlockInput = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-id="block3"] [contenteditable="true"]`);

    await thirdBlockInput.focus();

    // Use Caret API to ensure we're at the start
    await page.evaluate(() => {
      const block = window.blokInstance?.blocks.getBlockByIndex(2);

      if (block?.holder) {
        const input = block.holder.querySelector('[contenteditable="true"]');

        if (input) {
          const range = document.createRange();
          const selection = window.getSelection();
          const textNode = input.firstChild || input;

          range.setStart(textNode, 0);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
    });

    // Wait for caret to be in the third block
    await expect.poll(async () => {
      return await page.evaluate(() => window.blokInstance?.blocks.getCurrentBlockIndex?.() ?? -1);
    }).toBe(2);

    // Move left to cross block boundary to contentless block
    await page.keyboard.press('ArrowLeft');

    // Wait for the contentless block to become current (index 1)
    await expect.poll(async () => {
      return await page.evaluate(() => window.blokInstance?.blocks.getCurrentBlockIndex?.() ?? -1);
    }, {
      message: 'Expected to navigate to contentless block (index 1)',
    }).toBe(1);

    // Continue navigation to previous block
    await page.keyboard.press('ArrowLeft');

    const firstParagraph = getParagraphByIndex(page, 0);

    await waitForCaretInBlock(page, firstParagraph, 0);

    const caretInfo = await ensureCaretInfo(firstParagraph);

    expect(caretInfo.inside).toBe(true);
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}


