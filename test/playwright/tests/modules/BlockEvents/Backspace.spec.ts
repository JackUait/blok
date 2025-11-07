import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '../../../../../types';
import type { OutputData } from '../../../../../types';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../../cypress/fixtures/test.html')
).href;
const EDITOR_SELECTOR = '[data-cy=editorjs]';
const BLOCK_SELECTOR = `${EDITOR_SELECTOR} div.ce-block`;
const PARAGRAPH_SELECTOR = `${EDITOR_SELECTOR} .ce-paragraph`;
const TOOLBAR_SELECTOR = `${EDITOR_SELECTOR} .ce-toolbar`;
const HOLDER_ID = 'editorjs';

/**
 * Resets the editor instance by destroying any existing instance and clearing the holder.
 *
 * @param page - The Playwright Page object to interact with the browser.
 */
const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.cy = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

/**
 *
 * @param page - Playwright Page instance
 * @param blocks - Array of block data to initialize the editor with
 */
const createEditorWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId, blocks: editorBlocks }) => {
    const editor = new window.EditorJS({
      holder: holderId,
      data: { blocks: editorBlocks },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID,
    blocks });
};

/**
 *
 * @param page - The Playwright page object
 * @param textBlocks - Array of text strings to create paragraph blocks from
 */
const createParagraphEditor = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createEditorWithBlocks(page, blocks);
};


/**
 *
 * @param page - Playwright Page instance
 * @param blocks - Array of block data to initialize the editor with
 */
const createEditorWithSimpleHeader = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId, blocks: editorBlocks }) => {
    /**
     *
     */
    class SimpleHeader {
      private data: { text: string };
      private element: HTMLHeadingElement | null = null;

      /**
       *
       * @param root0 - Constructor parameter object
       * @param root0.data - Initial data for the header
       */
      constructor({ data }: { data: { text: string } }) {
        this.data = data;
      }

      /**
       *
       */
      public render(): HTMLHeadingElement {
        this.element = document.createElement('h1');
        this.element.contentEditable = 'true';
        this.element.innerHTML = this.data.text;

        return this.element;
      }

      /**
       *
       * @param data - Data object containing text to merge
       */
      public merge(data: { text: string }): void {
        this.element?.insertAdjacentHTML('beforeend', data.text);
      }

      /**
       *
       * @param element - The HTML heading element to save
       */
      public save(element: HTMLHeadingElement): { text: string; level: number } {
        return {
          text: element.innerHTML,
          level: 1,
        };
      }

      /**
       *
       */
      public static get conversionConfig(): { export: string; import: string } {
        return {
          export: 'text',
          import: 'text',
        };
      }
    }

    const editor = new window.EditorJS({
      holder: holderId,
      tools: {
        header: SimpleHeader,
      },
      data: { blocks: editorBlocks },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID,
    blocks });
};

/**
 *
 * @param page - Playwright Page instance
 */
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

/**
 *
 * @param page - Playwright Page instance
 * @param options - Configuration options
 * @param options.hasConversionConfig - Whether the tool has a conversion config
 */
const createUnmergeableToolEditor = async (page: Page, options: { hasConversionConfig: boolean }): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId, hasConversionConfig }) => {
    /**
     *
     */
    class UnmergeableTool {
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
      public save(): Record<string, string> {
        return hasConversionConfig ? { key: 'value' } : {};
      }

      /**
       *
       */
      public static get conversionConfig(): { export: string; import: string } | undefined {
        if (!hasConversionConfig) {
          return undefined;
        }

        return {
          export: 'key',
          import: 'key',
        };
      }
    }

    const editor = new window.EditorJS({
      holder: holderId,
      tools: {
        code: UnmergeableTool,
      },
      data: {
        blocks: [
          {
            type: 'code',
            data: {},
          },
          {
            type: 'paragraph',
            data: {
              text: 'Second block',
            },
          },
        ],
      },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID,
    hasConversionConfig: options.hasConversionConfig });
};

/**
 *
 * @param page - Playwright Page instance
 */
const saveEditor = async (page: Page): Promise<OutputData> => {
  return page.evaluate(async () => {
    if (!window.editorInstance) {
      throw new Error('Editor instance is not initialized');
    }

    return window.editorInstance.save();
  });
};

/**
 *
 * @param locator - Playwright Locator for the element
 * @param text - Text to select within the element
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const textNode = element.firstChild;

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Element does not contain a text node');
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

/**
 *
 * @param locator - Playwright Locator for the element
 * @param options - Options for caret info retrieval
 * @param options.normalize - Whether to normalize the range before getting caret info
 */
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

