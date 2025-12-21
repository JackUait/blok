import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { BlokConfig, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR
} from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const HEADER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="header"]`;
const INLINE_TOOLBAR_ITEMS_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-items"] [data-blok-testid]`;
const INLINE_TOOLBAR_CONTAINER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-container"]`;
const INLINE_TOOL_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-item"]`;
const NESTED_BLOK_ID = 'nested-blok';

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = Pick<BlokConfig, 'readOnly' | 'placeholder'> & {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
};

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

const NESTED_BLOK_TOOL_SOURCE = `
class NestedBlokTool {
  constructor({ data }) {
    this.data = data || {};
    this.nestedBlok = null;
  }

  render() {
    const wrapper = document.createElement('div');
    const holderEl = document.createElement('div');
    const holderId = '${NESTED_BLOK_ID}-holder-' + Math.random().toString(16).slice(2);

    wrapper.setAttribute('data-blok-testid', '${NESTED_BLOK_ID}');
    holderEl.id = holderId;
    holderEl.setAttribute('data-blok-testid', '${NESTED_BLOK_ID}-holder');

    wrapper.appendChild(holderEl);

    this.nestedBlok = new window.Blok({
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
    if (this.nestedBlok && typeof this.nestedBlok.destroy === 'function') {
      await this.nestedBlok.destroy();
    }
  }

  save() {
    return this.data?.text || '';
  }
}
`;

/**
 * Reset the blok holder and destroy any existing instance
 * @param page - The Playwright page object
 */
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

/**
 * Initialize the blok with the provided configuration
 * @param page - The Playwright page object
 * @param options - Blok configuration options
 */
