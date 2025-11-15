import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from './helpers/ensure-build';
import { TOOLTIP_INTERFACE_SELECTOR, EDITOR_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} div.ce-block`;
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-block-tool="paragraph"]`;
const SETTINGS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__settings-btn`;
const PLUS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__plus`;
const INLINE_TOOLBAR_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} ${INLINE_TOOLBAR_INTERFACE_SELECTOR}`;
const POPOVER_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-popover`;

/**
 * Reset the editor holder and destroy any existing instance
 *
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
    container.dataset.cy = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

/**
 * Create editor with i18n configuration
 *
 * @param page - The Playwright page object
 * @param config - Editor configuration including i18n settings
 */
const createEditorWithI18n = async (
  page: Page,
  config: {
    tools?: Record<string, unknown>;
    i18n?: { messages?: Record<string, unknown> };
    data?: { blocks?: OutputData['blocks'] };
  }
): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(
    async ({ holderId, editorConfig }) => {
      const resolveFromWindow = (value: unknown): unknown => {
        if (typeof value === 'string') {
          return value.split('.').reduce<unknown>((acc, key) => {
            if (acc && typeof acc === 'object') {
              return (acc as Record<string, unknown>)[key];
            }

            return undefined;
          }, window as unknown);
        }

        return value;
      };

      const resolveClassConfig = (classConfig: string): unknown => {
        const resolvedClass = resolveFromWindow(classConfig);

        if (resolvedClass === undefined) {
          throw new Error(`Unable to resolve tool class "${classConfig}" from window.`);
        }

        return resolvedClass;
      };

      const normalizeToolConfig = (toolConfig: unknown): unknown => {
        if (toolConfig === undefined || toolConfig === null) {
          return toolConfig;
        }

        if (typeof toolConfig === 'function') {
          return toolConfig;
        }

        if (typeof toolConfig === 'string') {
          const resolvedTool = resolveFromWindow(toolConfig);

          if (resolvedTool === undefined) {
            throw new Error(`Unable to resolve tool "${toolConfig}" from window.`);
          }

          return resolvedTool;
        }

        if (typeof toolConfig === 'object') {
          const normalizedConfig = { ...(toolConfig as Record<string, unknown>) };

          if ('class' in normalizedConfig && typeof normalizedConfig.class === 'string') {
            normalizedConfig.class = resolveClassConfig(normalizedConfig.class);
          }

          return normalizedConfig;
        }

        return toolConfig;
      };

      const normalizeTools = (tools: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
        if (!tools) {
          return tools;
        }

        return Object.entries(tools).reduce<Record<string, unknown>>((acc, [toolName, toolConfig]) => {
          const normalizedConfig = normalizeToolConfig(toolConfig);

          if (normalizedConfig === undefined) {
            throw new Error(`Tool "${toolName}" is undefined. Provide a valid constructor or configuration object.`);
          }

          return {
            ...acc,
            [toolName]: normalizedConfig,
          };
        }, {});
      };

      const { tools, ...restConfig } = editorConfig ?? {};
      const normalizedTools = normalizeTools(tools as Record<string, unknown> | undefined);

      const editor = new window.EditorJS({
        holder: holderId,
        ...restConfig,
        ...(normalizedTools ? { tools: normalizedTools } : {}),
      });

      window.editorInstance = editor;
      await editor.isReady;

      await new Promise<void>((resolve) => {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => resolve(), { timeout: 100 });

          return;
        }

        setTimeout(resolve, 0);
      });
    },
    { holderId: HOLDER_ID,
      editorConfig: config }
  );
};

