import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
const UNDO_SHORTCUT = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const FAKE_BACKGROUND_SELECTOR = '[data-blok-testid="fake-background"]';

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ToolDefinition = {
  name: string;
  classSource?: string;
  config?: Record<string, unknown>;
};

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
  }, {
    holder: HOLDER_ID,
  });
};

const createBlokWithBlocks = async (
  page: Page,
  blocks: OutputData['blocks'],
  tools: ToolDefinition[] = []
): Promise<void> => {
  // BlokWithDefaults already provides paragraph with preserveBlank: true,
  // so we don't need to add it here. Only pass through custom tools.
  const serializedTools: ToolDefinition[] = tools;

  await resetBlok(page);
  await page.evaluate(async ({
    holder,
    blocks: blokBlocks,
    serializedTools: toolConfigs,
  }: {
    holder: string;
    blocks: OutputData['blocks'];
    serializedTools: ToolDefinition[];
  }) => {
    const reviveToolClass = (classSource: string): unknown => {
      return new Function(`return (${classSource});`)();
    };

    const revivedTools = toolConfigs.reduce<Record<string, unknown>>((accumulator, toolConfig) => {
      if (toolConfig.classSource) {
        const revivedClass = reviveToolClass(toolConfig.classSource);

        return {
          ...accumulator,
          [toolConfig.name]: toolConfig.config
            ? {
              ...toolConfig.config,
              class: revivedClass,
            }
            : revivedClass,
        };
      }

      if (toolConfig.config) {
        return {
          ...accumulator,
          [toolConfig.name]: toolConfig.config,
        };
      }

      return accumulator;
    }, {});

    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
      ...(toolConfigs.length > 0 ? { tools: revivedTools } : {}),
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    blocks,
    serializedTools,
  });
};

const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let startNode: Text | null = null;
    let startOffset = -1;

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const content = node.textContent ?? '';
      const index = content.indexOf(targetText);

      if (index !== -1) {
        startNode = node;
        startOffset = index;
        break;
      }
    }

    if (!startNode || startOffset === -1) {
      throw new Error(`Text "${targetText}" not found inside locator`);
    }

    const range = element.ownerDocument.createRange();

    range.setStart(startNode, startOffset);
    range.setEnd(startNode, startOffset + targetText.length);

    const selection = element.ownerDocument.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  }, text);
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

const StaticBlockTool = class {
  private data: { text?: string };

  /**
   * @param options - static block options
   */
  constructor({ data }: { data?: { text?: string } }) {
    this.data = data ?? {};
  }

  /**
   * Toolbox metadata for static block
   */
  public static get toolbox(): { title: string } {
    return {
      title: 'Static block',
    };
  }

  /**
   * Renders static block content wrapper
   */
  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.textContent = this.data.text ?? 'Static block without inputs';
    wrapper.contentEditable = 'false';

    return wrapper;
  }

  /**
   * Serializes static block DOM into data
   * @param element - block root element
   */
  public save(element: HTMLElement): { text: string } {
    return {
      text: element.textContent ?? '',
    };
  }
};

const EditableTitleTool = class {
  private data: { text?: string };

  /**
   * @param options - editable title options
   */
  constructor({ data }: { data?: { text?: string } }) {
    this.data = data ?? {};
  }

  /**
   * Toolbox metadata for editable title block
   */
  public static get toolbox(): { title: string } {
    return {
      title: 'Editable title',
    };
  }

  /**
   * Renders editable title block wrapper
   */
  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.contentEditable = 'true';
    wrapper.setAttribute('data-blok-testid', 'editable-title-block');
    wrapper.textContent = this.data.text ?? 'Editable block';

    return wrapper;
  }

  /**
   * Serializes editable title DOM into data
   * @param element - block root element
   */
  public save(element: HTMLElement): { text: string } {
    return {
      text: element.textContent ?? '',
    };
  }
};

const STATIC_BLOCK_TOOL_SOURCE = StaticBlockTool.toString();
const EDITABLE_TITLE_TOOL_SOURCE = EditableTitleTool.toString();

const getRequiredBoundingBox = async (locator: Locator): Promise<BoundingBox> => {
  const box = await locator.boundingBox();

  if (!box) {
    throw new Error('Unable to determine element bounds for drag operation');
  }

  return box;
};

const getElementCenter = async (locator: Locator): Promise<{ x: number; y: number }> => {
  const box = await getRequiredBoundingBox(locator);

  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
};

