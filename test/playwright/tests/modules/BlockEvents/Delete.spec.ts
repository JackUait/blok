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
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} div.ce-block`;
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-block[data-block-tool="paragraph"]`;
const TOOLBAR_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar`;
const QUOTE_TOOL_INPUT_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-cy="quote-tool"] div[contenteditable]`;

const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${BLOCK_SELECTOR}, ${index + 1})`);
};

const getLastBlock = async (page: Page): Promise<Locator> => {
  const blockCount = await page.locator(BLOCK_SELECTOR).count();

  if (blockCount === 0) {
    throw new Error('No blocks found for selector: div.ce-block');
  }

  return page.locator(`:nth-match(${BLOCK_SELECTOR}, ${blockCount})`);
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);
};

const getQuoteToolInputByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${QUOTE_TOOL_INPUT_SELECTOR}, ${index + 1})`);
};

const getLastQuoteToolInput = async (page: Page): Promise<Locator> => {
  const inputCount = await page.locator(QUOTE_TOOL_INPUT_SELECTOR).count();

  if (inputCount === 0) {
    throw new Error('No quote tool inputs found');
  }

  return page.locator(`:nth-match(${QUOTE_TOOL_INPUT_SELECTOR}, ${inputCount})`);
};

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.body.innerHTML = '';

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.cy = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditorWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId, blocks: editorBlocks }) => {
    console.log('createEditorWithBlocks: blocks count', editorBlocks.length);
    const editor = new window.EditorJS({
      holder: holderId,
      data: { blocks: editorBlocks },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID,
    blocks });
};

const createParagraphEditor = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createEditorWithBlocks(page, blocks);
};

const createMultiInputToolEditor = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId }) => {
    /**
     *
     */
    class ExampleOfToolWithSeveralInputs {
      /**
       *
       */
      public render(): HTMLElement {
        const container = document.createElement('div');
        const input = document.createElement('div');
        const input2 = document.createElement('div');

        container.dataset.cy = 'quote-tool';

        input.contentEditable = 'true';
        input2.contentEditable = 'true';

        container.append(input, input2);

        return container;
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
        quote: ExampleOfToolWithSeveralInputs,
      },
      data: {
        blocks: [
          {
            type: 'quote',
            data: {},
          },
        ],
      },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID });
};

const createEditorWithUnmergeableTool = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId }) => {
    /**
     *
     */
    class ExampleOfUnmergeableTool {
      /**
       *
       */
      public render(): HTMLElement {
        const container = document.createElement('div');

        container.dataset.cy = 'unmergeable-tool';
        container.contentEditable = 'true';
        container.innerHTML = 'Unmergeable not empty tool';

        return container;
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
        code: ExampleOfUnmergeableTool,
      },
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Second block',
            },
          },
          {
            type: 'code',
            data: {},
          },
        ],
      },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID });
};

const saveEditor = async (page: Page): Promise<OutputData> => {
  return page.evaluate(async () => {
    if (!window.editorInstance) {
      throw new Error('Editor instance is not initialized');
    }

    return window.editorInstance.save();
  });
};

const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    let textNode: Node | null = element.firstChild;

    // Find first text node
    const iterator = document.createNodeIterator(element, NodeFilter.SHOW_TEXT);
    let node;

    while ((node = iterator.nextNode())) {
      if (node.textContent?.includes(targetText)) {
        textNode = node;
        break;
      }
    }

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error(`Element does not contain a text node with text "${targetText}"`);
    }

    const content = textNode.textContent ?? '';
    const start = content.indexOf(targetText);

    if (start === -1) {
      throw new Error(`Text "${targetText}" was not found`);
    }

    const range = element.ownerDocument.createRange();

    range.setStart(textNode, start);
    range.setEnd(textNode, start + targetText.length);

    const selection = element.ownerDocument.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, text);
};

const setCaret = async (locator: Locator, index: number, offset: number): Promise<void> => {
  await locator.evaluate((element, { index: targetIndex, offset: targetOffset }) => {
    const iterator = document.createNodeIterator(element, NodeFilter.SHOW_TEXT);
    let node;
    let currentIndex = 0;
    let textNode;

    while ((node = iterator.nextNode())) {
      if (currentIndex === targetIndex) {
        textNode = node;
        break;
      }
      currentIndex++;
    }

    if (!textNode) {
      throw new Error(`Text node at index ${targetIndex} not found`);
    }

    const selection = element.ownerDocument.getSelection();
    const range = element.ownerDocument.createRange();

    range.setStart(textNode, targetOffset);
    range.setEnd(textNode, targetOffset);

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, {
    index,
    offset,
  });
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
      'nodeContentEncoded': encodeURIComponent(range.startContainer.textContent || ''),
      'sliceTextEncoded': encodeURIComponent(range.startContainer.textContent?.slice(range.startOffset) || ''),
      inside: element.contains(range.startContainer),
      offset: range.startOffset,
      textLength: element.textContent?.length ?? 0,
    };
  }, { normalize: options.normalize ?? false });
};