const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  await resetBlok(page);

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
    async ({ holder, blokOptions, blokData, blokTools }) => {
      const blokConfig: Record<string, unknown> = {
        holder: holder,
        ...blokOptions,
      };

      if (blokData) {
        blokConfig.data = blokData;
      }

      if (blokTools.length > 0) {
        const toolsConfig = blokTools.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
          (accumulator, { name, className, classCode, config }) => {
            let toolClass: unknown;

            if (className) {
              // Handle dot notation (e.g., 'Blok.Header')
              toolClass = className.split('.').reduce(
                (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
                window
              ) ?? null;
            }

            if (!toolClass && classCode) {

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

        blokConfig.tools = toolsConfig;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;

      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokOptions: restOptions,
      blokData: data ?? null,
      blokTools: serializedTools,
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

    // Filter to only include popover items and separators (exclude icons and other nested elements)
    return elements
      .filter((element) => {
        const testid = element.getAttribute('data-blok-testid');

        return testid === 'popover-item' || testid === 'popover-item-separator';
      })
      .map((element) => {
        return {
          name: element.getAttribute('data-blok-item-name'),
          hasSeparator: element.getAttribute('data-blok-testid') === 'popover-item-separator',
        };
      });
  }, INLINE_TOOLBAR_ITEMS_SELECTOR);
};

test.describe('inline toolbar', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('keyboard navigation', () => {
    test('navigates through inline toolbar items with Tab', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text to select',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'text to select');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      // Get toolbar items
      const toolbarItems = page.locator(`${INLINE_TOOL_SELECTOR}:not([data-blok-hidden="true"])`);
      const itemsCount = await toolbarItems.count();

      expect(itemsCount).toBeGreaterThan(1);

      // First item should NOT be focused by default (inline toolbar doesn't auto-focus)
      // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
      await expect(toolbarItems.first()).not.toHaveAttribute('data-blok-focused', 'true');

      // Press Tab to focus first item
      await page.keyboard.press('Tab');

      // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
      await expect(toolbarItems.first()).toHaveAttribute('data-blok-focused', 'true');

      // Navigate with Tab to next item
      await page.keyboard.press('Tab');

      // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
      await expect(toolbarItems.nth(1)).toHaveAttribute('data-blok-focused', 'true');
    });

    test('navigates through inline toolbar items with ArrowDown and ArrowUp', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text to select',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'text to select');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      const toolbarItems = page.locator(`${INLINE_TOOL_SELECTOR}:not([data-blok-hidden="true"])`);
      const itemsCount = await toolbarItems.count();

      expect(itemsCount).toBeGreaterThan(1);

      // Press Tab to focus first item (inline toolbar doesn't auto-focus)
      await page.keyboard.press('Tab');

      // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
      await expect(toolbarItems.first()).toHaveAttribute('data-blok-focused', 'true');

      // Navigate down
      await page.keyboard.press('ArrowDown');

      // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
      await expect(toolbarItems.nth(1)).toHaveAttribute('data-blok-focused', 'true');

      // Navigate back up
      await page.keyboard.press('ArrowUp');

      // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
      await expect(toolbarItems.first()).toHaveAttribute('data-blok-focused', 'true');
    });

    test('activates focused inline tool with Enter key', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text to make bold',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'text to make');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      // Navigate to bold button
      const boldButton = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="bold"]`);

      await expect(boldButton).toBeVisible();

      // Press Tab first to focus on toolbar, then navigate to bold using arrow keys
      await page.keyboard.press('Tab');

      while (!await boldButton.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      await expect(boldButton).toHaveAttribute('data-blok-focused', 'true');

      // Activate bold with Enter
      await page.keyboard.press('Enter');

      // Bold should now be active
      await expect(boldButton).toHaveAttribute('data-blok-popover-item-active', 'true');
    });

    test('converts block using keyboard navigation in nested popover', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text to convert',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Some text to convert');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      // Open convert-to nested popover
      const convertToOption = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);

      // Press Tab first to focus on toolbar, then navigate to convert-to using arrow keys
      await page.keyboard.press('Tab');

      while (!await convertToOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      // Use Enter to open nested popover (ArrowRight is blocked in inline toolbar per accessibility requirements)
      await page.keyboard.press('Enter');

      const nestedPopover = page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`);

      await expect(nestedPopover).toBeVisible();

      // Navigate to header in nested popover - need to press Tab first to focus on nested popover items
      const headerOption = page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-item-name="header-2"]`);

      await expect(headerOption).toBeVisible();

      // Press Tab to focus on nested popover items
      await page.keyboard.press('Tab');

      while (!await headerOption.getAttribute('data-blok-focused')) {
        await page.keyboard.press('ArrowDown');
      }

      // Select header with Enter
      await page.keyboard.press('Enter');

      // Block should be converted
      const headerBlock = page.locator(HEADER_SELECTOR);

      await expect(headerBlock).toHaveText('Some text to convert');
    });

    test('closes inline toolbar with Escape key', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text to select',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'text to select');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      await page.keyboard.press('Escape');

      await expect(toolbar).toHaveCount(0);
    });

    test('closes only nested popover with Escape key, keeping inline toolbar open', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text to convert',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Some text to convert');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      // Click on convert-to option to open nested popover
      const convertToOption = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);

      await expect(convertToOption).toBeVisible();
      await convertToOption.click();

      // Nested popover should appear
      const nestedPopover = page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`);

      await expect(nestedPopover).toBeVisible();

      // Press Escape to close nested popover
      await page.keyboard.press('Escape');

      // Nested popover should be closed
      await expect(nestedPopover).toHaveCount(0);

      // Inline toolbar should still be visible (not flickering/re-rendered)
      await expect(toolbar).toBeVisible();

      // Press Escape again to close the inline toolbar
      await page.keyboard.press('Escape');

      await expect(toolbar).toHaveCount(0);
    });

    test('does not navigate when Shift+Arrow is pressed (allows text selection)', async ({ page }) => {
      await createBlok(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text to select and modify',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'text to select');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      const toolbarItems = page.locator(`${INLINE_TOOL_SELECTOR}:not([data-blok-hidden="true"])`);

      // Press Tab to focus first item
      await page.keyboard.press('Tab');

      // eslint-disable-next-line playwright/no-nth-methods -- Testing keyboard navigation requires checking specific indices
      await expect(toolbarItems.first()).toHaveAttribute('data-blok-focused', 'true');

      // Press Shift+ArrowDown - should not navigate (used for extending selection)
      await page.keyboard.press('Shift+ArrowDown');

      // Focus should remain on first item (not navigate)
      // Note: This test verifies that Shift+Arrow doesn't trigger flipper navigation
      const focusedItems = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-focused="true"]`);

      await expect(focusedItems).toHaveCount(1);
    });
  });

  test('should align with the left coordinate of the selection range', async ({ page }) => {
    await createBlok(page, {
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

  // Firefox has different text layout behavior for selections near line wraps,
  // causing the selection bounding box to be positioned differently than in Chromium/WebKit
  test('should align with the right edge when toolbar width exceeds available space', async ({ page, browserName }) => {
    // eslint-disable-next-line playwright/no-skipped-test -- conditional skip for browser-specific behavior
    test.skip(browserName === 'firefox', 'Firefox has different text layout behavior near line wraps');
    await createBlok(page, {
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

    const paragraphWrapper = page.locator(PARAGRAPH_SELECTOR);
    // The contenteditable element is inside the block wrapper
    const paragraph = paragraphWrapper.locator('[contenteditable]');

    await expect(paragraphWrapper).toHaveCount(1);
    const [ firstLineWrapIndex ] = await getLineWrapPositions(paragraph);

    expect(firstLineWrapIndex).toBeGreaterThan(4);

    await selectTextByOffset(paragraph, firstLineWrapIndex - 5, firstLineWrapIndex);

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbar).toBeVisible();

    const toolbarBox = await toolbar.boundingBox();
    // Use the contenteditable element's bounding box for more accurate comparison
    const paragraphBox = await paragraph.boundingBox();

    expect(toolbarBox).not.toBeNull();
    expect(paragraphBox).not.toBeNull();

    const toolbarRight = toolbarBox!.x + toolbarBox!.width;
    const paragraphRight = paragraphBox!.x + paragraphBox!.width;

    expect(Math.abs(toolbarRight - paragraphRight)).toBeLessThanOrEqual(10);
  });

  test('should display inline toolbar in read-only mode when tool supports it', async ({ page }) => {
    await createBlok(page, {
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
          className: 'Blok.Header',
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
    await createBlok(page, {
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

    await page.evaluate(({ holder }) => {
      const form = document.createElement('form');

      form.id = 'inline-toolbar-form';
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        window.inlineToolbarFormSubmitCount = (window.inlineToolbarFormSubmitCount ?? 0) + 1;
      });

      document.body.appendChild(form);

      const blokElement = document.getElementById(holder);

      if (!blokElement) {
        throw new Error('Blok element not found');
      }

      form.appendChild(blokElement);

      window.inlineToolbarFormSubmitCount = 0;
    }, { holder: HOLDER_ID });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);

    await selectText(paragraph, 'Some text');

    await page.locator('[data-blok-item-name="bold"]').click();

    const submitCount = await page.evaluate(() => window.inlineToolbarFormSubmitCount ?? 0);

    expect(submitCount).toBe(0);
  });

  test('allows controlling inline toolbar visibility via API', async ({ page }) => {
    await createBlok(page, {
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
      window.blokInstance?.inlineToolbar?.close();
    });

    await expect(toolbarContainer).toHaveCount(0);

    await selectText(paragraph, 'toolbar');

    await page.evaluate(() => {
      window.blokInstance?.inlineToolbar?.open();
    });

    await expect(page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR)).toBeVisible();
  });

  test('reflects inline tool state changes based on current selection', async ({ page, browserName }) => {
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip(browserName === 'firefox' || browserName === 'webkit', 'Skipped in Firefox and WebKit');

    await createBlok(page, {
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

    // Close the toolbar before selecting new text to ensure fresh state
    await page.evaluate(() => {
      window.blokInstance?.inlineToolbar?.close();
    });

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    // Wait for toolbar to be hidden before selecting new text
    await expect(toolbar).toHaveCount(0);

    await selectText(paragraph, 'plain part');

    // Wait for the toolbar to appear automatically via selectionchange event
    // This ensures the selection is properly established before checking the active state
    await expect(toolbar).toBeVisible();

    // Re-locate the bold button after the toolbar is visible to ensure we're checking the new instance
    const boldButtonAfterReopen = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="bold"]`);

    await expect(boldButtonAfterReopen).not.toHaveAttribute('data-blok-popover-item-active', 'true');
  });

  test('should restore caret after converting a block', async ({ page }) => {
    await createBlok(page, {
      tools: {
        header: {
          className: 'Blok.Header',
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

    // Click paragraph first to ensure it has focus
    await paragraph.click();

    await selectText(paragraph, 'Some text');

    await page.locator('[data-blok-item-name="convert-to"]').click();

    // Wait for nested popover to be visible
    const nestedPopover = page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`);

    await expect(nestedPopover).toBeVisible();

    // Click header option in the nested popover
    await page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"] [data-blok-item-name="header-2"]`).click();

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

  test('should keep nested inline toolbar open while interacting with nested blok', async ({ page }) => {
    await createBlok(page, {
      tools: {
        nestedBlok: {
          classCode: NESTED_BLOK_TOOL_SOURCE,
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
            type: 'nestedBlok',
            data: {
              text: 'The nested blok allows for complex document structures and hierarchical content organization',
            },
          },
        ],
      },
    });

    const nestedParagraph = page.locator(`[data-blok-testid="${NESTED_BLOK_ID}"] [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`);

    await expect(nestedParagraph).toHaveCount(1);

    await expect(nestedParagraph).toBeVisible();

    await selectText(nestedParagraph, 'document structures');

    await page.locator(`[data-blok-testid="${NESTED_BLOK_ID}"] [data-blok-item-name="link"]`).click();

    const input = page.locator(`[data-blok-testid="${NESTED_BLOK_ID}"] [data-blok-testid="inline-tool-input"]`);

    await input.click();
    await input.pressSequentially('https://google.com', { delay: 20 });

    const nestedToolbar = page.locator(
      `[data-blok-testid="${NESTED_BLOK_ID}"] [data-blok-interface="inline-toolbar"] [data-blok-testid="popover"][data-blok-popover-opened="true"]:not([data-blok-nested="true"])`
    );

    await expect(nestedToolbar).toBeVisible();
  });

  test('should have a separator after the first item if it has children', async ({ page }) => {
    await createBlok(page, {
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

  test('should close inline toolbar when clicking outside after opening convert-to dropdown', async ({ page }) => {
    await createBlok(page, {
      tools: {
        header: {
          className: 'Blok.Header',
        },
      },
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'First paragraph with some text to select',
            },
          },
          {
            type: 'paragraph',
            data: {
              text: 'Second paragraph to click on',
            },
          },
        ],
      },
    });

    // eslint-disable-next-line playwright/no-nth-methods -- Testing requires selecting specific paragraph blocks
    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).first();
    // eslint-disable-next-line playwright/no-nth-methods -- Testing requires selecting specific paragraph blocks
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR).nth(1);

    await expect(firstParagraph).toBeVisible();
    await expect(secondParagraph).toBeVisible();

    // Select text in the first paragraph to show inline toolbar
    await selectText(firstParagraph, 'some text');

    const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(toolbar).toBeVisible();

    // Click on the convert-to button to open the dropdown
    const convertToButton = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);

    await expect(convertToButton).toBeVisible();
    await convertToButton.click();

    // Verify the nested popover (convert-to dropdown) is open
    const nestedPopover = page.locator(`${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`);

    await expect(nestedPopover).toBeVisible();

    // Click outside the inline toolbar to close it
    // Use page.mouse.click at a position that's definitely outside the toolbar
    // This is more reliable than clicking on an element that might be covered by the toolbar
    await page.mouse.click(10, 10);

    // Verify the inline toolbar is closed
    await expect(toolbar).toHaveCount(0);
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    toolSurround?: () => void;
    inlineToolbarFormSubmitCount?: number;
  }
}

