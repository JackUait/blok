import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OutputData } from '@/types';
import { PopoverItemType } from '@/types/utils/popover/popover-item-type';
import type { BlockToolConstructable } from '@/types/tools';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;


const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const BLOCK_TUNES_SELECTOR = '[data-blok-testid="block-tunes-popover"]';
const SETTINGS_BUTTON_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="settings-toggler"]`;
const POPOVER_CONTAINER_SELECTOR = `${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"]`;

interface SerializableMenuChildren {
  searchable?: boolean;
  isOpen?: boolean;
  isFlippable?: boolean;
  items: SerializableMenuItem[];
}

interface SerializableMenuItemBase {
  icon?: string;
  title?: string;
  label?: string;
  secondaryLabel?: string;
  name?: string;
  toggle?: boolean | string;
  closeOnActivate?: boolean;
  isActive?: boolean;
  isDisabled?: boolean;
  type?: PopoverItemType.Default;
  confirmation?: SerializableMenuItemBase;
}

type SerializableMenuSeparator = {
  type: PopoverItemType.Separator;
};

type SerializableMenuItem =
  | (SerializableMenuItemBase & { children?: undefined })
  | (SerializableMenuItemBase & { children?: SerializableMenuChildren })
  | SerializableMenuSeparator;

type SerializableMenuConfig = SerializableMenuItem | SerializableMenuItem[];

interface SerializableToolConfig {
  menu: SerializableMenuConfig | { render: () => HTMLElement };
  isTune?: boolean;
}

interface GlobalToolConfig {
  fromGlobal: string;
  config?: Record<string, unknown>;
  isTune?: boolean;
  [key: string]: unknown;
}

type SerializableToolsConfig = Record<string, SerializableToolConfig>;
type ToolConfigInput =
  | SerializableToolConfig
  | BlockToolConstructable
  | { class: BlockToolConstructable }
  | GlobalToolConfig;
type ToolsConfigInput = Record<string, ToolConfigInput>;

const buildTestToolsConfig = (
  menu: SerializableMenuConfig,
  options: Omit<SerializableToolConfig, 'menu'> = {}
): SerializableToolsConfig => ({
  testTool: {
    menu,
    ...options,
  },
});

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
 * Create blok with provided blocks and optional tools/tunes
 * @param page - The Playwright page object
 * @param blocks - The blocks data to initialize the blok with
 * @param tools - Optional tools configuration (can be SerializableToolsConfig or tool classes)
 * @param tunes - Optional tunes configuration
 */
const createBlokWithBlocks = async (
  page: Page,
  blocks: OutputData['blocks'],
  tools?: SerializableToolsConfig | ToolsConfigInput,
  tunes?: string[]
): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(
    async ({ holder, blokBlocks, blokTools, blokTunes, PopoverItemTypeValues }) => {

      const testWindow = window as typeof window & Record<string, any>;

      testWindow.edjsTestActivations = [];

      const recordActivation = (itemName?: unknown): void => {
        if (typeof itemName !== 'string' || itemName.length === 0) {
          return;
        }

        if (!Array.isArray(testWindow.edjsTestActivations)) {
          testWindow.edjsTestActivations = [];
        }

        testWindow.edjsTestActivations.push(itemName);
      };

      const mapMenuItem = (item: SerializableMenuItem): unknown => {
        if (item.type === PopoverItemTypeValues.Separator) {
          return { type: PopoverItemTypeValues.Separator };
        }

        const itemWithChildren = item as SerializableMenuItemBase & { children?: SerializableMenuChildren };
        const { children, confirmation, ...rest } = itemWithChildren;

        const mappedItem: Record<string, unknown> = {
          ...rest,
          type: rest.type ?? PopoverItemTypeValues.Default,
        };

        const itemName = typeof rest.name === 'string' ? rest.name : undefined;
        const confirmationName = confirmation && typeof confirmation.name === 'string'
          ? confirmation.name
          : itemName;

        if (children) {
          mappedItem.children = {
            ...children,
            items: children.items.map((child: SerializableMenuItem) => mapMenuItem(child)),
          };
        }

        if (confirmation) {
          mappedItem.confirmation = {
            ...confirmation,
            type: confirmation.type ?? PopoverItemTypeValues.Default,
            onActivate: (): void => {
              recordActivation(confirmationName);
            },
          };
        }

        if (!children && !confirmation && typeof mappedItem.onActivate !== 'function') {
          mappedItem.onActivate = (): void => {
            recordActivation(itemName);
          };
        }

        return mappedItem;
      };

      const buildMenu = (menu: SerializableMenuConfig): unknown => {
        if (Array.isArray(menu)) {
          return menu.map((menuItem) => mapMenuItem(menuItem));
        }

        return mapMenuItem(menu);
      };

      const buildTools = (
        toolsConfig?: SerializableToolsConfig | ToolsConfigInput
      ): Record<string, unknown> | undefined => {
        if (!toolsConfig) {
          return undefined;
        }

        const toolEntries = Object.entries(toolsConfig).map(([toolName, toolConfig]) => {
          // Check if toolConfig is a tool class directly (not SerializableToolConfig)
          if (typeof toolConfig === 'function' || (typeof toolConfig === 'object' && toolConfig !== null && 'class' in toolConfig)) {
            return [toolName, typeof toolConfig === 'function' ? { class: toolConfig } : toolConfig] as const;
          }

          if (typeof toolConfig === 'object' && toolConfig !== null && 'fromGlobal' in toolConfig) {
            const { fromGlobal, config, ...rest } = toolConfig as GlobalToolConfig;

            // Handle dot notation (e.g., 'Blok.Header')
            const globalTool = fromGlobal.split('.').reduce(
              (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
              window
            );

            if (globalTool === undefined || globalTool === null) {
              throw new Error(`Global tool "${fromGlobal}" is not available on window.`);
            }

            if (typeof globalTool === 'function') {
              return [
                toolName,
                {
                  class: globalTool,
                  ...(config !== undefined ? { config } : {}),
                  ...rest,
                },
              ] as const;
            }

            if (typeof globalTool === 'object') {
              return [
                toolName,
                {
                  ...globalTool,
                  ...rest,
                },
              ] as const;
            }

            throw new Error(`Global tool "${fromGlobal}" must be a function or object.`);
          }

          const { menu, isTune } = toolConfig as SerializableToolConfig;

          // Check if menu is a function (for HTML render)
          if (typeof menu === 'object' && menu !== null && 'render' in menu && typeof (menu as { render: unknown }).render === 'function') {
            const DynamicTune = class {
              /**
               *
               */
              public render(): HTMLElement {
                return (menu as { render: () => HTMLElement }).render();
              }
            };

            Object.defineProperty(DynamicTune, 'isTune', {
              value: isTune ?? true,
              configurable: true,
            });

            (DynamicTune as unknown as { isTune: boolean }).isTune = isTune ?? true;

            return [toolName, { class: DynamicTune } ] as const;
          }

          const DynamicTune = class {
            /**
             *
             */
            public render(): unknown {
              const builtMenu = buildMenu(menu as SerializableMenuConfig);

              return builtMenu;
            }
          };

          Object.defineProperty(DynamicTune, 'isTune', {
            value: isTune ?? true,
            configurable: true,
          });

          (DynamicTune as unknown as { isTune: boolean }).isTune = isTune ?? true;

          return [toolName, { class: DynamicTune } ] as const;
        });

        return Object.fromEntries(toolEntries);
      };

      // Automatically add tool names to tunes list if they're tunes
      // For direct tool classes, we can't determine if they're tunes, so skip auto-detection
      const toolNames = blokTools && !Object.values(blokTools).some(tool => {
        if (typeof tool === 'function') {
          return true;
        }

        if (typeof tool === 'object' && tool !== null) {
          return 'class' in tool || 'fromGlobal' in (tool as { fromGlobal?: unknown });
        }

        return false;
      })
        ? Object.keys(blokTools)
        : [];
      let tunesList: string[] | undefined;

      if (blokTunes && blokTunes.length > 0) {
        tunesList = [ ...new Set([...blokTunes, ...toolNames]) ];
      } else if (toolNames.length > 0) {
        tunesList = toolNames;
      }
      const toolsOption = buildTools(blokTools);

      const blok = new window.Blok({
        holder: holder,
        data: { blocks: blokBlocks },
        ...(toolsOption && { tools: toolsOption }),
        ...(tunesList && { tunes: tunesList }),
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokBlocks: blocks,
      blokTools: tools,
      blokTunes: tunes,
      PopoverItemTypeValues: {
        Default: PopoverItemType.Default,
        Separator: PopoverItemType.Separator,
        Html: PopoverItemType.Html,
      },
    }
  );
};

const waitForBlockTunesPopover = async (page: Page, timeout = 5000): Promise<void> => {
  await page.locator(BLOCK_TUNES_SELECTOR).waitFor({
    state: 'attached',
    timeout,
  });
  await expect(page.locator(POPOVER_CONTAINER_SELECTOR)).toBeVisible({ timeout });
};

/**
 * Select text content within a locator by character positions
 * @param locator - The Playwright locator for the element containing the text
 * @param start - Start position (character index)
 * @param end - End position (character index)
 */
const selectTextByRange = async (locator: Locator, start: number, end: number): Promise<void> => {
  await locator.evaluate((element, { start: startPos, end: endPos }) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Node[] = [];

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    if (textNodes.length === 0) {
      throw new Error('No text nodes found in element');
    }

    let currentPos = 0;
    let startNode: Node | null = null;
    let endNode: Node | null = null;
    let startOffset = 0;
    let endOffset = 0;

    for (const node of textNodes) {
      const textContent = node.textContent ?? '';
      const nodeLength = textContent.length;

      if (!startNode && currentPos + nodeLength > startPos) {
        startNode = node;
        startOffset = startPos - currentPos;
      }

      if (!endNode && currentPos + nodeLength >= endPos) {
        endNode = node;
        endOffset = endPos - currentPos;
        break;
      }

      currentPos += nodeLength;
    }

    if (!startNode || !endNode) {
      throw new Error(`Could not find text range from ${startPos} to ${endPos}`);
    }

    const range = element.ownerDocument.createRange();

    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    const selection = element.ownerDocument.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  }, {
    start,
    end,
  });
};

/**
 * Open block tunes popover
 * @param page - The Playwright page object
 */
const openBlockTunes = async (page: Page): Promise<void> => {
  const block = page.locator(BLOCK_SELECTOR);

  await block.click();
  await page.locator(SETTINGS_BUTTON_SELECTOR).click();
  await waitForBlockTunesPopover(page);
};


test.describe('popover', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('should support confirmation chains', async ({ page }) => {
    const actionIcon = 'Icon 1';
    const actionTitle = 'Action';
    const confirmActionIcon = 'Icon 2';
    const confirmActionTitle = 'Confirm action';

    const confirmation: SerializableMenuItemBase = {
      icon: confirmActionIcon,
      title: confirmActionTitle,
    };

    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig({
        icon: actionIcon,
        title: actionTitle,
        name: 'testItem',
        confirmation,
      })
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Check initial icon and title
    await expect(page.locator('[data-blok-item-name=testItem] [data-blok-testid="popover-item-icon"]')).toHaveText(actionIcon);
    await expect(page.locator('[data-blok-item-name=testItem] [data-blok-testid="popover-item-title"]')).toHaveText(actionTitle);

    // First click on item
    await page.locator('[data-blok-item-name=testItem]').click();

    // Check icon has changed
    await expect(page.locator('[data-blok-item-name=testItem] [data-blok-testid="popover-item-icon"]')).toHaveText(confirmActionIcon);

    // Check label has changed
    await expect(page.locator('[data-blok-item-name=testItem] [data-blok-testid="popover-item-title"]')).toHaveText(confirmActionTitle);

    // Second click - confirmation callback should be called
    await page.locator('[data-blok-item-name=testItem]').click();
  });

  test('should render the items with true isActive property value as active', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig({
        icon: 'Icon',
        title: 'Title',
        isActive: true,
        name: 'testItem',
      })
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Check item has active class
    await expect(page.locator('[data-blok-item-name=testItem]')).toHaveAttribute('data-blok-popover-item-active', 'true');
  });

  test('should not execute item\'s onActivate callback if the item is disabled', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig({
        icon: 'Icon',
        title: 'Title',
        isDisabled: true,
        name: 'testItem',
      })
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Check item has disabled class
    await expect(page.locator('[data-blok-item-name=testItem]')).toHaveAttribute('data-blok-disabled', 'true');

    // Attempt to activate disabled item programmatically
    await page.evaluate(() => {
      const element = document.querySelector('[data-blok-item-name="testItem"]');

      element?.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }));
    });

    // Verify item remains disabled (onActivate should not be called)
    await expect(page.locator('[data-blok-item-name=testItem]')).toHaveAttribute('data-blok-disabled', 'true');

    const activations = await page.evaluate(() => {
      const globalWindow = window as typeof window & { edjsTestActivations?: string[] };

      return globalWindow.edjsTestActivations ?? [];
    });

    expect(activations).not.toContain('testItem');
  });

  test('should close once item with closeOnActivate property set to true is activated', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig({
        icon: 'Icon',
        title: 'Title',
        closeOnActivate: true,
        name: 'testItem',
      })
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Verify popover is visible
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"]`)).toBeVisible();

    // Click item with closeOnActivate
    await page.locator('[data-blok-item-name=testItem]').click();

    // Popover should be hidden
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"]`)).toBeHidden();
  });

  test('should highlight as active the item with toggle property set to true once activated', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig({
        icon: 'Icon',
        title: 'Title',
        toggle: true,
        name: 'testItem',
      })
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Item should not be active initially
    await expect(page.locator('[data-blok-item-name=testItem]')).not.toHaveAttribute('data-blok-popover-item-active', 'true');

    // Click item
    await page.locator('[data-blok-item-name=testItem]').click();

    // Check item has active class
    await expect(page.locator('[data-blok-item-name=testItem]')).toHaveAttribute('data-blok-popover-item-active', 'true');
  });

  test('should perform radiobutton-like behavior among the items that have toggle property value set to the same string value', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig([
        {
          icon: 'Icon 1',
          title: 'Title 1',
          toggle: 'group-name',
          name: 'testItem1',
          isActive: true,
        },
        {
          icon: 'Icon 2',
          title: 'Title 2',
          toggle: 'group-name',
          name: 'testItem2',
        },
      ])
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Check first item is active
    await expect(page.locator('[data-blok-item-name=testItem1]')).toHaveAttribute('data-blok-popover-item-active', 'true');

    // Check second item is not active
    await expect(page.locator('[data-blok-item-name=testItem2]')).not.toHaveAttribute('data-blok-popover-item-active', 'true');

    // Click second item
    await page.locator('[data-blok-item-name=testItem2]').click();

    // Check second item became active
    await expect(page.locator('[data-blok-item-name=testItem2]')).toHaveAttribute('data-blok-popover-item-active', 'true');

    // Check first item became not active
    await expect(page.locator('[data-blok-item-name=testItem1]')).not.toHaveAttribute('data-blok-popover-item-active', 'true');
  });

  test('should toggle item if it is the only item in toggle group', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig({
        icon: 'Icon',
        title: 'Title',
        toggle: 'key',
        name: 'testItem',
      })
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Item should not be active initially
    await expect(page.locator('[data-blok-item-name=testItem]')).not.toHaveAttribute('data-blok-popover-item-active', 'true');

    // Click item
    await page.locator('[data-blok-item-name=testItem]').click();

    // Check item has active class
    await expect(page.locator('[data-blok-item-name=testItem]')).toHaveAttribute('data-blok-popover-item-active', 'true');
  });

  test('should display item with custom html', async ({ page }) => {
    await resetBlok(page);
    await page.evaluate(
      async ({ holder }) => {
        /**
         *
         */
        class TestTune {
          public static isTune = true;

          /**
           *
           */
          public render(): HTMLElement {
            const button = document.createElement('button');

            button.setAttribute('data-blok-testid', 'settings-button');
            button.innerText = 'Tune';

            return button;
          }
        }

        const blok = new window.Blok({
          holder: holder,
          tools: {
            testTool: TestTune,
          },
          tunes: [ 'testTool' ],
          data: {
            blocks: [
              {
                type: 'paragraph',
                data: {
                  text: 'Hello',
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      },
      { holder: HOLDER_ID }
    );

    // Open block tunes menu
    await page.locator(BLOCK_SELECTOR)
      .click();
    await page.locator(SETTINGS_BUTTON_SELECTOR).click();
    await waitForBlockTunesPopover(page);

    // Check item with custom html content is displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-item-html"]`).filter({ hasText: 'Tune' })).toBeVisible();
  });

  test('should support flipping between custom content items', async ({ page }) => {
    await resetBlok(page);
    await page.evaluate(
      async ({ holder }) => {
        /**
         *
         */
        class TestTune1 {
          public static isTune = true;

          /**
           *
           */
          public render(): HTMLElement {
            const button = document.createElement('button');

            button.setAttribute('data-blok-testid', 'settings-button');
            button.innerText = 'Tune1';

            return button;
          }
        }

        /**
         *
         */
        class TestTune2 {
          public static isTune = true;

          /**
           *
           */
          public render(): HTMLElement {
            const button = document.createElement('button');

            button.setAttribute('data-blok-testid', 'settings-button');
            button.innerText = 'Tune2';

            return button;
          }
        }

        const blok = new window.Blok({
          holder: holder,
          tools: {
            testTool1: TestTune1,
            testTool2: TestTune2,
          },
          tunes: ['testTool1', 'testTool2'],
          data: {
            blocks: [
              {
                type: 'paragraph',
                data: {
                  text: 'Hello',
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      },
      { holder: HOLDER_ID }
    );

    // Open block tunes menu
    await page.locator(BLOCK_SELECTOR)
      .click();
    await page.locator(SETTINGS_BUTTON_SELECTOR).click();
    await waitForBlockTunesPopover(page);

    // Press Tab - first item is convert-to (appears before custom tunes)
    await page.keyboard.press('Tab');

    // Check convert-to item is focused first
    await expect(page.locator('[data-blok-item-name="convert-to"]')).toHaveAttribute('data-blok-focused', 'true');

    // Press Tab - move to first custom html item
    await page.keyboard.press('Tab');

    // Check the first custom html item wrapper is focused
    await expect(
      page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-item-html"]`)
        .filter({ hasText: 'Tune1' })
    ).toHaveAttribute('data-blok-focused', 'true');

    // Press Tab - move to second custom html item
    await page.keyboard.press('Tab');

    // Check the second custom html item wrapper is focused
    await expect(
      page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-item-html"]`)
        .filter({ hasText: 'Tune2' })
    ).toHaveAttribute('data-blok-focused', 'true');

    // Press Tab - move to delete item
    await page.keyboard.press('Tab');

    // Check that delete item got focused
    await expect(page.locator('[data-blok-item-name="delete"]')).toHaveAttribute('data-blok-focused', 'true');
  });

  test('should display nested popover (desktop)', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig({
        icon: 'Icon',
        title: 'Title',
        toggle: 'key',
        name: 'test-item',
        children: {
          items: [
            {
              icon: 'Icon',
              title: 'Title',
              name: 'nested-test-item',
            },
          ],
        },
      })
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Check item with children has arrow icon
    await expect(page.locator('[data-blok-item-name="test-item"] [data-blok-testid="popover-item-chevron-right"]')).toBeVisible();

    // Click the item
    await page.locator('[data-blok-item-name="test-item"]').click();

    // Check nested popover opened
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`)).toBeVisible();

    // Check child item displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"] [data-blok-item-name="nested-test-item"]`)).toBeVisible();
  });

  test('should display children items, back button and item header and correctly switch between parent and child states (mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 414,
      height: 896 }); // iPhone size

    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig({
        icon: 'Icon',
        title: 'Tune',
        toggle: 'key',
        name: 'test-item',
        children: {
          items: [
            {
              icon: 'Icon',
              title: 'Title',
              name: 'nested-test-item',
            },
          ],
        },
      })
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Check item with children has arrow icon
    await expect(page.locator('[data-blok-item-name="test-item"] [data-blok-testid="popover-item-chevron-right"]')).toBeVisible();

    // Click the item
    await page.locator('[data-blok-item-name="test-item"]').click();

    // Check child item displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"] [data-blok-item-name="nested-test-item"]`)).toBeVisible();

    // Check header displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-header"]`)).toHaveText('Tune');

    // Check back button displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"] [data-blok-testid="popover-header-back-button"]`)).toBeVisible();

    // Click back button
    await page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"] [data-blok-testid="popover-header-back-button"]`).click();

    // Check child item is not displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"] [data-blok-item-name="nested-test-item"]`)).toBeHidden();

    // Check back button is not displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"] [data-blok-testid="popover-header-back-button"]`)).toBeHidden();

    // Check header is not displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-header"]`)).toBeHidden();
  });

  test('should display default (non-separator) items without specifying type: default', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig({
        icon: 'Icon',
        title: 'Tune',
        toggle: 'key',
        name: 'test-item',
        children: {
          items: [
            {
              icon: 'Icon',
              title: 'Title',
              name: 'nested-test-item',
            },
          ],
        },
      })
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Check item displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"] [data-blok-item-name="test-item"]`)).toBeVisible();
  });

  test('should display separator', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig([
        {
          icon: 'Icon',
          title: 'Tune',
          toggle: 'key',
          name: 'test-item',
          children: {
            items: [
              {
                icon: 'Icon',
                title: 'Title',
                name: 'nested-test-item',
              },
            ],
          },
        },
        {
          type: PopoverItemType.Separator,
        },
      ])
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Check item displayed
    await expect(page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"] [data-blok-item-name="test-item"]`)).toBeVisible();

    // Check at least one separator is displayed (there may be multiple due to convert-to option)
    const separators = page.locator(`${BLOCK_TUNES_SELECTOR} [data-blok-testid="popover-container"] [data-blok-testid="popover-item-separator"]`);
    const separatorCount = await separators.count();

    expect(separatorCount).toBeGreaterThan(0);
  });

  test('should perform keyboard navigation between items ignoring separators', async ({ page }) => {
    await createBlokWithBlocks(
      page,
      [
        {
          type: 'paragraph',
          data: {
            text: 'Hello',
          },
        },
      ],
      buildTestToolsConfig([
        {
          icon: 'Icon',
          title: 'Tune 1',
          name: 'test-item-1',
        },
        {
          type: PopoverItemType.Separator,
        },
        {
          icon: 'Icon',
          title: 'Tune 2',
          name: 'test-item-2',
        },
      ])
    );

    // Open block tunes menu
    await openBlockTunes(page);

    // Press Tab to focus first item (convert-to appears first due to internal tools)
    await page.keyboard.press('Tab');

    // Check convert-to item is focused first (it appears before custom tunes)
    await expect(page.locator('[data-blok-item-name="convert-to"][data-blok-focused="true"]')).toBeVisible();

    // Press Tab to move to first custom tune
    await page.keyboard.press('Tab');

    // Check first custom tune is focused
    await expect(page.locator('[data-blok-item-name="test-item-1"][data-blok-focused="true"]')).toBeVisible();

    // Press Tab to move to second custom tune (skipping separator)
    await page.keyboard.press('Tab');

    // Check second custom tune is focused
    await expect(page.locator('[data-blok-item-name="test-item-2"][data-blok-focused="true"]')).toBeVisible();
  });

  test.describe('inline popover', () => {
    test('should open nested popover on click instead of hover', async ({ page }) => {
      await createBlokWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'First block text',
            },
          },
        ],
        {
          header: { fromGlobal: 'Blok.Header' },
        }
      );

      // Open Inline Toolbar
      const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`);

      await paragraph.click();
      await selectTextByRange(paragraph, 0, 5); // Select "First"

      // Hover Convert To item which has nested popover
      await page.locator('[data-blok-item-name=convert-to]').hover();

      // Check nested popover didn't open
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`)).toBeHidden();

      // Click Convert To item which has nested popover
      await page.locator('[data-blok-item-name=convert-to]').click();

      // Check nested popover opened
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`)).toBeVisible();
    });

    test('should support keyboard navigation between items', async ({ page }) => {
      await createBlokWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'First block text',
            },
          },
        ],
        {
          header: { fromGlobal: 'Blok.Header' },
        }
      );

      // Open Inline Toolbar
      const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`);

      await paragraph.click();
      await selectTextByRange(paragraph, 0, 5); // Select "block"

      // Check Inline Popover opened
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="inline-toolbar"] [data-blok-testid="popover-container"]`)).toBeVisible();

      // Check first item is NOT focused
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="inline-toolbar"] [data-blok-testid="popover-container"] [data-blok-item-name="convert-to"][data-blok-focused="true"]`)).toBeHidden();

      // Press Tab
      await page.keyboard.press('Tab');

      // Check first item became focused after tab
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="inline-toolbar"] [data-blok-testid="popover-container"] [data-blok-item-name="convert-to"][data-blok-focused="true"]`)).toBeVisible();

      // Check second item is NOT focused
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="inline-toolbar"] [data-blok-testid="popover-container"] [data-blok-item-name="link"][data-blok-focused="true"]`)).toBeHidden();

      // Press Tab
      await page.keyboard.press('Tab');

      // Check second item became focused after tab
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="inline-toolbar"] [data-blok-testid="popover-container"] [data-blok-item-name="link"][data-blok-focused="true"]`)).toBeVisible();
    });

    test('should allow to reach nested popover via keyboard', async ({ page }) => {
      await createBlokWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'First block text',
            },
          },
        ],
        {
          header: { fromGlobal: 'Blok.Header' },
        }
      );

      // Open Inline Toolbar
      const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`);

      await paragraph.click();
      await selectTextByRange(paragraph, 0, 5); // Select "block"

      // Check Inline Popover opened
      await expect(page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="inline-toolbar"] [data-blok-testid="popover-container"]`)).toBeVisible();

      // Press Tab
      await page.keyboard.press('Tab');

      // Press Enter on convert-to item
      await page.locator('[data-blok-item-name="convert-to"]').press('Enter');

      // Check nested popover opened
      const nestedPopover = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="inline-toolbar"] [data-blok-nested="true"] [data-blok-testid="popover-container"]`);

      await expect(nestedPopover).toBeVisible();

      // Get all popover items in nested popover
      const nestedItems = nestedPopover.locator('[data-blok-testid="popover-item"]');

      // When opening nested popover via keyboard (Enter), first item should be auto-focused for accessibility
      // eslint-disable-next-line playwright/no-nth-methods -- need to check first item
      await expect(nestedItems.first()).toHaveAttribute('data-blok-focused', 'true');
    });

    test('should convert block when clicking on item in nested popover', async ({ page }) => {
      await createBlokWithBlocks(
        page,
        [
          {
            type: 'paragraph',
            data: {
              text: 'First block text',
            },
          },
        ],
        {
          header: { fromGlobal: 'Blok.Header' },
        }
      );

      // Open Inline Toolbar
      const paragraph = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`);

      await paragraph.click();
      await selectTextByRange(paragraph, 0, 5); // Select "First"

      // Click Convert To item which has nested popover
      await page.locator('[data-blok-item-name=convert-to]').click();

      // Click Header item in nested popover
      await page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"] [data-blok-item-name="header"]`).click();

      // Check block converted
      const header = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`);

      await expect(header).toBeVisible();
      await expect(header).toHaveText('First block text');
    });
  });
});
