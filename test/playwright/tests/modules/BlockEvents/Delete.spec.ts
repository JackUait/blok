import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbar"]`;
const QUOTE_TOOL_INPUT_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="quote-tool"] div[contenteditable]`;

const getBlockByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${BLOCK_SELECTOR}, ${index + 1})`);
};

const getLastBlock = async (page: Page): Promise<Locator> => {
  const blockCount = await page.locator(BLOCK_SELECTOR).count();

  if (blockCount === 0) {
    throw new Error('No blocks found for selector: [data-blok-testid="block-wrapper"]');
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

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    // Clear any pending timeouts or async operations from previous instances
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    // Force garbage collection of any detached DOM nodes
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
    console.log('createBlokWithBlocks: blocks count', blokBlocks.length);
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

const createParagraphBlok = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createBlokWithBlocks(page, blocks);
};

const createMultiInputToolBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
    class ExampleOfToolWithSeveralInputs {
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

      public save(): Record<string, never> {
        return {};
      }
    }

    const blok = new window.Blok({
      holder: holder,
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

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const createBlokWithUnmergeableTool = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
    class ExampleOfUnmergeableTool {
      public render(): HTMLElement {
        const container = document.createElement('div');

        container.setAttribute('data-blok-testid', 'unmergeable-tool');
        container.contentEditable = 'true';
        container.innerHTML = 'Unmergeable not empty tool';

        return container;
      }

      public save(): Record<string, never> {
        return {};
      }
    }

    const blok = new window.Blok({
      holder: holder,
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

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance is not initialized');
    }

    return window.blokInstance.save();
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

  await expect(toolbar).not.toHaveAttribute('data-blok-opened', 'true');
};

test.describe('delete keydown', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    // Retry page navigation and Blok loading to handle race conditions
    // when multiple tests run in parallel and Vite's module resolution
    // can fail under concurrent load
    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        await page.goto(TEST_PAGE_URL);
        await page.waitForFunction(() => typeof window.Blok === 'function', { timeout: 10000 });
        break; // Success, exit retry loop
      } catch (error) {
        retries++;
        if (retries >= maxRetries) {
          throw error; // Rethrow after max retries
        }
        // Wait a bit before retry to let Vite settle
        await page.waitForTimeout(100);
      }
    }
  });

  test.describe('ending whitespaces handling', () => {
    test('should delete visible non-breaking space', async ({ page }) => {
      await createParagraphBlok(page, ['1\u00A0', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const paragraphContent = firstParagraph.locator('[contenteditable]');

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
      await createParagraphBlok(page, ['1 ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const paragraphContent = firstParagraph.locator('[contenteditable]');

      await firstParagraph.click();
      // Position caret after '1', before the trailing space
      await setCaret(paragraphContent, 0, 1);
      await firstParagraph.press('Delete');

      const lastBlock = await getLastBlock(page);

      await expect(lastBlock).toHaveText('1 2');
    });

    test('should ignore empty tags after caret when merging', async ({ page }) => {
      await createParagraphBlok(page, ['1<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);

      await firstParagraph.click();
      await firstParagraph.press('End');
      // At end with empty <b></b> tag, Delete should merge blocks
      await firstParagraph.press('Delete');

      const lastBlock = await getLastBlock(page);

      await expect(lastBlock).toHaveText('12');
    });

    test('should remove non-breaking space and ignore empty tag', async ({ page }) => {
      await createParagraphBlok(page, ['1\u00A0<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const paragraphContent = firstParagraph.locator('[contenteditable]');

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
      await createParagraphBlok(page, ['1<b></b>\u00A0', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const paragraphContent = firstParagraph.locator('[contenteditable]');

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
      await createParagraphBlok(page, ['1\u00A0 ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const paragraphContent = firstParagraph.locator('[contenteditable]');

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

      // Now "1". Caret at end. Delete to merge.
      await page.keyboard.press('Delete');

      const lastBlock = await getLastBlock(page);

      await expect(lastBlock).toHaveText(/^(12|1 2)$/);
    });
  });

  test('should delete selected fragment using native behaviour', async ({ page }) => {
    await createParagraphBlok(page, ['The first block', 'The second block']);

    const firstParagraph = getParagraphByIndex(page, 0);
    const paragraphContent = firstParagraph.locator('[contenteditable]');

    await firstParagraph.click();
    await selectText(paragraphContent, 'The ');
    await page.keyboard.press('Delete');

    await expect(getBlockByIndex(page, 0)).toHaveText('first block');
  });

  test('should delete character using native behaviour when caret is not at block end', async ({ page }) => {
    await createParagraphBlok(page, ['The first block', 'The second block']);

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await firstParagraph.press('ArrowLeft');
    await firstParagraph.press('Delete');

    await expect(getBlockByIndex(page, 0)).toHaveText('The first bloc');
  });

  test('should focus next input when caret is not in the last input', async ({ page }) => {
    await createMultiInputToolBlok(page);

    const firstInput = getQuoteToolInputByIndex(page, 0);

    await firstInput.click();
    await firstInput.press('Delete');

    const lastQuoteToolInput = await getLastQuoteToolInput(page);
    const caretInfo = await getCaretInfo(lastQuoteToolInput);

    expect(caretInfo?.inside).toBeTruthy();
  });

  test('should remove next empty block and close toolbox when caret at block end', async ({ page }) => {
    await createBlokWithBlocks(page, [
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

    const { blocks } = await saveBlok(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');

    await expectToolbarClosed(page);
  });

  test('should remove current empty block and place caret at next block start', async ({ page }) => {
    await createBlokWithBlocks(page, [
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

    const { blocks } = await saveBlok(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block2');

    await expectCaretAtStart(getParagraphByIndex(page, 0));
    await expectToolbarClosed(page);
  });

  test('should merge blocks when both are mergeable and caret at block end', async ({ page }) => {
    await createBlokWithBlocks(page, [
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

    const { blocks } = await saveBlok(page);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('block1');
    expect((blocks[0].data as { text: string }).text).toBe('First blockSecond block');

    await expectCaretOffset(getParagraphByIndex(page, 0), 'First block'.length, { normalize: true });
    await expectToolbarClosed(page);
  });

  test('should place caret at start of next unmergeable block', async ({ page }) => {
    await createBlokWithUnmergeableTool(page);

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await firstParagraph.press('End');
    await firstParagraph.press('Delete');

    const caretInfo = await getCaretInfo(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid=unmergeable-tool]`));

    expect(caretInfo?.inside).toBeTruthy();
    await expectToolbarClosed(page);
  });

  test.describe('at the end of the last block', () => {
    test('should do nothing for non-empty block', async ({ page }) => {
      await createParagraphBlok(page, [ 'The only block. Not empty' ]);

      // Workaround for potential duplication: remove extra blocks if any
      await page.evaluate(() => {
        const blocks = document.querySelectorAll('[data-blok-testid="block-wrapper"]');

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
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
