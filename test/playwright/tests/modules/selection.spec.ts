import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const BLOCK_WRAPPER_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid="block-wrapper"] [data-block-tool="paragraph"]`;
const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';
const FAKE_BACKGROUND_SELECTOR = '[data-testid="fake-background"]';

declare global {
  interface Window {
    editorInstance?: EditorJS;
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

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.dataset.testid = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, {
    holderId: HOLDER_ID,
  });
};

const createEditorWithBlocks = async (
  page: Page,
  blocks: OutputData['blocks'],
  tools: ToolDefinition[] = []
): Promise<void> => {
  const hasParagraphOverride = tools.some((tool) => tool.name === 'paragraph');
  const serializedTools: ToolDefinition[] = hasParagraphOverride
    ? tools
    : [
      {
        name: 'paragraph',
        config: {
          config: {
            preserveBlank: true,
          },
        },
      },
      ...tools,
    ];

  await resetEditor(page);
  await page.evaluate(async ({
    holderId,
    blocks: editorBlocks,
    serializedTools: toolConfigs,
  }: {
    holderId: string;
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

    const editor = new window.EditorJS({
      holder: holderId,
      data: { blocks: editorBlocks },
      ...(toolConfigs.length > 0 ? { tools: revivedTools } : {}),
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, {
    holderId: HOLDER_ID,
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
    wrapper.dataset.testid = 'editable-title-block';
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
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('selects all blocks via CMD/CTRL + A', async ({ page }) => {
    await createEditorWithBlocks(page, [
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
      await expect(getBlockByIndex(page, index)).toHaveAttribute('data-selected', 'true');
    }
  });

  test('cross-block selection selects contiguous blocks when dragging across content', async ({ page }) => {
    await createEditorWithBlocks(page, [
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

    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-selected', 'true');
    await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-selected', 'true');
    await expect(getBlockByIndex(page, 3)).not.toHaveAttribute('data-selected', 'true');
  });

  test('selection API exposes save/restore, expandToTag, fake background helpers', async ({ page }) => {
    const text = 'Important <strong>bold</strong> text inside paragraph';

    await createEditorWithBlocks(page, [
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
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor instance is not ready');
      }

      const selection = window.getSelection();

      const savedText = selection?.toString() ?? '';

      editor.selection.save();

      selection?.removeAllRanges();

      const paragraphEl = document.querySelector('[data-testid="block-wrapper"] [contenteditable]');
      const textNode = paragraphEl?.firstChild as Text | null;

      if (textNode) {
        const range = document.createRange();

        range.setStart(textNode, textNode.textContent?.length ?? 0);
        range.collapse(true);
        selection?.addRange(range);
      }

      editor.selection.restore();

      const restored = window.getSelection()?.toString() ?? '';
      const strongTag = editor.selection.findParentTag('STRONG');

      if (paragraphEl instanceof HTMLElement) {
        editor.selection.expandToTag(paragraphEl);
      }

      const expanded = window.getSelection()?.toString() ?? '';

      editor.selection.setFakeBackground();
      const fakeWrappersCount = document.querySelectorAll(fakeBackgroundSelector).length;

      editor.selection.removeFakeBackground();
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
    await createEditorWithBlocks(page, [
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
    await expect(getBlockByIndex(page, 0)).toHaveAttribute('data-selected', 'true');
    await expect(getBlockByIndex(page, 1)).toHaveAttribute('data-selected', 'true');
    await expect(getBlockByIndex(page, 2)).toHaveAttribute('data-selected', 'true');

    await page.keyboard.press('Backspace');

    const blocks = page.locator(BLOCK_WRAPPER_SELECTOR);

    await expect(blocks).toHaveCount(2);

    const savedData = await page.evaluate<OutputData>(async () => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor instance is not ready');
      }

      return editor.save();
    });

    expect(savedData.blocks).toHaveLength(2);

    const blockTexts = savedData.blocks.map((block) => {
      return (block.data as { text?: string }).text ?? '';
    });

    expect(blockTexts[0].trim()).toBe('');
    expect(blockTexts[1]).toBe('Fourth block');
  });

  test('cross-block selection spans different block types with shift navigation', async ({ page }) => {
    await createEditorWithBlocks(
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
      await expect(getBlockByIndex(page, index)).toHaveAttribute('data-selected', 'true');
    }
  });
});
