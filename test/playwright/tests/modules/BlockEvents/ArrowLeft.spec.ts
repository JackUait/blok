import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureEditorBundleBuilt } from '../../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../fixtures/test.html')
).href;
const HOLDER_ID = 'editorjs';
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-block[data-blok-block-tool="paragraph"] [contenteditable="true"]`;

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);
};

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.setAttribute('data-blok-testid', holderId);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditorWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId, blocks: editorBlocks }) => {
    const editor = new window.EditorJS({
      holder: holderId,
      data: { blocks: editorBlocks },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, {
    holderId: HOLDER_ID,
    blocks,
  });
};

const createParagraphEditor = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createEditorWithBlocks(page, blocks);
};

const createEditorWithDelimiter = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId }) => {
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

    const editor = new window.EditorJS({
      holder: holderId,
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

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID });
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
      return window.editorInstance?.blocks.getCurrentBlockIndex?.() ?? -1;
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

const getDelimiterBlock = (page: Page): Locator => {
  return page.locator(`${EDITOR_INTERFACE_SELECTOR} .ce-block:has([data-blok-testid-type="contentless-tool"])`);
};

test.describe('arrowLeft keydown', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('starting whitespaces handling', () => {
    test('should move caret over visible non-breaking space before navigating to previous block', async ({ page }) => {
      await createParagraphEditor(page, ['1', '&nbsp;2']);

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
      await createParagraphEditor(page, ['1', ' 2']);

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
      await createParagraphEditor(page, ['1', '<b></b>2']);

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
      await createParagraphEditor(page, ['1', '<b></b>&nbsp;2']);

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
      await createParagraphEditor(page, ['1', '<b></b>&nbsp;2']);

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
      await createParagraphEditor(page, ['1', ' &nbsp;2']);

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
    await createEditorWithDelimiter(page);

    const secondParagraph = getParagraphByIndex(page, 1);

    await secondParagraph.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowLeft');

    const delimiterBlock = getDelimiterBlock(page);

    await expect(delimiterBlock).toHaveAttribute('data-blok-selected', 'true');

    await page.keyboard.press('ArrowLeft');

    await expect(delimiterBlock).not.toHaveAttribute('data-blok-selected', 'true');

    const firstParagraph = getParagraphByIndex(page, 0);

    const caretInfo = await ensureCaretInfo(firstParagraph);

    expect(caretInfo.inside).toBe(true);
    expect(caretInfo.offset).toBe(1);
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}