/**
 *
 * @param locator - Playwright Locator for the element
 */
const expectCaretAtEnd = async (locator: Locator): Promise<void> => {
  const caretInfo = await getCaretInfo(locator);

  expect(caretInfo?.inside).toBeTruthy();
  expect(caretInfo?.offset).toBe(caretInfo?.textLength);
};

/**
 *
 * @param locator - Playwright Locator for the element
 * @param expectedOffset - Expected caret offset position
 * @param options - Options for caret offset check
 * @param options.normalize - Whether to normalize the range before checking offset
 */
const expectCaretOffset = async (locator: Locator, expectedOffset: number, options?: { normalize?: boolean }): Promise<void> => {
  const caretInfo = await getCaretInfo(locator, options);

  expect(caretInfo?.inside).toBeTruthy();
  expect(caretInfo?.offset).toBe(expectedOffset);
};

/**
 *
 * @param page - Playwright Page instance
 */
const expectToolbarClosed = async (page: Page): Promise<void> => {
  const toolbar = page.locator(TOOLBAR_SELECTOR);

  await expect(toolbar).not.toHaveClass(/ce-toolbar--opened/);
};

test.describe('Backspace keydown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('starting whitespaces handling', () => {
    test('should delete non-breaking space at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', '&nbsp;2']);

      const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

      await lastParagraph.click();
      await lastParagraph.press('ArrowLeft');
      await lastParagraph.press('Backspace');

      await expect(page.locator(BLOCK_SELECTOR).last()).toHaveText('2');
    });

    test('should merge blocks when invisible space precedes caret at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', ' 2']);

      const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

      await lastParagraph.click();
      await lastParagraph.press('ArrowLeft');
      await lastParagraph.press('Backspace');

      await expect(page.locator(BLOCK_SELECTOR).last()).toHaveText('12');
    });

    test('should merge blocks when empty tags precede caret at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', '<b></b>2']);

      const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

      await lastParagraph.click();
      await lastParagraph.press('ArrowLeft');
      await lastParagraph.press('Backspace');

      await expect(page.locator(BLOCK_SELECTOR).last()).toHaveText('12');
    });

    test('should remove non-breaking space and ignore empty tags at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', '<b></b>&nbsp;2']);

      const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

      await lastParagraph.click();
      await lastParagraph.press('ArrowLeft');
      await lastParagraph.press('Backspace');
      await lastParagraph.press('Backspace');

      await expect(page.locator(BLOCK_SELECTOR).last()).toHaveText('12');
    });

    test('should remove non-breaking space before empty tags at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', '<b></b>&nbsp;2']);

      const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

      await lastParagraph.click();
      await lastParagraph.press('ArrowLeft');
      await lastParagraph.press('Backspace');
      await lastParagraph.press('Backspace');

      await expect(page.locator(BLOCK_SELECTOR).last()).toHaveText('12');
    });

    test('should remove non-breaking space and regular space at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', ' &nbsp;2']);

      const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

      await lastParagraph.click();
      await lastParagraph.press('ArrowLeft');
      await lastParagraph.press('Backspace');
      await lastParagraph.press('Backspace');

      await expect(page.locator(BLOCK_SELECTOR).last()).toHaveText('12');
    });

    test('should delete all whitespaces when block contains only whitespace characters', async ({ page }) => {
      await createParagraphEditor(page, ['1', '&nbsp; &nbsp;']);

      const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

      await lastParagraph.click();
      await lastParagraph.press('ArrowDown');
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press('Backspace');
      }

      await expect(page.locator(BLOCK_SELECTOR).last()).toHaveText('1');
    });
  });

  test('should delete selected text using native behavior', async ({ page }) => {
    await createParagraphEditor(page, ['The first block', 'The second block']);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await lastParagraph.click();
    await selectText(lastParagraph, 'The ');
    await page.keyboard.press('Backspace');

    await expect(page.locator(BLOCK_SELECTOR).last()).toHaveText('second block');
  });

  test('should delete character using native behavior when caret is not at block start', async ({ page }) => {
    await createParagraphEditor(page, ['The first block', 'The second block']);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await lastParagraph.click();
    await lastParagraph.press('Backspace');

    await expect(page.locator(BLOCK_SELECTOR).last()).toHaveText('The second bloc');
  });

  test('should navigate to previous input when caret is not at first input', async ({ page }) => {
    await createMultiInputToolEditor(page);

    const inputs = page.locator(`${EDITOR_SELECTOR} [data-cy=quote-tool] div[contenteditable]`);
    const lastInput = inputs.last();

    await lastInput.click();
    await lastInput.press('Backspace');

    const caretInfo = await getCaretInfo(inputs.first());

    expect(caretInfo?.inside).toBeTruthy();
  });

  test('should remove previous empty block and close toolbar when caret is at block start', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        id: 'block1',
        type: 'paragraph',
        data: { text: '' },
      },
      {
        id: 'block2',
        type: 'paragraph',
        data: { text: 'Not empty block' },
      },
    ]);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await lastParagraph.click();
    await lastParagraph.press('Home');
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block2');
  });

  test('should remove current empty block and place caret at end of previous block', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        id: 'block1',
        type: 'paragraph',
        data: { text: 'Not empty block' },
      },
      {
        id: 'block2',
        type: 'paragraph',
        data: { text: '' },
      },
    ]);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await lastParagraph.click();
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');

    await expectCaretAtEnd(page.locator(PARAGRAPH_SELECTOR).first());
    await expectToolbarClosed(page);
  });

  test('should merge mergeable blocks and place caret at merge point when caret is at block start', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        id: 'block1',
        type: 'paragraph',
        data: { text: 'First block' },
      },
      {
        id: 'block2',
        type: 'paragraph',
        data: { text: 'Second block' },
      },
    ]);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await lastParagraph.click();
    await lastParagraph.press('Home');
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');
    expect((blocks[0].data as { text: string }).text).toBe('First blockSecond block');

    await expectCaretOffset(page.locator(PARAGRAPH_SELECTOR).first(), 'First block'.length, { normalize: true });
    await expectToolbarClosed(page);
  });

  test('should merge paragraph into header when conversion config is valid', async ({ page }) => {
    await createEditorWithSimpleHeader(page, [
      {
        id: 'block1',
        type: 'header',
        data: { text: 'First block heading' },
      },
      {
        id: 'block2',
        type: 'paragraph',
        data: { text: 'Second block paragraph' },
      },
    ]);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await lastParagraph.click();
    await lastParagraph.press('Home');
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');
    expect((blocks[0].data as { text: string }).text).toBe('First block headingSecond block paragraph');

    await expectCaretOffset(page.locator(`${EDITOR_SELECTOR} [data-cy=block-wrapper]`).first(), 'First block heading'.length, { normalize: true });
    await expectToolbarClosed(page);
  });

  test('should merge header into paragraph when conversion config is valid', async ({ page }) => {
    await createEditorWithSimpleHeader(page, [
      {
        id: 'block1',
        type: 'paragraph',
        data: { text: 'First block paragraph' },
      },
      {
        id: 'block2',
        type: 'header',
        data: { text: 'Second block heading' },
      },
    ]);

    const targetBlock = page.locator(`${EDITOR_SELECTOR} [data-cy="block-wrapper"][data-id="block2"]`);

    await targetBlock.click();
    await targetBlock.press('Home');
    await targetBlock.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');
    expect((blocks[0].data as { text: string }).text).toBe('First block paragraphSecond block heading');

    await expectCaretOffset(page.locator(`${EDITOR_SELECTOR} [data-cy=block-wrapper]`).first(), 'First block paragraph'.length, { normalize: true });
    await expectToolbarClosed(page);
  });

  test('should move caret to end of previous block when blocks are not mergeable without merge method', async ({ page }) => {
    await createUnmergeableToolEditor(page, { hasConversionConfig: false });

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await lastParagraph.click();
    await lastParagraph.press('Home');
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(2);
    await expectCaretAtEnd(page.locator(`${EDITOR_SELECTOR} [data-cy=unmergeable-tool]`));
    await expectToolbarClosed(page);
  });

  test('should move caret to end of previous block when blocks are not mergeable despite conversion config', async ({ page }) => {
    await createUnmergeableToolEditor(page, { hasConversionConfig: true });

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await lastParagraph.click();
    await lastParagraph.press('Home');
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(2);
    await expectCaretAtEnd(page.locator(`${EDITOR_SELECTOR} [data-cy=unmergeable-tool]`));
    await expectToolbarClosed(page);
  });

  test.describe('at the start of the first block', () => {
    test('should do nothing when block is not empty', async ({ page }) => {
      await createParagraphEditor(page, [ 'The only block. Not empty' ]);

      const onlyParagraph = page.locator(PARAGRAPH_SELECTOR).first();

      await onlyParagraph.click();
      await onlyParagraph.press('Home');
      await onlyParagraph.press('Backspace');

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
