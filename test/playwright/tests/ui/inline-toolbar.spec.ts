import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '@/types';
import type { EditorConfig, OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import {
  EDITOR_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR
} from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HEADER_TOOL_UMD_PATH = path.resolve(
  __dirname,
  '../../../../node_modules/@editorjs/header/dist/header.umd.js'
);

const HOLDER_ID = 'editorjs';
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid="block-wrapper"] [data-blok-block-tool="paragraph"]`;
const HEADER_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid="block-wrapper"] [data-blok-block-tool="header"]`;
const INLINE_TOOLBAR_ITEMS_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-testid="popover-items"] > *`;
const INLINE_TOOLBAR_CONTAINER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-testid="popover-container"]`;
const INLINE_TOOL_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-testid="popover-item"]`;
const NESTED_EDITOR_ID = 'nested-editor';

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateEditorOptions = Pick<EditorConfig, 'readOnly' | 'placeholder'> & {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
};

const TEST_INLINE_TOOL_SOURCE = `
class TestTool {
  static isInline = true;

  constructor() {}

  render() {
    return {
      icon: 'n',
      title: 'Test Tool',
      name: 'test-tool',
      children: {
        items: [
          {
            icon: 'm',
            title: 'Test Tool Item',
            onActivate: () => {},
          },
        ],
      },
    };
  }
}
`;

const READ_ONLY_INLINE_TOOL_SOURCE = `
class ReadOnlyInlineTool {
  static isInline = true;
  static isReadOnlySupported = true;

  render() {
    return {
      title: 'Test Tool',
      name: 'test-tool',
      onActivate: () => {},
    };
  }
}
`;

const NESTED_EDITOR_TOOL_SOURCE = `
class NestedEditorTool {
  constructor({ data }) {
    this.data = data || {};
    this.nestedEditor = null;
  }