/**
 * Select text content within a locator by string match
 *
 * @param locator - The Playwright locator for the element containing the text
 * @param text - The text string to select within the element
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode: Node | null = null;
    let start = -1;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const content = node.textContent ?? '';
      const idx = content.indexOf(targetText);

      if (idx !== -1) {
        textNode = node;
        start = idx;
        break;
      }
    }

    if (!textNode || start === -1) {
      throw new Error(`Text "${targetText}" was not found in element`);
    }

    const range = element.ownerDocument.createRange();

    range.setStart(textNode, start);
    range.setEnd(textNode, start + targetText.length);

    const selection = element.ownerDocument.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  }, text);
};

/**
 * Wait for tooltip to appear and get its text
 *
 * @param page - The Playwright page object
 * @param triggerElement - Element to hover over to trigger tooltip
 * @returns The tooltip text content
 */
const getTooltipText = async (page: Page, triggerElement: Locator): Promise<string> => {
  await triggerElement.hover();

  const tooltip = page.locator(TOOLTIP_INTERFACE_SELECTOR);

  await expect(tooltip).toBeVisible();

  return (await tooltip.textContent()) ?? '';
};

/**
 * Opens the inline toolbar popover and waits until it becomes visible.
 *
 * @param page - The Playwright page object
 * @returns Locator for the inline toolbar popover
 */
const openInlineToolbarPopover = async (page: Page): Promise<Locator> => {
  const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);

  await expect(inlineToolbar).toHaveCount(1);

  await page.evaluate(() => {
    window.editorInstance?.inlineToolbar?.open();
  });

  const inlinePopover = inlineToolbar.locator(':scope > .ce-popover');

  await expect(inlinePopover).toHaveCount(1);

  const inlinePopoverContainer = inlinePopover.locator(':scope > .ce-popover__container');

  await expect(inlinePopoverContainer).toHaveCount(1);
  await expect(inlinePopoverContainer).toBeVisible();

  return inlinePopover;
};

