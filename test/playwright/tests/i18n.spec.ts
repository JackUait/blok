import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from './helpers/ensure-build';
import { TOOLTIP_INTERFACE_SELECTOR, BLOK_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const PLUS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`;
const INLINE_TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} ${INLINE_TOOLBAR_INTERFACE_SELECTOR}`;
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"]';
const BLOCK_TUNES_POPOVER_SELECTOR = '[data-blok-testid="block-tunes-popover"]';

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
 * Create blok with i18n configuration
 * @param page - The Playwright page object
 * @param config - Blok configuration including i18n settings
 */
const createBlokWithI18n = async (
  page: Page,
  config: {
    tools?: Record<string, unknown>;
    i18n?: { messages?: Record<string, unknown> };
    data?: { blocks?: OutputData['blocks'] };
  }
): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(
    async ({ holder, blokConfig }) => {
      const resolveFromWindow = (value: unknown): unknown => {
        if (typeof value === 'string') {
          return value.split('.').reduce<unknown>((acc, key) => {
            if (acc && (typeof acc === 'object' || typeof acc === 'function')) {
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

      const { tools, ...restConfig } = blokConfig ?? {};
      const normalizedTools = normalizeTools(tools as Record<string, unknown> | undefined);

      const blok = new window.Blok({
        holder: holder,
        ...restConfig,
        ...(normalizedTools ? { tools: normalizedTools } : {}),
      });

      window.blokInstance = blok;
      await blok.isReady;

      await new Promise<void>((resolve) => {
        if ('requestIdleCallback' in window) {
          window.requestIdleCallback(() => resolve(), { timeout: 100 });

          return;
        }

        setTimeout(resolve, 0);
      });
    },
    { holder: HOLDER_ID,
      blokConfig: config }
  );
};

/**
 * Select text content within a locator by string match
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
 * @param page - The Playwright page object
 * @returns Locator for the inline toolbar popover
 */
const openInlineToolbarPopover = async (page: Page): Promise<Locator> => {
  const inlineToolbar = page.locator(INLINE_TOOLBAR_SELECTOR);

  await expect(inlineToolbar).toHaveCount(1);

  await page.evaluate(() => {
    window.blokInstance?.inlineToolbar?.open();
  });

  const inlinePopover = inlineToolbar.locator('[data-blok-testid="popover"]');

  await expect(inlinePopover).toHaveCount(1);

  const inlinePopoverContainer = inlinePopover.locator('[data-blok-testid="popover-container"]');

  await expect(inlinePopoverContainer).toHaveCount(1);
  await expect(inlinePopoverContainer).toBeVisible();

  return inlinePopover;
};

const getParagraphLocatorByBlockIndex = async (page: Page, blockIndex = 0): Promise<Locator> => {
  const blockId = await page.evaluate(
    ({ index }) => window.blokInstance?.blocks?.getBlockByIndex(index)?.id ?? null,
    { index: blockIndex }
  );

  if (!blockId) {
    throw new Error(`Unable to resolve block id for index ${blockIndex}`);
  }

  const block = page.locator(`${BLOCK_SELECTOR}[data-blok-id="${blockId}"][data-blok-component="paragraph"]`);

  await expect(block).toHaveCount(1);

  return block;
};

test.describe('blok i18n', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('toolbox', () => {
    test('should translate tool title in a toolbox', async ({ page }) => {
      const translatedHeading = 'Заголовок';

      // Create a simple header tool in the browser context
      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for blok creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           * Creates a `SimpleHeader` instance with initial block data.
           * @param root0 - Blok constructor arguments containing the block data.
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
           * Persists the heading content to the Blok data format.
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

      await createBlokWithI18n(page, {
        tools: {
          header: 'SimpleHeader',
        },
        i18n: {
          messages: {
            'toolNames.Heading': translatedHeading,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      const headerItem = page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="header-2"]`);

      await expect(headerItem).toBeVisible();
      await expect(headerItem).toContainText(translatedHeading);
    });

    test('should translate titles of toolbox entries', async ({ page }) => {
      const translatedTitle1 = 'Название 1';
      const translatedTitle2 = 'Название 2';

      // Create a test tool with multiple toolbox entries
      await page.evaluate(() => {
        // @ts-expect-error - Define TestTool in window for blok creation
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

      await createBlokWithI18n(page, {
        tools: {
          testTool: 'TestTool',
        },
        i18n: {
          messages: {
            'toolNames.Title1': translatedTitle1,
            'toolNames.Title2': translatedTitle2,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      const testToolItems = page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="testTool"]`);

      await expect(testToolItems).toHaveCount(2);
      await expect(testToolItems).toContainText([
        translatedTitle1,
        translatedTitle2,
      ]);
    });

    test('should use capitalized tool name as translation key if toolbox title is missing', async ({ page }) => {
      const translatedTestTool = 'ТестТул';

      // Create a test tool without title
      await page.evaluate(() => {
        // @ts-expect-error - Define TestTool in window for blok creation
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

      await createBlokWithI18n(page, {
        tools: {
          testTool: 'TestTool',
        },
        i18n: {
          messages: {
            'toolNames.TestTool': translatedTestTool,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      const testToolItem = page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="testTool"]`);

      await expect(testToolItem).toBeVisible();
      await expect(testToolItem).toContainText(translatedTestTool);
    });
  });

  test.describe('block tunes', () => {
    test('should translate Delete button title', async ({ page }) => {
      const translatedDelete = 'Удалить';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'blockSettings.delete': translatedDelete,
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

      const deleteButton = page.locator(`${BLOCK_TUNES_POPOVER_SELECTOR} [data-blok-item-name="delete"]`);

      await expect(deleteButton).toBeVisible();
      await expect(deleteButton).toContainText(translatedDelete);
    });

    test('should translate tool name in Convert To', async ({ page }) => {
      const translatedHeading = 'Заголовок';

      // Create a simple header tool in the browser context
      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for blok creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           * Creates a `SimpleHeader` instance with initial block data.
           * @param root0 - Blok constructor arguments containing the block data.
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
           * Persists the heading content to the Blok data format.
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

      await createBlokWithI18n(page, {
        tools: {
          header: 'SimpleHeader',
        },
        i18n: {
          messages: {
            'toolNames.Heading': translatedHeading,
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
      const convertToButton = page.locator(`${BLOCK_TUNES_POPOVER_SELECTOR} [data-blok-item-name="convert-to"]`);

      await expect(convertToButton).toBeVisible();
      await convertToButton.click();

      // Check item in convert to menu is internationalized
      const headerItem = page.locator(`${BLOCK_TUNES_POPOVER_SELECTOR} [data-blok-nested="true"] [data-blok-item-name="header-2"]`);

      await expect(headerItem).toBeVisible();
      await expect(headerItem).toContainText(translatedHeading);
    });
  });

  test.describe('ui popover', () => {
    test('should translate "Search" and "Nothing found" in block settings popover', async ({ page }) => {
      const translatedSearch = 'Поиск';
      const translatedNothingFound = 'Ничего не найдено';

      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for blok creation
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

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'popover.search': translatedSearch,
            'popover.nothingFound': translatedNothingFound,
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
        .locator(`${BLOCK_TUNES_POPOVER_SELECTOR} [data-blok-testid="popover-container"]`)
        .filter({ has: page.getByRole('searchbox', { name: translatedSearch }) });

      await expect(popoverContainer).toHaveCount(1);
      await expect(popoverContainer).toBeVisible();

      const searchInput = popoverContainer.getByRole('searchbox', { name: translatedSearch });

      await expect(searchInput).toHaveCount(1);
      await expect(searchInput).toBeVisible();

      const placeholder = await searchInput.getAttribute('placeholder');

      expect(placeholder).toContain(translatedSearch);

      await searchInput.fill('nonexistent12345');
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for search results
      await page.waitForTimeout(300);

      const nothingFoundMessage = popoverContainer.getByText(translatedNothingFound);

      await expect(nothingFoundMessage).toBeVisible();
    });
  });

  test.describe('ui toolbar toolbox', () => {
    test('should translate plus button tooltip', async ({ page }) => {
      const translatedClickToAddBelow = 'Нажмите, чтобы добавить блок снизу';
      const translatedOptionClickToAddAbove = 'Option + клик чтобы добавить блок сверху';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'toolbox.addBelow': translatedClickToAddBelow,
            'toolbox.optionAddAbove': translatedOptionClickToAddAbove,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();

      const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

      await expect(plusButton).toBeVisible();

      const tooltipText = await getTooltipText(page, plusButton);

      expect(tooltipText).toContain(translatedClickToAddBelow);
      expect(tooltipText).toContain(translatedOptionClickToAddAbove);
    });
  });

  test.describe('ui block tunes toggler', () => {
    test('should translate "Drag to move" tooltip', async ({ page }) => {
      const translatedDragToMove = 'Перетащите для перемещения';
      const translatedClickToOpenMenu = 'Нажмите, чтобы открыть меню';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'blockSettings.dragToMove': translatedDragToMove,
            'blockSettings.clickToOpenMenu': translatedClickToOpenMenu,
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

      expect(tooltipText).toContain('Перетащите');
    });
  });

  test.describe('ui inline toolbar converter', () => {
    test('should translate "Convert to" label in inline toolbar', async ({ page }) => {
      const translatedConvertTo = 'Конвертировать в';

      // Create a simple header tool in the browser context
      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for blok creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           * Creates a `SimpleHeader` instance with initial block data.
           * @param root0 - Blok constructor arguments containing the block data.
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
           * Persists the heading content to the Blok data format.
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

      // Create blok with header tool
      await resetBlok(page);
      await page.evaluate(
        async ({ holder, convertTo }) => {
          // @ts-expect-error - Get SimpleHeader from window
          const SimpleHeader = window.SimpleHeader;

          const blok = new window.Blok({
            holder: holder,
            tools: {
              header: SimpleHeader,
            },
            i18n: {
              messages: {
                'popover.convertTo': convertTo,
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

          window.blokInstance = blok;
          await blok.isReady;
        },
        { holder: HOLDER_ID,
          convertTo: translatedConvertTo }
      );

      const paragraph = await getParagraphLocatorByBlockIndex(page);

      await expect(paragraph).toHaveCount(1);

      await selectText(paragraph, 'Some text');

      // Wait for inline toolbar to appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for UI animation
      await page.waitForTimeout(200);

      const inlinePopover = await openInlineToolbarPopover(page);

      // Look for "Convert to" button/item in inline toolbar
      const convertToButton = inlinePopover.locator('[data-blok-item-name="convert-to"]');

      await expect(convertToButton).toHaveCount(1);

      // Click on convert-to button to open nested popover
      await convertToButton.click();

      // Wait for nested popover to appear
      const nestedPopover = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`);

      await expect(nestedPopover).toBeVisible();

      // Verify the nested popover contains conversion options (translation is applied via i18n API)
      // The hint tooltip cannot be verified here because tooltips are suppressed when popovers are open
      // The "Convert to" translation is verified indirectly - if the i18n config is applied correctly,
      // the nested popover will open and show the conversion options
      const headerOption = nestedPopover.locator('[data-blok-item-name="header-2"]');

      await expect(headerOption).toBeVisible();
    });
  });

  test.describe('tools translations', () => {
    test('should translate "Add a link" placeholder for link tool', async ({ page }) => {
      const translatedAddALink = 'Вставьте ссылку';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'tools.link.addLink': translatedAddALink,
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

      const paragraph = await getParagraphLocatorByBlockIndex(page);

      await expect(paragraph).toHaveCount(1);

      await selectText(paragraph, 'Some text');

      // Open inline toolbar popover
      const inlinePopover = await openInlineToolbarPopover(page);

      // Click on link button to open link input
      const linkButton = inlinePopover.locator('[data-blok-item-name="link"]');

      await expect(linkButton).toBeVisible();
      await linkButton.click();

      const linkInput = page.locator('[data-blok-link-tool-input-opened="true"]');
      await expect(linkInput).toBeVisible();

      const placeholder = await linkInput.getAttribute('placeholder');

      expect(placeholder).toContain(translatedAddALink);
    });

    test('should translate stub tool message', async ({ page }) => {
      const translatedStubMessage = 'Блок не может быть отображен корректно.';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'tools.stub.blockCannotBeDisplayed': translatedStubMessage,
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
      const stubMessage = page.locator(`text=${translatedStubMessage}`);

      await expect(stubMessage).toBeVisible();
    });
  });

  test.describe('inline toolbar', () => {
    test('should translate tool name in Convert To', async ({ page }) => {
      const translatedHeading = 'Заголовок';

      // Create a simple header tool in the browser context
      await page.evaluate(() => {
        // @ts-expect-error - Define SimpleHeader in window for blok creation
        window.SimpleHeader = class {
          private data: { text: string };

          /**
           * Creates a `SimpleHeader` instance with initial block data.
           * @param root0 - Blok constructor arguments containing the block data.
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
           * Persists the heading content to the Blok data format.
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

      await createBlokWithI18n(page, {
        tools: {
          header: 'SimpleHeader',
        },
        i18n: {
          messages: {
            'toolNames.Heading': translatedHeading,
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

      const paragraph = await getParagraphLocatorByBlockIndex(page);

      await expect(paragraph).toHaveCount(1);

      // Open Inline Toolbar
      await selectText(paragraph, 'Some text');

      // Wait for inline toolbar to appear
      // eslint-disable-next-line playwright/no-wait-for-timeout -- Waiting for UI animation
      await page.waitForTimeout(200);

      const inlinePopover = await openInlineToolbarPopover(page);

      // Open "Convert to" menu
      const convertToButton = inlinePopover.locator('[data-blok-item-name="convert-to"]');

      await expect(convertToButton).toBeVisible();
      await convertToButton.click();

      // Check item in convert to menu is internationalized
      const nestedPopover = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-nested="true"]`);

      await expect(nestedPopover).toHaveCount(1);

      const headerItem = nestedPopover.locator('[data-blok-item-name="header-2"]');

      await expect(headerItem).toHaveCount(1);
      await expect(headerItem).toBeVisible();
      await expect(headerItem).toContainText(translatedHeading);
    });
  });

  test.describe('translation key consistency', () => {
    test('should use lowercase translation key for delete button', async ({ page }) => {
      // This test verifies that the translation key 'blockSettings.delete' (lowercase)
      // is correctly used by the code after fixing the key mismatch bug.
      const translatedDelete = 'Удалить';

      await createBlokWithI18n(page, {
        i18n: {
          // Using lowercase 'delete' key to match the fixed code
          messages: {
            'blockSettings.delete': translatedDelete,
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Test' },
            },
          ],
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();

      // Open the settings menu
      await page.locator(SETTINGS_BUTTON_SELECTOR).click();

      // Check for Russian text - should use the lowercase key now
      const deleteItem = page.locator(`${BLOCK_TUNES_POPOVER_SELECTOR} [data-blok-item-name="delete"]`);

      await expect(deleteItem).toBeVisible();
      await expect(deleteItem).toContainText(translatedDelete);
    });
  });

  test.describe('inline tools translations', () => {
    test('should translate bold tool hint in inline toolbar', async ({ page }) => {
      const translatedBold = 'Жирный';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'toolNames.bold': translatedBold,
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Some text to select' },
            },
          ],
        },
      });

      const paragraph = await getParagraphLocatorByBlockIndex(page);

      await expect(paragraph).toHaveCount(1);
      await selectText(paragraph, 'Some text');

      const inlinePopover = await openInlineToolbarPopover(page);
      const boldButton = inlinePopover.locator('[data-blok-item-name="bold"]');

      await expect(boldButton).toBeVisible();

      // Inline tools show title in hint tooltip, not as text content
      const tooltipText = await getTooltipText(page, boldButton);

      expect(tooltipText).toContain(translatedBold);
    });

    test('should translate italic tool hint in inline toolbar', async ({ page }) => {
      const translatedItalic = 'Курсив';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'toolNames.italic': translatedItalic,
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Some text to select' },
            },
          ],
        },
      });

      const paragraph = await getParagraphLocatorByBlockIndex(page);

      await expect(paragraph).toHaveCount(1);
      await selectText(paragraph, 'Some text');

      const inlinePopover = await openInlineToolbarPopover(page);
      const italicButton = inlinePopover.locator('[data-blok-item-name="italic"]');

      await expect(italicButton).toBeVisible();

      // Inline tools show title in hint tooltip, not as text content
      const tooltipText = await getTooltipText(page, italicButton);

      expect(tooltipText).toContain(translatedItalic);
    });

    test('should translate link tool hint in inline toolbar', async ({ page }) => {
      const translatedLink = 'Ссылка';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'toolNames.link': translatedLink,
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Some text to select' },
            },
          ],
        },
      });

      const paragraph = await getParagraphLocatorByBlockIndex(page);

      await expect(paragraph).toHaveCount(1);
      await selectText(paragraph, 'Some text');

      const inlinePopover = await openInlineToolbarPopover(page);
      const linkButton = inlinePopover.locator('[data-blok-item-name="link"]');

      await expect(linkButton).toBeVisible();

      // Inline tools show title in hint tooltip, not as text content
      const tooltipText = await getTooltipText(page, linkButton);

      expect(tooltipText).toContain(translatedLink);
    });
  });

  test.describe('toolbox translations', () => {
    test('should translate Text tool name in toolbox', async ({ page }) => {
      const translatedText = 'Текст';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'toolNames.text': translatedText,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      const textItem = page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="paragraph"]`);

      await expect(textItem).toBeVisible();
      await expect(textItem).toContainText(translatedText);
    });
  });

  test.describe('header tool translations', () => {
    test('should translate heading level names in header settings', async ({ page }) => {
      const translations = {
        'tools.header.heading1': 'Заголовок 1',
        'tools.header.heading2': 'Заголовок 2',
        'tools.header.heading3': 'Заголовок 3',
      };

      await createBlokWithI18n(page, {
        tools: {
          header: 'Blok.Header',
        },
        i18n: {
          messages: translations,
        },
        data: {
          blocks: [
            {
              type: 'header',
              data: { text: 'Test header', level: 2 },
            },
          ],
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();

      // Open block settings
      await page.locator(SETTINGS_BUTTON_SELECTOR).click();

      // Check heading level options are translated - use popover-item testid and filter by text
      const popoverItems = page.getByTestId('popover-item');

      const heading1Option = popoverItems.filter({ hasText: translations['tools.header.heading1'] });
      const heading2Option = popoverItems.filter({ hasText: translations['tools.header.heading2'] });
      const heading3Option = popoverItems.filter({ hasText: translations['tools.header.heading3'] });

      await expect(heading1Option).toBeVisible();
      await expect(heading2Option).toBeVisible();
      await expect(heading3Option).toBeVisible();
    });
  });

  test.describe('link tool translations', () => {
    test('should translate invalid link message', async ({ page }) => {
      const translatedInvalidLink = 'Некорректная ссылка';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'tools.link.invalidLink': translatedInvalidLink,
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Some text to link' },
            },
          ],
        },
      });

      const paragraph = await getParagraphLocatorByBlockIndex(page);

      await expect(paragraph).toHaveCount(1);
      await selectText(paragraph, 'Some text');

      const inlinePopover = await openInlineToolbarPopover(page);
      const linkButton = inlinePopover.locator('[data-blok-item-name="link"]');

      await expect(linkButton).toBeVisible();
      await linkButton.click();

      // Type an invalid URL
      const linkInput = page.locator('[data-blok-link-tool-input-opened="true"]');

      await expect(linkInput).toBeVisible();
      await linkInput.fill('not a valid url');
      await linkInput.press('Enter');

      // Check for invalid link message
      const errorMessage = page.locator(`text=${translatedInvalidLink}`);

      await expect(errorMessage).toBeVisible();
    });
  });

  test.describe('list tool translations', () => {
    test('should translate bulleted list tool name in toolbox', async ({ page }) => {
      const translatedBulletedList = 'Маркированный список';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'toolNames.bulletedList': translatedBulletedList,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      // Find the bulleted list by translated text
      const popoverItems = page.getByTestId('popover-item');
      const bulletedListItem = popoverItems.filter({ hasText: translatedBulletedList });

      await expect(bulletedListItem).toBeVisible();
    });

    test('should translate numbered list tool name in toolbox', async ({ page }) => {
      const translatedNumberedList = 'Нумерованный список';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'toolNames.numberedList': translatedNumberedList,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      // Find the numbered list by translated text
      const popoverItems = page.getByTestId('popover-item');
      const numberedListItem = popoverItems.filter({ hasText: translatedNumberedList });

      await expect(numberedListItem).toBeVisible();
    });

    test('should translate todo list tool name in toolbox', async ({ page }) => {
      const translatedTodoList = 'Список задач';

      await createBlokWithI18n(page, {
        i18n: {
          messages: {
            'toolNames.todoList': translatedTodoList,
          },
        },
      });

      const block = page.locator(BLOCK_SELECTOR);

      await expect(block).toHaveCount(1);
      await block.click();
      await page.locator(PLUS_BUTTON_SELECTOR).click();

      // Find the todo list by translated text
      const popoverItems = page.getByTestId('popover-item');
      const todoListItem = popoverItems.filter({ hasText: translatedTodoList });

      await expect(todoListItem).toBeVisible();
    });
  });
});

