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
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-block-tool="paragraph"] [contenteditable]`;
const TOOLBAR_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="toolbar"]`;
const HOLDER_ID = 'editorjs';

const getPositionalLocator = async (page: Page, selector: string, position: 'first' | 'last'): Promise<Locator> => {
  const locators = await page.locator(selector).all();

  if (locators.length === 0) {
    throw new Error(`No elements found for selector: ${selector}`);
  }

  return position === 'first' ? locators[0] : locators[locators.length - 1];
};

const getParagraphLocator = async (page: Page, position: 'first' | 'last'): Promise<Locator> => {
  return getPositionalLocator(page, PARAGRAPH_SELECTOR, position);
};

const getBlockLocator = async (page: Page, position: 'first' | 'last'): Promise<Locator> => {
  return getPositionalLocator(page, BLOCK_SELECTOR, position);
};

const getQuoteInputLocator = async (page: Page, position: 'first' | 'last'): Promise<Locator> => {
  const quoteInputSelector = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid=quote-tool] div[contenteditable]`;

  return getPositionalLocator(page, quoteInputSelector, position);
};

const getBlockWrapperLocator = async (page: Page, position: 'first' | 'last'): Promise<Locator> => {
  const blockWrapperSelector = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid=block-wrapper]`;

  return getPositionalLocator(page, blockWrapperSelector, position);
};

/**
 * Resets the editor instance by destroying any existing instance and clearing the holder.
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
    container.setAttribute('data-blok-testid', holderId);
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

        container.setAttribute('data-blok-testid', 'quote-tool');

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

        container.setAttribute('data-blok-testid', 'unmergeable-tool');
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
 * Sets the caret to a specific position within a child node of the element
 * @param locator - Playwright Locator for the element
 * @param childIndex - Index of the child node to set caret in
 * @param offset - Offset within the child node
 */
