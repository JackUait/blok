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
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const CONTENTLESS_TOOL_SELECTOR = '[data-blok-testid-type="contentless-tool"]';

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createEditorWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holder, blocks: editorBlocks }) => {
    const editor = new window.EditorJS({
      holder: holder,
      data: { blocks: editorBlocks },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

const createParagraphEditor = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createEditorWithBlocks(page, blocks);
};

const createEditorWithContentlessBlock = async (page: Page): Promise<void> => {
  await resetEditor(page);
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

        wrapper.setAttribute('data-blok-testid', 'contentless-tool');
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

    window.editorInstance = editor;
    await editor.isReady;
  }, { holder: HOLDER_ID });
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);
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

const getCaretInfoOrThrow = async (
  locator: Locator,
  options: { normalize?: boolean } = {}
): Promise<{ inside: boolean; offset: number; textLength: number }> => {
  const caretInfo = await getCaretInfo(locator, options);

  if (caretInfo === null) {
    throw new Error('Failed to retrieve caret information.');
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

test.describe('arrow right keydown', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(msg.text()));
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
    await page.addStyleTag({ content: '.blok-paragraph { white-space: pre-wrap !important; }' });
  });

  test.describe('starting whitespaces handling', () => {
    test('should move caret over visible non-breaking space then to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1&nbsp;', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      // Explicitly set textContent to ensure NBSP is preserved
      await firstParagraph.evaluate((node) => {
        const content = node.querySelector('.blok-paragraph');

        if (content) {
          content.textContent = '1\\u00A0';
        }
      });

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should ignore invisible space after caret and move to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1 ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should ignore empty tags after caret and move to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      // Explicitly set innerHTML to ensure empty tags are preserved
      await firstParagraph.evaluate((node) => {
        const content = node.querySelector('.blok-paragraph');

        if (content) {
          content.innerHTML = '1<b></b>';
        }
      });

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should move caret over visible space and then to next block when empty tag follows', async ({ page }) => {
      await createParagraphEditor(page, ['1&nbsp;<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      // Explicitly set innerHTML to ensure empty tags and NBSP are preserved
      await firstParagraph.evaluate((node) => {
        const content = node.querySelector('.blok-paragraph');

        if (content) {
          content.innerHTML = '1&nbsp;<b></b>';
        }
      });

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should ignore empty tag and move caret over visible space before moving to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1<b></b>&nbsp;', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      // Explicitly set innerHTML to ensure empty tags and NBSP are preserved
      await firstParagraph.evaluate((node) => {
        const content = node.querySelector('.blok-paragraph');

        if (content) {
          content.innerHTML = '1<b></b>&nbsp;';
        }
      });

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should move caret over visible space and ignore trailing space before moving to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1&nbsp; ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });
  });

  test('should move caret to next block if currently focused block is contentless', async ({ page }) => {
    await createEditorWithContentlessBlock(page);

    const firstParagraph = getParagraphByIndex(page, 0);
    const contentlessBlock = page.locator(BLOCK_SELECTOR, {
      has: page.locator(CONTENTLESS_TOOL_SELECTOR),
    });
    const lastParagraph = getParagraphByIndex(page, 1);

    await firstParagraph.click();
    await firstParagraph.press('End');
    await page.keyboard.press('ArrowRight');

    await expect(contentlessBlock).toHaveAttribute('data-blok-selected', 'true');

    await page.keyboard.press('ArrowRight');

    await expect(contentlessBlock).not.toHaveAttribute('data-blok-selected', 'true');

    await waitForCaretInBlock(page, lastParagraph, 2);

    const caretInfo = await getCaretInfoOrThrow(lastParagraph);

    expect(caretInfo.inside).toBe(true);
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}