test.describe('editor i18n', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('toolbox', () => {
    test('should translate tool title in a toolbox', async ({ page }) => {
      const toolNamesDictionary = {
        Heading: 'Заголовок',
      };

      // Create a simple header tool in the browser context
      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for editor creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           * Creates a `SimpleHeader` instance with initial block data.
           *
           * @param root0 - Editor.js constructor arguments containing the block data.
           */
          constructor({ data }: { data: { text: string } }) {
            this.data = data;
          }

          /**
           *
           */
          public render(): HTMLHeadingElement {
            const element = document.createElement('h1');

            element.contentEditable = 'true';
            element.innerHTML = this.data.text;

            return element;
          }

          /**
           * Persists the heading content to the Editor.js data format.
           *
           * @param element - Heading element that contains the current block content.
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
          public static get toolbox(): { title: string; icon: string } {
            return {
              title: 'Heading',
              icon: '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"/></svg>',
            };
          }
        };
      });

      await createEditorWithI18n(page, {
        tools: {
          header: 'SimpleHeader',
        },
        i18n: {
          messages: {
            toolNames: toolNamesDictionary,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      const headerItem = page.locator(`${POPOVER_SELECTOR} [data-item-name="header"]`);

      await expect(headerItem).toBeVisible();
      await expect(headerItem).toContainText(toolNamesDictionary.Heading);
    });

    test('should translate titles of toolbox entries', async ({ page }) => {
      const toolNamesDictionary = {
        Title1: 'Название 1',
        Title2: 'Название 2',
      };

      // Create a test tool with multiple toolbox entries
      await page.evaluate(() => {
        // @ts-expect-error - Define TestTool in window for editor creation
        window.TestTool = class {
          /**
           *
           */
          public static get toolbox(): Array<{ title: string; icon: string }> {
            return [
              {
                title: 'Title1',
                icon: 'Icon 1',
              },
              {
                title: 'Title2',
                icon: 'Icon 2',
              },
            ];
          }

          /**
           *
           */
          public render(): HTMLDivElement {
            const wrapper = document.createElement('div');

            wrapper.contentEditable = 'true';
            wrapper.innerHTML = 'Test tool content';

            return wrapper;
          }

          /**
           *
           */
          public save(): Record<string, unknown> {
            return {};
          }
        };
      });

      await createEditorWithI18n(page, {
        tools: {
          testTool: 'TestTool',
        },
        i18n: {
          messages: {
            toolNames: toolNamesDictionary,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      const testToolItems = page.locator(`${POPOVER_SELECTOR} [data-item-name="testTool"]`);

      await expect(testToolItems).toHaveCount(2);
      await expect(testToolItems).toContainText([
        toolNamesDictionary.Title1,
        toolNamesDictionary.Title2,
      ]);
    });

    test('should use capitalized tool name as translation key if toolbox title is missing', async ({ page }) => {
      const toolNamesDictionary = {
        TestTool: 'ТестТул',
      };

      // Create a test tool without title
      await page.evaluate(() => {
        // @ts-expect-error - Define TestTool in window for editor creation
        window.TestTool = class {
          /**
           *
           */
          public static get toolbox(): { title: string; icon: string } {
            return {
              title: '',
              icon: '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"/></svg>',
            };
          }

          /**
           *
           */
          public render(): HTMLDivElement {
            const wrapper = document.createElement('div');

            wrapper.contentEditable = 'true';
            wrapper.innerHTML = 'Test tool content';

            return wrapper;
          }

          /**
           *
           */
          public save(): Record<string, unknown> {
            return {};
          }
        };
      });

      await createEditorWithI18n(page, {
        tools: {
          testTool: 'TestTool',
        },
        i18n: {
          messages: {
            toolNames: toolNamesDictionary,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      const testToolItem = page.locator(`${POPOVER_SELECTOR} [data-item-name="testTool"]`);

      await expect(testToolItem).toBeVisible();
      await expect(testToolItem).toContainText(toolNamesDictionary.TestTool);
    });
  });

  test.describe('block tunes', () => {
    test('should translate Delete button title', async ({ page }) => {
      const blockTunesDictionary = {
        delete: {
          Delete: 'Удалить',
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            blockTunes: blockTunesDictionary,
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

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(SETTINGS_BUTTON_SELECTOR).click();

      const deleteButton = page.locator(`${POPOVER_SELECTOR} [data-item-name="delete"]`);

      await expect(deleteButton).toBeVisible();
      await expect(deleteButton).toContainText(blockTunesDictionary.delete.Delete);
    });

    test('should translate Move up button title', async ({ page }) => {
      const blockTunesDictionary = {
        moveUp: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
          'Move up': 'Переместить вверх',
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            blockTunes: blockTunesDictionary,
          },
        },
        data: {
          blocks: [
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
          ],
        },
      });

      const secondBlock = page.locator(BLOCK_SELECTOR).filter({ hasText: 'Second block' });

      await expect(secondBlock).toHaveCount(1);
      await secondBlock.click();
      await page.locator(SETTINGS_BUTTON_SELECTOR).click();

      const moveUpButton = page.locator(`${POPOVER_SELECTOR} [data-item-name="move-up"]`);

      await expect(moveUpButton).toBeVisible();
      await expect(moveUpButton).toContainText(blockTunesDictionary.moveUp['Move up']);
    });

    test('should translate Move down button title', async ({ page }) => {
      const blockTunesDictionary = {
        moveDown: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
          'Move down': 'Переместить вниз',
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            blockTunes: blockTunesDictionary,
          },
        },
        data: {
          blocks: [
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
          ],
        },
      });

      const firstBlock = page.locator(BLOCK_SELECTOR).filter({ hasText: 'First block' });

      await expect(firstBlock).toHaveCount(1);
      await firstBlock.click();
      await page.locator(SETTINGS_BUTTON_SELECTOR).click();

      const moveDownButton = page.locator(`${POPOVER_SELECTOR} [data-item-name="move-down"]`);

      await expect(moveDownButton).toBeVisible();
      await expect(moveDownButton).toContainText(blockTunesDictionary.moveDown['Move down']);
    });

    test('should translate "Click to delete" confirmation message', async ({ page }) => {
      const blockTunesDictionary = {
        delete: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
          'Click to delete': 'Нажмите для удаления',
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            blockTunes: blockTunesDictionary,
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

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(SETTINGS_BUTTON_SELECTOR).click();

      const deleteButton = page.locator(`${POPOVER_SELECTOR} [data-item-name="delete"]`);

      await deleteButton.click();

      // Wait for confirmation popover to appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for UI animation
      await page.waitForTimeout(100);

      // Check if confirmation message appears (it might be in a nested popover or notification)
      const confirmationText = blockTunesDictionary.delete['Click to delete'];
      const confirmationElement = page.locator(`text=${confirmationText}`);

      // The confirmation might appear in different ways, so we check if it exists
      const confirmationExists = await confirmationElement.count() > 0;

      expect(confirmationExists).toBeTruthy();
    });

    test('should translate tool name in Convert To', async ({ page }) => {
      const toolNamesDictionary = {
        Heading: 'Заголовок',
      };

      // Create a simple header tool in the browser context
      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for editor creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           * Creates a `SimpleHeader` instance with initial block data.
           *
           * @param root0 - Editor.js constructor arguments containing the block data.
           */
          constructor({ data }: { data: { text: string } }) {
            this.data = data;
          }

          /**
           *
           */
          public render(): HTMLHeadingElement {
            const element = document.createElement('h1');

            element.contentEditable = 'true';
            element.innerHTML = this.data.text;

            return element;
          }

          /**
           * Persists the heading content to the Editor.js data format.
           *
           * @param element - Heading element that contains the current block content.
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
          public static get toolbox(): { title: string; icon: string } {
            return {
              title: 'Heading',
              icon: '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"/></svg>',
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
        };
      });

      await createEditorWithI18n(page, {
        tools: {
          header: 'SimpleHeader',
        },
        i18n: {
          messages: {
            toolNames: toolNamesDictionary,
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

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(SETTINGS_BUTTON_SELECTOR).click();

      // Open "Convert to" menu
      const convertToButton = page.locator(`${POPOVER_SELECTOR} [data-item-name="convert-to"]`);

      await expect(convertToButton).toBeVisible();
      await convertToButton.click();

      // Check item in convert to menu is internationalized
      const headerItem = page.locator(`${POPOVER_SELECTOR} .ce-popover--nested [data-item-name="header"]`);

      await expect(headerItem).toBeVisible();
      await expect(headerItem).toContainText(toolNamesDictionary.Heading);
    });
  });

  test.describe('ui popover', () => {
    test('should translate "Filter" search placeholder in toolbox', async ({ page }) => {
      const uiDictionary = {
        popover: {
          Filter: 'Поиск',
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            ui: uiDictionary,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      const searchInput = page.locator(`${POPOVER_SELECTOR} input[type="search"], ${POPOVER_SELECTOR} input[placeholder*="Filter"]`);

      await expect(searchInput).toBeVisible();

      const placeholder = await searchInput.getAttribute('placeholder');

      expect(placeholder).toContain(uiDictionary.popover.Filter);
    });

    test('should translate "Nothing found" message in toolbox', async ({ page }) => {
      const uiDictionary = {
        popover: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
          'Nothing found': 'Ничего не найдено',
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            ui: uiDictionary,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      const popoverContainer = page
        .locator(`${POPOVER_SELECTOR} .ce-popover__container:visible`)
        .filter({ has: page.locator('input[type="search"]') });

      await expect(popoverContainer).toHaveCount(1);
      await expect(popoverContainer).toBeVisible();

      const searchInput = popoverContainer.locator('input[type="search"]');

      await expect(searchInput).toHaveCount(1);
      await expect(searchInput).toBeVisible();
      await searchInput.fill('nonexistenttool12345');

      // Wait for "Nothing found" message to appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for search results
      await page.waitForTimeout(300);

      const nothingFoundMessage = popoverContainer.getByText(uiDictionary.popover['Nothing found']);

      await expect(nothingFoundMessage).toBeVisible();
    });

    test('should translate "Filter" and "Nothing found" in block settings popover', async ({ page }) => {
      const uiDictionary = {
        popover: {
          Filter: 'Поиск',
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
          'Nothing found': 'Ничего не найдено',
        },
      };

      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for editor creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           *
           * @param root0 - root data
           */
          constructor({ data }: { data: { text: string } }) {
            this.data = data;
          }

          /**
           *
           */
          public render(): HTMLHeadingElement {
            const element = document.createElement('h1');

            element.contentEditable = 'true';
            element.innerHTML = this.data.text;

            return element;
          }

          /**
           *
           * @param element - heading element
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
          public static get toolbox(): { title: string; icon: string } {
            return {
              title: 'Heading',
              icon: '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"/></svg>',
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
        };
      });

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            ui: uiDictionary,
          },
        },
        tools: {
          header: 'SimpleHeader',
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

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(SETTINGS_BUTTON_SELECTOR).click();

      const popoverContainer = page
        .locator(`${POPOVER_SELECTOR} .ce-popover__container:visible`)
        .filter({ has: page.locator(`input[placeholder*="${uiDictionary.popover.Filter}"]`) });

      await expect(popoverContainer).toHaveCount(1);
      await expect(popoverContainer).toBeVisible();

      const searchInput = popoverContainer.getByRole('searchbox', { name: uiDictionary.popover.Filter });

      await expect(searchInput).toHaveCount(1);
      await expect(searchInput).toBeVisible();

      const placeholder = await searchInput.getAttribute('placeholder');

      expect(placeholder).toContain(uiDictionary.popover.Filter);

      await searchInput.fill('nonexistent12345');
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for search results
      await page.waitForTimeout(300);

      const nothingFoundMessage = popoverContainer.getByText(uiDictionary.popover['Nothing found']);

      await expect(nothingFoundMessage).toBeVisible();
    });

    test('should translate "Filter" and "Nothing found" in inline toolbar popover', async ({ page }) => {
      const uiDictionary = {
        popover: {
          Filter: 'Поиск',
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
          'Nothing found': 'Ничего не найдено',
        },
      };

      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for editor creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           *
           * @param root0 - root data
           */
          constructor({ data }: { data: { text: string } }) {
            this.data = data;
          }

          /**
           *
           */
          public render(): HTMLHeadingElement {
            const element = document.createElement('h1');

            element.contentEditable = 'true';
            element.innerHTML = this.data.text;

            return element;
          }

          /**
           *
           * @param element - heading element
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
          public static get toolbox(): { title: string; icon: string } {
            return {
              title: 'Heading',
              icon: '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"/></svg>',
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
        };
      });

      await resetEditor(page);
      await page.evaluate(
        async ({ holderId, uiDict }) => {
          // @ts-expect-error - Get SimpleHeader from window
          const SimpleHeader = window.SimpleHeader;

          const editor = new window.EditorJS({
            holder: holderId,
            tools: {
              header: SimpleHeader,
            },
            i18n: {
              messages: {
                ui: uiDict,
              },
            },
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

          window.editorInstance = editor;
          await editor.isReady;
        },
        { holderId: HOLDER_ID,
          uiDict: uiDictionary }
      );

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await expect(paragraph).toHaveCount(1);

      await selectText(paragraph, 'Some text');

      // Wait for inline toolbar to appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for UI animation
      await page.waitForTimeout(200);

      const inlinePopover = await openInlineToolbarPopover(page);
      const convertToButton = inlinePopover.locator('[data-item-name="convert-to"]');

      await expect(convertToButton).toBeVisible();
      await expect(convertToButton).toHaveCount(1);
      await convertToButton.click();

      const nestedPopover = page.locator(`${INLINE_TOOLBAR_SELECTOR} .ce-popover--nested`);

      await expect(nestedPopover).toHaveCount(1);

      const nestedPopoverContainer = nestedPopover.locator('.ce-popover__container');

      await expect(nestedPopoverContainer).toHaveCount(1);
      await expect(nestedPopoverContainer).toBeVisible();

      const searchInput = nestedPopover.getByRole('searchbox', { name: uiDictionary.popover.Filter });

      await expect(searchInput).toHaveCount(1);
      await expect(searchInput).toBeVisible();

      const placeholder = await searchInput.getAttribute('placeholder');

      expect(placeholder).toContain(uiDictionary.popover.Filter);

      await searchInput.fill('nonexistent12345');
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for search results
      await page.waitForTimeout(300);

      const nothingFoundMessage = nestedPopover.getByText(uiDictionary.popover['Nothing found']);

      await expect(nothingFoundMessage).toBeVisible();
    });
  });

  test.describe('ui toolbar toolbox', () => {
    test('should translate "Add" button tooltip', async ({ page }) => {
      const uiDictionary = {
        toolbar: {
          toolbox: {
            Add: 'Добавить',
          },
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            ui: uiDictionary,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      await expect(plusButton).toBeVisible();

      const tooltipText = await getTooltipText(page, plusButton);

      expect(tooltipText).toContain(uiDictionary.toolbar.toolbox.Add);
    });
  });

  test.describe('ui block tunes toggler', () => {
    test('should translate "Click to tune" tooltip', async ({ page }) => {
      const uiDictionary = {
        blockTunes: {
          toggler: {
            // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
            'Click to tune': 'Нажмите, чтобы настроить',
          },
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            ui: uiDictionary,
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

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();

      const settingsButton = page.locator(SETTINGS_BUTTON_SELECTOR);

      await expect(settingsButton).toBeVisible();

      const tooltipText = await getTooltipText(page, settingsButton);

      expect(tooltipText).toContain(uiDictionary.blockTunes.toggler['Click to tune']);
    });
  });

  test.describe('ui inline toolbar converter', () => {
    test('should translate "Convert to" label in inline toolbar', async ({ page }) => {
      const uiDictionary = {
        inlineToolbar: {
          converter: {
            // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
            'Convert to': 'Конвертировать в',
          },
        },
      };

      // Create a simple header tool in the browser context
      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for editor creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           * Creates a `SimpleHeader` instance with initial block data.
           *
           * @param root0 - Editor.js constructor arguments containing the block data.
           */
          constructor({ data }: { data: { text: string } }) {
            this.data = data;
          }

          /**
           *
           */
          public render(): HTMLHeadingElement {
            const element = document.createElement('h1');

            element.contentEditable = 'true';
            element.innerHTML = this.data.text;

            return element;
          }

          /**
           * Persists the heading content to the Editor.js data format.
           *
           * @param element - Heading element that contains the current block content.
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
          public static get toolbox(): { title: string; icon: string } {
            return {
              title: 'Heading',
              icon: '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"/></svg>',
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
        };
      });

      // Create editor with header tool
      await resetEditor(page);
      await page.evaluate(
        async ({ holderId, uiDict }) => {
          // @ts-expect-error - Get SimpleHeader from window
          const SimpleHeader = window.SimpleHeader;

          const editor = new window.EditorJS({
            holder: holderId,
            tools: {
              header: SimpleHeader,
            },
            i18n: {
              messages: {
                ui: uiDict,
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

          window.editorInstance = editor;
          await editor.isReady;
        },
        { holderId: HOLDER_ID,
          uiDict: uiDictionary }
      );

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await expect(paragraph).toHaveCount(1);

      await selectText(paragraph, 'Some text');

      // Wait for inline toolbar to appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for UI animation
      await page.waitForTimeout(200);

      const inlinePopover = await openInlineToolbarPopover(page);

      // Look for "Convert to" button/item in inline toolbar
      const convertToButton = inlinePopover.locator('[data-item-name="convert-to"]');

      await expect(convertToButton).toHaveCount(1);
      const convertToTooltip = await getTooltipText(page, convertToButton);

      expect(convertToTooltip).toContain(uiDictionary.inlineToolbar.converter['Convert to']);
    });
  });

  test.describe('tools translations', () => {
    test('should translate "Add a link" placeholder for link tool', async ({ page }) => {
      const toolsDictionary = {
        link: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
          'Add a link': 'Вставьте ссылку',
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            tools: toolsDictionary,
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

      // Wait for inline toolbar to appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for UI animation
      await page.waitForTimeout(200);

      // Trigger link tool (Ctrl+K or Cmd+K)
      await page.keyboard.press(`${MODIFIER_KEY}+k`);

      // Wait for link input to appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for UI animation
      await page.waitForTimeout(200);

      const linkInput = page.locator('input[data-link-tool-input-opened], input[placeholder*="link" i]');

      await expect(linkInput).toBeVisible();

      const placeholder = await linkInput.getAttribute('placeholder');

      expect(placeholder).toContain(toolsDictionary.link['Add a link']);
    });

    test('should translate stub tool message', async ({ page }) => {
      const toolsDictionary = {
        stub: {
          // eslint-disable-next-line @typescript-eslint/naming-convention -- Dictionary keys must match i18n structure
          'The block can not be displayed correctly.': 'Блок не может быть отображен корректно.',
        },
      };

      await createEditorWithI18n(page, {
        i18n: {
          messages: {
            tools: toolsDictionary,
          },
        },
        data: {
          blocks: [
            {
              type: 'unknown-tool-type',
              data: {},
            },
          ],
        },
      });

      // Stub block should be rendered with translated message
      const stubMessage = page.locator(`text=${toolsDictionary.stub['The block can not be displayed correctly.']}`);

      await expect(stubMessage).toBeVisible();
    });
  });

  test.describe('inline toolbar', () => {
    test('should translate tool name in Convert To', async ({ page }) => {
      const toolNamesDictionary = {
        Heading: 'Заголовок',
      };

      // Create a simple header tool in the browser context
      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for editor creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           * Creates a `SimpleHeader` instance with initial block data.
           *
           * @param root0 - Editor.js constructor arguments containing the block data.
           */
          constructor({ data }: { data: { text: string } }) {
            this.data = data;
          }

          /**
           *
           */
          public render(): HTMLHeadingElement {
            const element = document.createElement('h1');

            element.contentEditable = 'true';
            element.innerHTML = this.data.text;

            return element;
          }

          /**
           * Persists the heading content to the Editor.js data format.
           *
           * @param element - Heading element that contains the current block content.
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
          public static get toolbox(): { title: string; icon: string } {
            return {
              title: 'Heading',
              icon: '<svg width="17" height="15" viewBox="0 0 336 276" xmlns="http://www.w3.org/2000/svg"><path d="M291 150V79c0-19-15-34-34-34H79c-19 0-34 15-34 34v42l67-44 81 72 56-29 42 30zm0 52l-43-30-56 30-81-67-66 39v23c0 19 15 34 34 34h178c17 0 31-13 34-29zM79 0h178c44 0 79 35 79 79v118c0 44-35 79-79 79H79c-44 0-79-35-79-79V79C0 35 35 0 79 0z"/></svg>',
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
        };
      });

      await createEditorWithI18n(page, {
        tools: {
          header: 'SimpleHeader',
        },
        i18n: {
          messages: {
            toolNames: toolNamesDictionary,
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

      // Open Inline Toolbar
      await selectText(paragraph, 'Some text');

      // Wait for inline toolbar to appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for UI animation
      await page.waitForTimeout(200);

      const inlinePopover = await openInlineToolbarPopover(page);

      // Open "Convert to" menu
      const convertToButton = inlinePopover.locator('[data-item-name="convert-to"]');

      await expect(convertToButton).toBeVisible();
      await convertToButton.click();

      // Check item in convert to menu is internationalized
      const nestedPopover = page.locator(`${INLINE_TOOLBAR_SELECTOR} .ce-popover--nested`);

      await expect(nestedPopover).toHaveCount(1);

      const headerItem = nestedPopover.locator('[data-item-name="header"]');

      await expect(headerItem).toHaveCount(1);
      await expect(headerItem).toBeVisible();
      await expect(headerItem).toContainText(toolNamesDictionary.Heading);
    });
  });
});