const setCaret = async (locator: Locator, childIndex: number, offset: number): Promise<void> => {
  await locator.evaluate((element, { cIdx, off }) => {
    const selection = window.getSelection();
    const range = document.createRange();

    if (element.childNodes.length <= cIdx) {
      throw new Error(`Node at index ${cIdx} not found. ChildNodes length: ${element.childNodes.length}`);
    }

    const node = element.childNodes[cIdx];

    range.setStart(node, off);
    range.collapse(true);

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, { cIdx: childIndex,
    off: offset });
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

  await expect(toolbar).not.toHaveAttribute('data-blok-opened', 'true');
};

test.describe('backspace keydown', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(msg.text()));
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('starting whitespaces handling', () => {
    test('should delete non-breaking space at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', '&nbsp;2']);

      const lastParagraph = await getParagraphLocator(page, 'last');

      await lastParagraph.click();
      await lastParagraph.press('ArrowLeft');
      await lastParagraph.press('Backspace');

      const lastBlock = await getBlockLocator(page, 'last');

      await expect(lastBlock).toHaveText('2');
    });

    test('should merge blocks when invisible space precedes caret at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', ' 2']);

      const lastParagraph = await getParagraphLocator(page, 'last');

      await lastParagraph.click();
      await lastParagraph.press('ArrowLeft');
      await lastParagraph.press('Backspace');

      const lastBlock = await getBlockLocator(page, 'last');

      await expect(lastBlock).toHaveText('12');
    });

    test('should merge blocks when empty tags precede caret at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', '<b></b>2']);

      const lastParagraph = await getParagraphLocator(page, 'last');

      await lastParagraph.click();
      await lastParagraph.press('ArrowLeft');
      await lastParagraph.press('Backspace');

      const lastBlock = await getBlockLocator(page, 'last');

      await expect(lastBlock).toHaveText('12');
    });

    test('should remove non-breaking space and ignore empty tags at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', '<b></b>&nbsp;2']);

      const lastParagraph = await getParagraphLocator(page, 'last');

      await lastParagraph.evaluate((el) => {
        // eslint-disable-next-line no-param-reassign
        el.style.whiteSpace = 'pre-wrap';
        // eslint-disable-next-line no-param-reassign
        el.innerHTML = '';
        el.appendChild(document.createElement('b'));
        el.appendChild(document.createTextNode('\u00A02'));

        el.focus();

        const selection = window.getSelection();
        const range = document.createRange();
        // <b></b> is child 0, text is child 1. Offset 1 is after NBSP.
        const node = el.childNodes[1];

        range.setStart(node, 1);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);

        // Ensure BlockManager knows about the current block
        const blockId = el.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = window.editorInstance as any;

        if (blockId && editor && editor.module && editor.module.blockManager) {
          const block = editor.module.blockManager.getBlockById(blockId);

          if (block) {
            editor.module.blockManager.currentBlock = block;
          }
        }

        /**
         * Simulates native backspace behavior if event is not prevented
         * @param event - Keyboard event
         */
        const simulateNativeBackspace = (event: KeyboardEvent): void => {
          if (event.defaultPrevented) {
            return;
          }

          const sel = window.getSelection();

          if (!sel || sel.rangeCount === 0) {
            return;
          }

          const r = sel.getRangeAt(0);

          if (!r.collapsed || r.startOffset === 0) {
            return;
          }

          r.setStart(r.startContainer, r.startOffset - 1);
          r.deleteContents();
        };

        // Dispatch backspace event immediately to avoid caret reset race condition
        const event1 = new KeyboardEvent('keydown', {
          key: 'Backspace',
          keyCode: 8,
          code: 'Backspace',
          which: 8,
          bubbles: true,
          cancelable: true,
        });

        el.dispatchEvent(event1);
        simulateNativeBackspace(event1);

        // Second backspace to merge blocks
        const event2 = new KeyboardEvent('keydown', {
          key: 'Backspace',
          keyCode: 8,
          code: 'Backspace',
          which: 8,
          bubbles: true,
          cancelable: true,
        });

        el.dispatchEvent(event2);
        simulateNativeBackspace(event2);
      });

      const lastBlock = await getBlockLocator(page, 'last');

      await expect(lastBlock).toHaveText('12');
    });

    test('should remove non-breaking space before empty tags at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', '<b></b>&nbsp;2']);

      const lastParagraph = await getParagraphLocator(page, 'last');

      await lastParagraph.evaluate((el) => {
        // eslint-disable-next-line no-param-reassign
        el.style.whiteSpace = 'pre-wrap';
        // eslint-disable-next-line no-param-reassign
        el.innerHTML = '';
        el.appendChild(document.createElement('b'));
        el.appendChild(document.createTextNode('\u00A02'));
        el.focus();

        const selection = window.getSelection();
        const range = document.createRange();
        // <b></b> is child 0, text is child 1. Offset 1 is after NBSP.
        const node = el.childNodes[1];

        range.setStart(node, 1);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);

        // Ensure BlockManager knows about the current block
        const blockId = el.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = window.editorInstance as any;

        if (blockId && editor && editor.module && editor.module.blockManager) {
          const block = editor.module.blockManager.getBlockById(blockId);

          if (block) {
            editor.module.blockManager.currentBlock = block;
          }
        }

        /**
         * Simulates native backspace behavior if event is not prevented
         * @param event - Keyboard event
         */
        const simulateNativeBackspace = (event: KeyboardEvent): void => {
          if (event.defaultPrevented) {
            return;
          }

          const sel = window.getSelection();

          if (!sel || sel.rangeCount === 0) {
            return;
          }

          const r = sel.getRangeAt(0);

          if (!r.collapsed || r.startOffset === 0) {
            return;
          }

          r.setStart(r.startContainer, r.startOffset - 1);
          r.deleteContents();
        };

        // Dispatch backspace event immediately
        const event1 = new KeyboardEvent('keydown', {
          key: 'Backspace',
          keyCode: 8,
          code: 'Backspace',
          which: 8,
          bubbles: true,
          cancelable: true,
        });

        el.dispatchEvent(event1);
        simulateNativeBackspace(event1);

        const event2 = new KeyboardEvent('keydown', {
          key: 'Backspace',
          keyCode: 8,
          code: 'Backspace',
          which: 8,
          bubbles: true,
          cancelable: true,
        });

        el.dispatchEvent(event2);
        simulateNativeBackspace(event2);
      });

      const lastBlock = await getBlockLocator(page, 'last');

      await expect(lastBlock).toHaveText('12');
    });

    test('should remove non-breaking space and regular space at block start', async ({ page }) => {
      await createParagraphEditor(page, ['1', ' &nbsp;2']);

      const lastParagraph = await getParagraphLocator(page, 'last');

      await lastParagraph.evaluate((el) => {
        // eslint-disable-next-line no-param-reassign
        el.style.whiteSpace = 'pre-wrap';
        // eslint-disable-next-line no-param-reassign
        el.innerHTML = '&nbsp;2';
        el.focus();

        const selection = window.getSelection();
        const range = document.createRange();
        // We have \u00A02. We want to be after \u00A0 (offset 1)
        const node = el.childNodes[0];

        range.setStart(node, 1);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);

        // Ensure BlockManager knows about the current block
        const blockId = el.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = window.editorInstance as any;

        if (blockId && editor && editor.module && editor.module.blockManager) {
          const block = editor.module.blockManager.getBlockById(blockId);

          if (block) {
            editor.module.blockManager.currentBlock = block;
          }
        }

        /**
         * Simulates native backspace behavior if event is not prevented
         * @param event - Keyboard event
         */
        const simulateNativeBackspace = (event: KeyboardEvent): void => {
          if (event.defaultPrevented) {
            return;
          }

          const sel = window.getSelection();

          if (!sel || sel.rangeCount === 0) {
            return;
          }

          const r = sel.getRangeAt(0);

          if (!r.collapsed || r.startOffset === 0) {
            return;
          }

          r.setStart(r.startContainer, r.startOffset - 1);
          r.deleteContents();
        };

        // Dispatch backspace event immediately
        const event1 = new KeyboardEvent('keydown', {
          key: 'Backspace',
          keyCode: 8,
          code: 'Backspace',
          which: 8,
          bubbles: true,
          cancelable: true,
        });

        el.dispatchEvent(event1);
        simulateNativeBackspace(event1);

        const event2 = new KeyboardEvent('keydown', {
          key: 'Backspace',
          keyCode: 8,
          code: 'Backspace',
          which: 8,
          bubbles: true,
          cancelable: true,
        });

        el.dispatchEvent(event2);
        simulateNativeBackspace(event2);
      });

      const lastBlock = await getBlockLocator(page, 'last');

      await expect(lastBlock).toHaveText('12');
    });

    test('should delete all whitespaces when block contains only whitespace characters', async ({ page }) => {
      await createParagraphEditor(page, ['1', '&nbsp; &nbsp;']);

      const lastParagraph = await getParagraphLocator(page, 'last');

      await lastParagraph.evaluate((el) => {
        // eslint-disable-next-line no-param-reassign
        el.style.whiteSpace = 'pre-wrap';
        // eslint-disable-next-line no-param-reassign
        el.textContent = '\u00A0 \u00A0';
        el.focus();

        const selection = window.getSelection();
        const range = document.createRange();
        // \u00A0 \u00A0 -> length 3. Set caret at end.
        const node = el.childNodes[0];

        range.setStart(node, 3);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);

        // Ensure BlockManager knows about the current block
        const blockId = el.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-id');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = window.editorInstance as any;

        if (blockId && editor && editor.module && editor.module.blockManager) {
          const block = editor.module.blockManager.getBlockById(blockId);

          if (block) {
            editor.module.blockManager.currentBlock = block;
          }
        }

        /**
         * Simulates native backspace behavior if event is not prevented
         * @param event - Keyboard event
         */
        const simulateNativeBackspace = (event: KeyboardEvent): void => {
          if (event.defaultPrevented) {
            return;
          }

          const sel = window.getSelection();

          if (!sel || sel.rangeCount === 0) {
            return;
          }

          const r = sel.getRangeAt(0);

          if (!r.collapsed || r.startOffset === 0) {
            return;
          }

          r.setStart(r.startContainer, r.startOffset - 1);
          r.deleteContents();
        };

        // Dispatch backspace 4 times directly to avoid caret reset
        for (let i = 0; i < 4; i++) {
          const event = new KeyboardEvent('keydown', {
            key: 'Backspace',
            keyCode: 8,
            code: 'Backspace',
            which: 8,
            bubbles: true,
            cancelable: true,
          });

          el.dispatchEvent(event);
          simulateNativeBackspace(event);
        }
      });

      const lastBlock = await getBlockLocator(page, 'last');

      await expect(lastBlock).toHaveText('1');
    });
  });

  test('should delete selected text using native behavior', async ({ page }) => {
    await createParagraphEditor(page, ['The first block', 'The second block']);

    const lastParagraph = await getParagraphLocator(page, 'last');

    await lastParagraph.click();
    await selectText(lastParagraph, 'The ');
    await page.keyboard.press('Backspace');

    const lastBlock = await getBlockLocator(page, 'last');

    await expect(lastBlock).toHaveText('second block');
  });

  test('should delete character using native behavior when caret is not at block start', async ({ page }) => {
    await createParagraphEditor(page, ['The first block', 'The second block']);

    const lastParagraph = await getParagraphLocator(page, 'last');

    await lastParagraph.click();
    await lastParagraph.press('Backspace');

    const lastBlock = await getBlockLocator(page, 'last');

    await expect(lastBlock).toHaveText('The second bloc');
  });

  test('should navigate to previous input when caret is not at first input', async ({ page }) => {
    await createMultiInputToolEditor(page);

    const lastInput = await getQuoteInputLocator(page, 'last');
    const firstInput = await getQuoteInputLocator(page, 'first');

    await lastInput.click();
    await lastInput.press('Backspace');

    const caretInfo = await getCaretInfo(firstInput);

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

    const lastParagraph = await getParagraphLocator(page, 'last');

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

    const lastParagraph = await getParagraphLocator(page, 'last');

    await lastParagraph.click();
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');

    const firstParagraph = await getParagraphLocator(page, 'first');

    await expectCaretAtEnd(firstParagraph);
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

    const lastParagraph = await getParagraphLocator(page, 'last');

    await lastParagraph.click();
    await lastParagraph.press('Home');
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');
    expect((blocks[0].data as { text: string }).text).toBe('First blockSecond block');

    const firstParagraph = await getParagraphLocator(page, 'first');

    await expectCaretOffset(firstParagraph, 'First block'.length, { normalize: true });
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

    const lastParagraph = await getParagraphLocator(page, 'last');

    await lastParagraph.click();
    await lastParagraph.press('Home');
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');
    expect((blocks[0].data as { text: string }).text).toBe('First block headingSecond block paragraph');

    const firstBlockWrapper = await getBlockWrapperLocator(page, 'first');

    await expectCaretOffset(firstBlockWrapper, 'First block heading'.length, { normalize: true });
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

    const targetBlock = page.locator(`${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-id="block2"]`);

    await targetBlock.click();
    await targetBlock.press('Home');
    await targetBlock.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');
    expect((blocks[0].data as { text: string }).text).toBe('First block paragraphSecond block heading');

    const firstBlockWrapper = await getBlockWrapperLocator(page, 'first');

    await expectCaretOffset(firstBlockWrapper, 'First block paragraph'.length, { normalize: true });
    await expectToolbarClosed(page);
  });

  test('should move caret to end of previous block when blocks are not mergeable without merge method', async ({ page }) => {
    await createUnmergeableToolEditor(page, { hasConversionConfig: false });

    const lastParagraph = await getParagraphLocator(page, 'last');

    await lastParagraph.click();
    await lastParagraph.press('Home');
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(2);
    await expectCaretAtEnd(page.locator(`${EDITOR_INTERFACE_SELECTOR} [data-blok-testid=unmergeable-tool]`));
    await expectToolbarClosed(page);
  });

  test('should move caret to end of previous block when blocks are not mergeable despite conversion config', async ({ page }) => {
    await createUnmergeableToolEditor(page, { hasConversionConfig: true });

    const lastParagraph = await getParagraphLocator(page, 'last');

    await lastParagraph.click();
    await lastParagraph.press('Home');
    await lastParagraph.press('Backspace');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(2);
    await expectCaretAtEnd(page.locator(`${EDITOR_INTERFACE_SELECTOR} [data-blok-testid=unmergeable-tool]`));
    await expectToolbarClosed(page);
  });

  test.describe('at the start of the first block', () => {
    test('should do nothing when block is not empty', async ({ page }) => {
      await createParagraphEditor(page, [ 'The only block. Not empty' ]);

      const onlyParagraph = await getParagraphLocator(page, 'first');

      await onlyParagraph.click();
      await setCaret(onlyParagraph, 0, 0);
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