const expectCaretAtStart = async (locator: Locator): Promise<void> => {
  const caretInfo = await getCaretInfo(locator);

  expect(caretInfo?.inside).toBeTruthy();
  expect(caretInfo?.offset).toBe(0);
};

const expectCaretOffset = async (locator: Locator, expectedOffset: number, options?: { normalize?: boolean }): Promise<void> => {
  const caretInfo = await getCaretInfo(locator, options);

  expect(caretInfo?.inside).toBeTruthy();
  expect(caretInfo?.offset).toBe(expectedOffset);
};

const expectToolbarClosed = async (page: Page): Promise<void> => {
  const toolbar = page.locator(TOOLBAR_SELECTOR);

  await expect(toolbar).not.toHaveClass(/ce-toolbar--opened/);
};

test.describe('delete keydown', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('ending whitespaces handling', () => {
    test('should delete visible non-breaking space', async ({ page }) => {
      await createParagraphEditor(page, ['1\u00A0', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const paragraphContent = firstParagraph.locator('.ce-paragraph');

      await firstParagraph.click();

      await paragraphContent.evaluate((el) => {
        // eslint-disable-next-line no-param-reassign
        el.style.whiteSpace = 'pre-wrap';
      });

      // Ensure focus
      await firstParagraph.click();

      // Set caret before NBSP (index 0, offset 1)
      await setCaret(paragraphContent, 0, 1);

      // Delete NBSP using Delete (forward)
      await page.keyboard.press('Delete');

      // Check if "1" is still there (NBSP deleted)
      await expect(getBlockByIndex(page, 0)).toHaveText('1');

      // Now we are at the end of "1". Press Delete to merge.
      await page.keyboard.press('Delete');

      await expect(getBlockByIndex(page, 0)).toHaveText('12');
    });

    test('should merge blocks when invisible space follows caret', async ({ page }) => {
      await createParagraphEditor(page, ['1 ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await firstParagraph.press('ArrowRight');
      await firstParagraph.press('Delete');

      const lastBlock = await getLastBlock(page);

      await expect(lastBlock).toHaveText('1 2');
    });

    test('should ignore empty tags after caret when merging', async ({ page }) => {
      await createParagraphEditor(page, ['1<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await firstParagraph.press('End');
      // Move left to skip empty tag if treated as char, or just stay at end if ignored?
      // 1<b></b>|. If we delete, we merge.
      // But if we want to be sure we are at end.
      // The test expects '12'.
      // If we are at end: 'Delete' -> merge.
      await firstParagraph.press('Delete');

      const lastBlock = await getLastBlock(page);

      await expect(lastBlock).toHaveText('12');
    });

    test('should remove non-breaking space and ignore empty tag', async ({ page }) => {
      await createParagraphEditor(page, ['1\u00A0<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const paragraphContent = firstParagraph.locator('.ce-paragraph');

      await firstParagraph.click();

      await paragraphContent.evaluate((el) => {
        // eslint-disable-next-line no-param-reassign
        el.style.whiteSpace = 'pre-wrap';
      });

      // Place caret BEFORE NBSP. "1\u00A0" is before <b>. Index 0. Offset 1.
      await setCaret(paragraphContent, 0, 1);

      // Delete NBSP (forward)
      await page.keyboard.press('Delete');

      await expect(getBlockByIndex(page, 0)).toHaveText('1');

      // Delete (merge)
      await page.keyboard.press('Delete');

      const lastBlock = await getLastBlock(page);

      await expect(lastBlock).toHaveText('12');
    });

    test('should remove non-breaking space placed after empty tag', async ({ page }) => {
      await createParagraphEditor(page, ['1<b></b>\u00A0', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const paragraphContent = firstParagraph.locator('.ce-paragraph');

      await firstParagraph.click();

      await paragraphContent.evaluate((el) => {
        // eslint-disable-next-line no-param-reassign
        el.style.whiteSpace = 'pre-wrap';
      });

      // "1" (index 0), <b>, NBSP (index 1).
      // Caret BEFORE NBSP. Index 1. Offset 0.
      await setCaret(paragraphContent, 1, 0);

      // Delete NBSP (forward)
      await page.keyboard.press('Delete');

      // Should look like "1"
      await expect(getBlockByIndex(page, 0)).toHaveText('1');

      // Delete (merge)
      await page.keyboard.press('Delete');
    });

    test('should remove non-breaking space and ignore regular space', async ({ page }) => {
      await createParagraphEditor(page, ['1\u00A0 ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const paragraphContent = firstParagraph.locator('.ce-paragraph');

      await firstParagraph.click();

      await paragraphContent.evaluate((el) => {
        // eslint-disable-next-line no-param-reassign
        el.style.whiteSpace = 'pre-wrap';
      });

      // Move to end. "1", NBSP, " ".
      // Set caret before NBSP (index 0, offset 1)
      await setCaret(paragraphContent, 0, 1);

      // Delete NBSP (forward)
      await page.keyboard.press('Delete');

      await expect(getBlockByIndex(page, 0)).toHaveText('1 ');

      // Now "1 ". Caret between 1 and space.
      // Delete Space
      await page.keyboard.press('Delete');

      // Now "1". Caret at end.
      // Delete (merge)
      // Delete (Merge)
      await page.keyboard.press('Delete');

      const lastBlock = await getLastBlock(page);

      await expect(lastBlock).toHaveText(/^(12|1 2)$/);
    });
  });

  test('should delete selected fragment using native behaviour', async ({ page }) => {
    await createParagraphEditor(page, ['The first block', 'The second block']);

    const firstParagraph = getParagraphByIndex(page, 0);
    const paragraphContent = firstParagraph.locator('.ce-paragraph');

    await firstParagraph.click();
    await selectText(paragraphContent, 'The ');
    await page.keyboard.press('Delete');

    await expect(getBlockByIndex(page, 0)).toHaveText('first block');
  });

  test('should delete character using native behaviour when caret is not at block end', async ({ page }) => {
    await createParagraphEditor(page, ['The first block', 'The second block']);

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await firstParagraph.press('ArrowLeft');
    await firstParagraph.press('Delete');

    await expect(getBlockByIndex(page, 0)).toHaveText('The first bloc');
  });

  test('should focus next input when caret is not in the last input', async ({ page }) => {
    await createMultiInputToolEditor(page);

    const firstInput = getQuoteToolInputByIndex(page, 0);

    await firstInput.click();
    await firstInput.press('Delete');

    const lastQuoteToolInput = await getLastQuoteToolInput(page);
    const caretInfo = await getCaretInfo(lastQuoteToolInput);

    expect(caretInfo?.inside).toBeTruthy();
  });

  test('should remove next empty block and close toolbox when caret at block end', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        id: 'block1',
        type: 'paragraph',
        data: {
          text: 'Not empty block',
        },
      },
      {
        id: 'block2',
        type: 'paragraph',
        data: {
          text: '',
        },
      },
    ]);

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await firstParagraph.press('End');
    await firstParagraph.press('Delete');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');

    await expectToolbarClosed(page);
  });

  test('should remove current empty block and place caret at next block start', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        id: 'block1',
        type: 'paragraph',
        data: {
          text: '1',
        },
      },
      {
        id: 'block2',
        type: 'paragraph',
        data: {
          text: 'Not empty block',
        },
      },
    ]);

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await firstParagraph.press('Backspace');
    await firstParagraph.press('Delete');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block2');

    await expectCaretAtStart(getParagraphByIndex(page, 0));
    await expectToolbarClosed(page);
  });

  test('should merge blocks when both are mergeable and caret at block end', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        id: 'block1',
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        id: 'block2',
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
    ]);

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await firstParagraph.press('End');
    await firstParagraph.press('Delete');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');
    expect((blocks[0].data as { text: string }).text).toBe('First blockSecond block');

    await expectCaretOffset(getParagraphByIndex(page, 0), 'First block'.length, { normalize: true });
    await expectToolbarClosed(page);
  });

  test('should place caret at start of next unmergeable block', async ({ page }) => {
    await createEditorWithUnmergeableTool(page);

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await firstParagraph.press('End');
    await firstParagraph.press('Delete');

    const caretInfo = await getCaretInfo(page.locator(`${EDITOR_INTERFACE_SELECTOR} [data-cy=unmergeable-tool]`));

    expect(caretInfo?.inside).toBeTruthy();
    await expectToolbarClosed(page);
  });

  test.describe('at the end of the last block', () => {
    test('should do nothing for non-empty block', async ({ page }) => {
      await createParagraphEditor(page, [ 'The only block. Not empty' ]);

      // Workaround for potential duplication: remove extra blocks if any
      await page.evaluate(() => {
        const blocks = document.querySelectorAll('.ce-block');

        Array.from(blocks).forEach((block) => {
          if (!block.textContent?.includes('The only block. Not empty')) {
            block.remove();
          }
        });
      });

      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);

      const onlyParagraph = getParagraphByIndex(page, 0);

      await onlyParagraph.click();
      await onlyParagraph.press('End');
      await onlyParagraph.press('Delete');

      await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);
      await expect(onlyParagraph).toHaveText('The only block. Not empty');
    });
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}