test.describe('modules/selection', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('selects all blocks via CMD/CTRL + A', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Third block',
        },
      },
    ]);

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await page.keyboard.press(SELECT_ALL_SHORTCUT);

    const blocks = page.locator(BLOCK_WRAPPER_SELECTOR);

    await expect(blocks).toHaveCount(3);

    for (const index of [0, 1, 2]) {
      await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
    }
  });

  test('cross-block selection selects contiguous blocks when dragging across content', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Third block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Fourth block',
        },
      },
    ]);

    const firstParagraph = getParagraphByIndex(page, 0);
    const thirdParagraph = getParagraphByIndex(page, 2);

    const firstCenter = await getElementCenter(firstParagraph);
    const thirdCenter = await getElementCenter(thirdParagraph);

    await page.mouse.move(firstCenter.x, firstCenter.y);
    await page.mouse.down();
    await page.mouse.move(thirdCenter.x, thirdCenter.y, { steps: 10 });
    await page.mouse.up();

    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 3)).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('selection API exposes save/restore, expandToTag, fake background helpers', async ({ page }) => {
    const text = 'Important <strong>bold</strong> text inside paragraph';

    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text,
        },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);

    await selectText(paragraph, 'bold');

    const paragraphText = (await paragraph.innerText()).trim();

    const apiResults = await page.evaluate(({ fakeBackgroundSelector }) => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance is not ready');
      }

      const selection = window.getSelection();

      const savedText = selection?.toString() ?? '';

      blok.selection.save();

      selection?.removeAllRanges();

      const paragraphEl = document.querySelector('[data-blok-testid="block-wrapper"] [contenteditable]');
      const textNode = paragraphEl?.firstChild as Text | null;

      if (textNode) {
        const range = document.createRange();

        range.setStart(textNode, textNode.textContent?.length ?? 0);
        range.collapse(true);
        selection?.addRange(range);
      }

      blok.selection.restore();

      const restored = window.getSelection()?.toString() ?? '';
      const strongTag = blok.selection.findParentTag('STRONG');

      if (paragraphEl instanceof HTMLElement) {
        blok.selection.expandToTag(paragraphEl);
      }

      const expanded = window.getSelection()?.toString() ?? '';

      blok.selection.setFakeBackground();
      const fakeWrappersCount = document.querySelectorAll(fakeBackgroundSelector).length;

      blok.selection.removeFakeBackground();
      const fakeWrappersAfterRemoval = document.querySelectorAll(fakeBackgroundSelector).length;

      return {
        savedText,
        restored,
        strongTag: strongTag?.tagName ?? null,
        expanded,
        fakeWrappersCount,
        fakeWrappersAfterRemoval,
      };
    }, { fakeBackgroundSelector: FAKE_BACKGROUND_SELECTOR });

    expect(apiResults.savedText).toBe('bold');
    expect(apiResults.restored).toBe('bold');
    expect(apiResults.strongTag).toBe('STRONG');
    expect(apiResults.expanded.trim()).toBe(paragraphText);
    expect(apiResults.fakeWrappersCount).toBeGreaterThan(0);
    expect(apiResults.fakeWrappersAfterRemoval).toBe(0);
  });

  test('cross-block selection deletes multiple blocks with Backspace', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Third block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Fourth block',
        },
      },
    ]);

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await placeCaretAtEnd(firstParagraph);
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');

    await page.keyboard.up('Shift');
    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');

    await page.keyboard.press('Backspace');

    const blocks = page.locator(BLOCK_WRAPPER_SELECTOR);

    await expect(blocks).toHaveCount(2);

    const savedData = await page.evaluate<OutputData>(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance is not ready');
      }

      return blok.save();
    });

    expect(savedData.blocks).toHaveLength(2);

    const blockTexts = savedData.blocks.map((block) => {
      return (block.data as { text?: string }).text ?? '';
    });

    expect(blockTexts[0].trim()).toBe('');
    expect(blockTexts[1]).toBe('Fourth block');
  });

  test('cross-block selection spans different block types with shift navigation', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Paragraph content',
          },
        },
        {
          type: 'static-block',
          data: {
            text: 'Static content',
          },
        },
        {
          type: 'editable-title',
          data: {
            text: 'Editable tail',
          },
        },
      ],
      [
        {
          name: 'static-block',
          classSource: STATIC_BLOCK_TOOL_SOURCE,
        },
        {
          name: 'editable-title',
          classSource: EDITABLE_TITLE_TOOL_SOURCE,
        },
      ]
    );

    const firstParagraph = getParagraphByIndex(page, 0);

    await firstParagraph.click();
    await placeCaretAtEnd(firstParagraph);

    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Shift');

    for (const index of [0, 1, 2]) {
      await expect(getBlockByIndex(page, index)).toHaveAttribute('data-blok-selected', 'true');
    }
  });

  test('fake background is cleared after undo following block conversion', async ({ page }) => {
    /**
     * Regression test: When a user converts a block via the inline toolbar
     * (which uses fake background to preserve selection visual) and then
     * undoes the conversion, fake background spans should not persist in the DOM.
     */
    const HISTORY_DEBOUNCE_WAIT = 300;
    const STATE_CHANGE_WAIT = 200;

    const waitForDelay = async (delayMs: number): Promise<void> => {
      await page.evaluate(
        async (timeout) => {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, timeout);
          });
        },
        delayMs
      );
    };

    await page.evaluate(async ({ holder }) => {
      // Ensure clean state
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

      // Access Header from window.Blok global
      const BlokClass = window.Blok as unknown as {
        Header: unknown;
        new (config: Record<string, unknown>): typeof window.blokInstance;
      };

      const blok = new BlokClass({
        holder,
        autofocus: true,
        tools: {
          header: BlokClass.Header,
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Some important text here' },
            },
          ],
        },
      });

      window.blokInstance = blok;

      if (blok) {
        await blok.isReady;
      }
    }, { holder: HOLDER_ID });

    const paragraph = getParagraphByIndex(page, 0);

    // Select some text
    await selectText(paragraph, 'important');

    // Set fake background (simulating what inline toolbar does)
    await page.evaluate(() => {
      window.blokInstance?.selection.setFakeBackground();
    });

    // Verify fake background is present
    await expect(page.locator(FAKE_BACKGROUND_SELECTOR)).not.toHaveCount(0);

    // Convert the block to header via API (simulating what Convert inline tool does)
    await page.evaluate(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not available');
      }

      const blocks = await blok.save();
      const blockId = blocks.blocks[0]?.id;

      await blok.blocks.convert(blockId ?? '', 'header');
    });

    // Wait for history to record the change
    await waitForDelay(HISTORY_DEBOUNCE_WAIT);

    // Verify block was converted to header
    const headerSelector = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`;

    await expect(page.locator(headerSelector)).toHaveCount(1);

    // Undo the conversion
    await page.keyboard.press(UNDO_SHORTCUT);

    // Wait for undo to complete
    await waitForDelay(STATE_CHANGE_WAIT);

    // Verify block is back to paragraph
    await expect(page.locator(PARAGRAPH_SELECTOR)).toHaveCount(1);

    // Verify no fake background elements remain in the DOM after undo
    await expect(page.locator(FAKE_BACKGROUND_SELECTOR)).toHaveCount(0);

    // Also verify text content is preserved
    const paragraphText = await getParagraphByIndex(page, 0).innerText();

    expect(paragraphText.trim()).toBe('Some important text here');
  });

  test('clearFakeBackground API method removes fake background and resets state', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Test text for selection',
        },
      },
    ]);

    const paragraph = getParagraphByIndex(page, 0);

    await selectText(paragraph, 'text');

    // Set fake background
    await page.evaluate(() => {
      window.blokInstance?.selection.setFakeBackground();
    });

    // Verify fake background is present
    await expect(page.locator(FAKE_BACKGROUND_SELECTOR)).not.toHaveCount(0);

    // Call clearFakeBackground
    await page.evaluate(() => {
      window.blokInstance?.selection.clearFakeBackground();
    });

    // Verify fake background elements are removed
    await expect(page.locator(FAKE_BACKGROUND_SELECTOR)).toHaveCount(0);
  });

  test('rubber band selection works when starting from page margin outside editor', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Third block',
        },
      },
    ]);

    const firstBlock = getBlockByIndex(page, 0);
    const secondBlock = getBlockByIndex(page, 1);

    const firstBox = await getRequiredBoundingBox(firstBlock);
    const secondBox = await getRequiredBoundingBox(secondBlock);

    // Start drag from left margin (x=10), at the Y position of first block
    const startX = 10;
    const startY = firstBox.y + firstBox.height / 2;

    // End drag still in margin, but at Y position of second block
    const endX = 10;
    const endY = secondBox.y + secondBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 10 });
    await page.mouse.up();

    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 2)).not.toHaveAttribute('data-blok-selected', 'true');
  });

  test('shift+drag adds to existing selection instead of replacing', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Third block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Fourth block',
        },
      },
    ]);

    const firstBlock = getBlockByIndex(page, 0);
    const secondBlock = getBlockByIndex(page, 1);
    const thirdBlock = getBlockByIndex(page, 2);
    const fourthBlock = getBlockByIndex(page, 3);

    // First, select blocks 0-1 via rubber band
    const firstBox = await getRequiredBoundingBox(firstBlock);
    const secondBox = await getRequiredBoundingBox(secondBlock);

    await page.mouse.move(10, firstBox.y + firstBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, secondBox.y + secondBox.height / 2, { steps: 5 });
    await page.mouse.up();

    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 2)).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 3)).not.toHaveAttribute('data-blok-selected', 'true');

    // Now Shift+drag to add blocks 2-3
    const thirdBox = await getRequiredBoundingBox(thirdBlock);
    const fourthBox = await getRequiredBoundingBox(fourthBlock);

    await page.keyboard.down('Shift');
    await page.mouse.move(10, thirdBox.y + thirdBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, fourthBox.y + fourthBox.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // All four blocks should now be selected
    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 3)).toHaveAttribute('data-blok-selected', 'true');
  });

  test('rubber band selection does not select blocks until rectangle intersects them horizontally', async ({ page }) => {
    // Create a centered editor with margins to test horizontal intersection
    await page.evaluate(({ holder }) => {
      const existingHolder = document.getElementById(holder);

      if (existingHolder) {
        existingHolder.remove();
      }

      const container = document.createElement('div');

      container.id = holder;
      container.setAttribute('data-blok-testid', holder);
      // Center the editor with a fixed width to create left/right margins
      container.style.width = '400px';
      container.style.margin = '0 auto';
      container.style.border = '1px dotted #388AE5';

      document.body.appendChild(container);
    }, { holder: HOLDER_ID });

    await page.evaluate(async ({ holder }) => {
      const blok = new window.Blok({
        holder: holder,
        data: {
          blocks: [
            { type: 'paragraph', data: { text: 'First block' } },
            { type: 'paragraph', data: { text: 'Second block' } },
          ],
        },
      });

      window.blokInstance = blok;
      await blok.isReady;
    }, { holder: HOLDER_ID });

    const firstBlock = getBlockByIndex(page, 0);
    const secondBlock = getBlockByIndex(page, 1);
    const firstBox = await getRequiredBoundingBox(firstBlock);
    const secondBox = await getRequiredBoundingBox(secondBlock);

    // Start drag from far left margin (x=10), well outside the centered editor
    // Position Y in the middle of first block
    const startX = 10;
    const startY = firstBox.y + firstBox.height / 2;

    // Drag down to second block's Y position, but stay in the left margin (x=10)
    const endY = secondBox.y + secondBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, endY, { steps: 10 });

    // Blocks should NOT be selected because rectangle hasn't reached them horizontally
    await expect(getBlockByIndex(page, 0)).not.toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).not.toHaveAttribute('data-blok-selected', 'true');

    // Now continue dragging horizontally until we reach the block holder
    const reachBlockX = firstBox.x + 10; // Just inside the block holder

    await page.mouse.move(reachBlockX, endY, { steps: 10 });

    // Now both blocks should be selected because rectangle intersects them
    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-blok-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-blok-selected', 'true');

    await page.mouse.up();
  });

  test('toolbar is hidden during rubber band selection', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block',
        },
      },
    ]);

    const firstBlock = getBlockByIndex(page, 0);
    const secondBlock = getBlockByIndex(page, 1);
    const firstBox = await getRequiredBoundingBox(firstBlock);
    const secondBox = await getRequiredBoundingBox(secondBlock);

    // Click on first block to make toolbar visible
    await firstBlock.click();

    // Wait for toolbar to open (check for data-blok-opened attribute)
    const toolbar = page.locator('[data-blok-toolbar]');

    await expect(toolbar).toHaveAttribute('data-blok-opened', 'true');

    // Start rubber band selection from left margin
    const startX = 10;
    const startY = firstBox.y + firstBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // Drag down through blocks
    const endY = secondBox.y + secondBox.height / 2;

    await page.mouse.move(startX, endY, { steps: 10 });

    // Toolbar should be closed during rubber band selection (no data-blok-opened attribute)
    await expect(toolbar).not.toHaveAttribute('data-blok-opened', 'true');

    await page.mouse.up();
  });
});