  render() {
    const wrapper = document.createElement('div');
    const holder = document.createElement('div');
    const holderId = '${NESTED_EDITOR_ID}-holder-' + Math.random().toString(16).slice(2);

    wrapper.dataset.testid = '${NESTED_EDITOR_ID}';
    holder.id = holderId;
    holder.dataset.testid = '${NESTED_EDITOR_ID}-holder';

    wrapper.appendChild(holder);

    this.nestedEditor = new window.EditorJS({
      holder: holderId,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: this.data?.text || '',
            },
          },
        ],
      },
      inlineToolbar: true,
    });

    return wrapper;
  }

  async destroy() {
    if (this.nestedEditor && typeof this.nestedEditor.destroy === 'function') {
      await this.nestedEditor.destroy();
    }
  }

  save() {
    return this.data?.text || '';
  }
}
`;

/**
 * Reset the editor holder and destroy any existing instance
 * @param page - The Playwright page object
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
    container.dataset.testid = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

/**
 * Initialize the editor with the provided configuration
 * @param page - The Playwright page object
 * @param options - Editor configuration options
 */
const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  await resetEditor(page);

  const { tools = {}, data, ...restOptions } = options;

  const serializedTools = Object.entries(tools).map(([name, toolConfig]) => {
    return {
      name,
      className: toolConfig.className ?? null,
      classCode: toolConfig.classCode ?? null,
      config: toolConfig.config ?? {},
    };
  });

  await page.evaluate(
    async ({ holderId, editorOptions, editorData, editorTools }) => {
      const editorConfig: Record<string, unknown> = {
        holder: holderId,
        ...editorOptions,
      };

      if (editorData) {
        editorConfig.data = editorData;
      }

      if (editorTools.length > 0) {
        const toolsConfig = editorTools.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
          (accumulator, { name, className, classCode, config }) => {
            let toolClass: unknown;

            if (className) {
              toolClass = (window as unknown as Record<string, unknown>)[className];
            }

            if (!toolClass && classCode) {
              // eslint-disable-next-line no-new-func -- constructing helper class inside page context
              toolClass = new Function(`return (${classCode});`)();
            }

            if (!toolClass) {
              throw new Error(`Tool class for "${name}" is not available`);
            }

            return {
              ...accumulator,
              [name]: {
                class: toolClass,
                ...config,
              },
            };
          },
          {}
        );

        editorConfig.tools = toolsConfig;
      }

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;

      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      editorOptions: restOptions,
      editorData: data ?? null,
      editorTools: serializedTools,
    }
  );
};

/**
 * Programmatically set selection range within an element.
 * @param locator - Locator that wraps the element containing selectable text
 * @param start - Selection start offset (inclusive)
 * @param end - Selection end offset (exclusive)
 */
const setSelectionRange = async (locator: Locator, start: number, end: number): Promise<void> => {
  if (start < 0 || end < start) {
    throw new Error(`Invalid selection offsets: start (${start}) must be >= 0 and end (${end}) must be >= start.`);
  }

  await locator.scrollIntoViewIfNeeded();
  await locator.focus();

  await locator.evaluate(
    (element, { start: selectionStart, end: selectionEnd }) => {
      const ownerDocument = element.ownerDocument;

      if (!ownerDocument) {
        return;
      }

      const selection = ownerDocument.getSelection();

      if (!selection) {
        return;
      }

      const textNodes: Text[] = [];
      const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);

      let currentNode = walker.nextNode();

      while (currentNode) {
        textNodes.push(currentNode as Text);
        currentNode = walker.nextNode();
      }

      if (textNodes.length === 0) {
        return;
      }

      const findPosition = (offset: number): { node: Text; nodeOffset: number } | null => {
        let accumulated = 0;

        for (const node of textNodes) {
          const length = node.textContent?.length ?? 0;
          const nodeStart = accumulated;
          const nodeEnd = accumulated + length;

          if (offset >= nodeStart && offset <= nodeEnd) {
            return {
              node,
              nodeOffset: Math.min(length, offset - nodeStart),
            };
          }

          accumulated = nodeEnd;
        }

        if (offset === 0) {
          const firstNode = textNodes[0];

          return {
            node: firstNode,
            nodeOffset: 0,
          };
        }

        return null;
      };

      const startPosition = findPosition(selectionStart);
      const endPosition = findPosition(selectionEnd);

      if (!startPosition || !endPosition) {
        return;
      }

      const range = ownerDocument.createRange();

      range.setStart(startPosition.node, startPosition.nodeOffset);
      range.setEnd(endPosition.node, endPosition.nodeOffset);

      selection.removeAllRanges();
      selection.addRange(range);
    },
    { start,
      end }
  );
};

/**
 * Select text content within a locator by string match
 * @param locator - The Playwright locator for the element containing the text
 * @param text - The text string to select within the element
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  const fullText = await locator.textContent();

  if (!fullText || !fullText.includes(text)) {
    throw new Error(`Text "${text}" was not found in element`);
  }

  const startIndex = fullText.indexOf(text);
  const endIndex = startIndex + text.length;

  await setSelectionRange(locator, startIndex, endIndex);
};

/**
 * Select text content within a locator by character offsets
 * @param locator - The Playwright locator for the element containing the text
 * @param start - The start offset (inclusive)
 * @param end - The end offset (exclusive)
 */
const selectTextByOffset = async (locator: Locator, start: number, end: number): Promise<void> => {
  await setSelectionRange(locator, start, end);
};

/**
 * Calculate line wrap positions for the provided locator
 * @param locator - The Playwright locator for the element containing the text
 */
const getLineWrapPositions = async (locator: Locator): Promise<number[]> => {
  return locator.evaluate((element) => {
    const lineWraps: number[] = [];
    const firstChild = element.firstChild;

    if (!firstChild || firstChild.nodeType !== Node.TEXT_NODE) {
      return lineWraps;
    }

    const document = element.ownerDocument;

    if (!document) {
      return lineWraps;
    }

    const textContent = firstChild.textContent ?? '';
    let currentLineTop: number | undefined;

    for (let index = 0; index < textContent.length; index++) {
      const range = document.createRange();

      range.setStart(firstChild, index);
      range.setEnd(firstChild, index);

      const rect = range.getBoundingClientRect();

      if (index === 0) {
        currentLineTop = rect.top;
        continue;
      }

      if (typeof currentLineTop === 'number' && rect.top > currentLineTop) {
        lineWraps.push(index);
        currentLineTop = rect.top;
      }
    }

    return lineWraps;
  });
};

type ToolbarItemSnapshot = {
  name: string | null;
  hasSeparator: boolean;
};

/**
 * Collect inline toolbar items meta information for assertions that depend on ordering
 * @param page - The Playwright page object
 */
const getInlineToolbarSnapshot = async (page: Page): Promise<ToolbarItemSnapshot[]> => {
  // eslint-disable-next-line playwright/no-wait-for-selector
  await page.waitForSelector(INLINE_TOOLBAR_ITEMS_SELECTOR, {
    state: 'visible',
  });

  return page.evaluate((selector) => {
    const elements = Array.from(document.querySelectorAll(selector));

    return elements.map((element) => {
      return {
        name: element.getAttribute('data-blok-item-name'),
        hasSeparator: element.getAttribute('data-testid') === 'popover-item-separator',
      };
    });
  }, INLINE_TOOLBAR_ITEMS_SELECTOR);
};

test.describe('inline toolbar', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should align with the left coordinate of the selection range', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'First block text',
            },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);

    await selectText(paragraph, 'block');

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbar).toBeVisible();

    const toolbarBox = await toolbar.boundingBox();

    expect(toolbarBox).not.toBeNull();

    const selectionRect = await page.evaluate(() => {
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        throw new Error('No selection available');
      }

      const rect = selection.getRangeAt(0).getBoundingClientRect();

      return {
        left: rect.left,
      };
    });

    const toolbarLeft = toolbarBox!.x;

    expect(Math.abs(toolbarLeft - selectionRect.left)).toBeLessThanOrEqual(1);
  });

  test('should align with the right edge when toolbar width exceeds available space', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Writing is a powerful tool for communication and expression. When crafting content, it is important to consider your audience and the message you want to convey. Good writing requires careful thought, clear structure, and attention to detail. The process of editing helps refine your ideas and improve clarity.',
            },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);
    const [ firstLineWrapIndex ] = await getLineWrapPositions(paragraph);

    expect(firstLineWrapIndex).toBeGreaterThan(4);

    await selectTextByOffset(paragraph, firstLineWrapIndex - 5, firstLineWrapIndex);

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbar).toBeVisible();

    const toolbarBox = await toolbar.boundingBox();
    const paragraphBox = await paragraph.boundingBox();

    expect(toolbarBox).not.toBeNull();
    expect(paragraphBox).not.toBeNull();

    const toolbarRight = toolbarBox!.x + toolbarBox!.width;
    const paragraphRight = paragraphBox!.x + paragraphBox!.width;

    expect(Math.abs(toolbarRight - paragraphRight)).toBeLessThanOrEqual(10);
  });

  test('should display inline toolbar in read-only mode when tool supports it', async ({ page }) => {
    await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });

    await createEditor(page, {
      readOnly: true,
      data: {
        blocks: [
          {
            type: 'header',
            data: {
              text: 'First block text',
            },
          },
        ],
      },
      tools: {
        header: {
          className: 'Header',
          config: {
            inlineToolbar: ['bold', 'testTool'],
          },
        },
        testTool: {
          classCode: READ_ONLY_INLINE_TOOL_SOURCE,
        },
      },
    });

    const headerBlock = page.locator(HEADER_SELECTOR);

    await expect(headerBlock).toHaveCount(1);

    await selectText(headerBlock, 'block');

    const toolbarItems = page.locator(INLINE_TOOL_SELECTOR);

    await expect(toolbarItems).toHaveCount(1);
    await expect(toolbarItems).toHaveAttribute('data-blok-item-name', 'test-tool');
  });

  test('should not submit surrounding form when inline tool is activated', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Some text',
            },
          },
        ],
      },
    });

    await page.evaluate(({ holderId }) => {
      const form = document.createElement('form');

      form.id = 'inline-toolbar-form';
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        window.inlineToolbarFormSubmitCount = (window.inlineToolbarFormSubmitCount ?? 0) + 1;
      });

      document.body.appendChild(form);

      const editorElement = document.getElementById(holderId);

      if (!editorElement) {
        throw new Error('Editor element not found');
      }

      form.appendChild(editorElement);

      window.inlineToolbarFormSubmitCount = 0;
    }, { holderId: HOLDER_ID });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);

    await selectText(paragraph, 'Some text');

    await page.locator('[data-blok-item-name="bold"]').click();

    const submitCount = await page.evaluate(() => window.inlineToolbarFormSubmitCount ?? 0);

    expect(submitCount).toBe(0);
  });

  test('allows controlling inline toolbar visibility via API', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Inline toolbar API control test',
            },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'toolbar');

    const toolbarContainer = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbarContainer).toBeVisible();

    await page.evaluate(() => {
      window.editorInstance?.inlineToolbar?.close();
    });

    await expect(toolbarContainer).toHaveCount(0);

    await selectText(paragraph, 'toolbar');

    await page.evaluate(() => {
      window.editorInstance?.inlineToolbar?.open();
    });

    await expect(page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR)).toBeVisible();
  });

  test('reflects inline tool state changes based on current selection', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Bold part and plain part',
            },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Bold part');

    const boldButton = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="bold"]`);

    await expect(boldButton).not.toHaveAttribute('data-blok-popover-item-active', 'true');

    await boldButton.click();

    await expect(boldButton).toHaveAttribute('data-blok-popover-item-active', 'true');

    await selectText(paragraph, 'plain part');

    await page.evaluate(() => {
      window.editorInstance?.inlineToolbar?.open();
    });

    await expect(boldButton).not.toHaveAttribute('data-blok-popover-item-active', 'true');
  });

  test('should restore caret after converting a block', async ({ page }) => {
    await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });

    await createEditor(page, {
      tools: {
        header: {
          className: 'Header',
        },
      },
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Some text',
            },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);

    await selectText(paragraph, 'Some text');

    await page.locator('[data-blok-item-name="convert-to"]').click();
    await page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-testid="popover-item"][data-blok-item-name="header"]`).click();

    await expect(page.locator(HEADER_SELECTOR)).toHaveText('Some text');

    const selectionState = await page.evaluate((selector) => {
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        return {
          rangeCount: 0,
          isInsideHeader: false,
        };
      }

      const range = selection.getRangeAt(0);
      const headerElement = document.querySelector(selector);

      return {
        rangeCount: selection.rangeCount,
        isInsideHeader: !!headerElement && headerElement.contains(range.startContainer),
      };
    }, HEADER_SELECTOR);

    expect(selectionState.rangeCount).toBe(1);
    expect(selectionState.isInsideHeader).toBe(true);
  });

  test('should keep nested inline toolbar open while interacting with nested editor', async ({ page }) => {
    await createEditor(page, {
      tools: {
        nestedEditor: {
          classCode: NESTED_EDITOR_TOOL_SOURCE,
        },
      },
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Document editing requires precision and attention to detail. Every word matters when crafting clear and effective content.',
            },
          },
          {
            type: 'nestedEditor',
            data: {
              text: 'The nested editor allows for complex document structures and hierarchical content organization',
            },
          },
        ],
      },
    });

    const nestedParagraph = page.locator(`[data-testid="${NESTED_EDITOR_ID}"] ${PARAGRAPH_SELECTOR}`);

    await expect(nestedParagraph).toHaveCount(1);

    await expect(nestedParagraph).toBeVisible();

    await selectText(nestedParagraph, 'document structures');

    await page.locator(`[data-testid="${NESTED_EDITOR_ID}"] [data-blok-item-name="link"]`).click();

    const input = page.locator(`[data-testid="${NESTED_EDITOR_ID}"] [data-testid="inline-tool-input"]`);

    await input.click();
    await input.type('https://editorjs.io', { delay: 20 });

    const nestedToolbar = page.locator(
      `[data-testid="${NESTED_EDITOR_ID}"] [data-blok-interface="inline-toolbar"] > [data-testid="popover"] > [data-testid="popover-container"]`
    );

    await expect(nestedToolbar).toBeVisible();
  });

  test('should have a separator after the first item if it has children', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'First block text',
            },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);

    await selectText(paragraph, 'block');

    const toolbarSnapshot = await getInlineToolbarSnapshot(page);

    expect(toolbarSnapshot[0]?.name).toBe('convert-to');
    expect(toolbarSnapshot[1]?.hasSeparator).toBe(true);
  });

  test('should have separators from both sides of item if it is in the middle and has children', async ({ page }) => {
    await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });

    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'header',
            data: {
              text: 'First block text',
            },
          },
        ],
      },
      tools: {
        header: {
          className: 'Header',
          config: {
            inlineToolbar: ['bold', 'testTool', 'link'],
          },
        },
        testTool: {
          classCode: TEST_INLINE_TOOL_SOURCE,
        },
      },
    });

    const headerBlock = page.locator(HEADER_SELECTOR);

    await expect(headerBlock).toHaveCount(1);

    await selectText(headerBlock, 'block');

    const toolbarSnapshot = await getInlineToolbarSnapshot(page);
    const testToolIndex = toolbarSnapshot.findIndex((item) => item.name === 'test-tool');

    expect(testToolIndex).toBeGreaterThan(0);
    expect(toolbarSnapshot[testToolIndex - 1]?.hasSeparator).toBe(true);
    expect(toolbarSnapshot[testToolIndex + 1]?.hasSeparator).toBe(true);
  });

  test('should have separator before the item with children if it is the last of all items', async ({ page }) => {
    await page.addScriptTag({ path: HEADER_TOOL_UMD_PATH });

    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'header',
            data: {
              text: 'First block text',
            },
          },
        ],
      },
      tools: {
        header: {
          className: 'Header',
          config: {
            inlineToolbar: ['bold', 'testTool'],
          },
        },
        testTool: {
          classCode: TEST_INLINE_TOOL_SOURCE,
        },
      },
    });

    const headerBlock = page.locator(HEADER_SELECTOR);

    await expect(headerBlock).toHaveCount(1);

    await selectText(headerBlock, 'block');

    const toolbarSnapshot = await getInlineToolbarSnapshot(page);
    const testToolIndex = toolbarSnapshot.findIndex((item) => item.name === 'test-tool');

    expect(testToolIndex).toBeGreaterThan(0);
    expect(testToolIndex).toBe(toolbarSnapshot.length - 1);
    expect(toolbarSnapshot[testToolIndex - 1]?.hasSeparator).toBe(true);
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
    toolSurround?: () => void;
    inlineToolbarFormSubmitCount?: number;
  }
}

