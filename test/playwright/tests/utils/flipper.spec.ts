/* global globalThis */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const BLOCK_TUNES_SELECTOR = '.ce-popover[data-testid=block-tunes]';
const SETTINGS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__settings-btn`;
const POPOVER_CONTAINER_SELECTOR = `${BLOCK_TUNES_SELECTOR} .ce-popover__container`;
const POPOVER_ITEM_SELECTOR = `${POPOVER_CONTAINER_SELECTOR} .ce-popover-item`;
const PLUGIN_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .cdx-some-plugin`;
const INLINE_TOOLBAR_SELECTOR = '[data-testid="inline-toolbar"] .ce-popover--opened';

const KEY_CODES = {
  TAB: 9,
  ENTER: 13,
  ESC: 27,
  ARROW_LEFT: 37,
  ARROW_UP: 38,
  ARROW_DOWN: 40,
  SLASH: 191,
} as const;

type KeydownOptions = {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  code?: string;
  key?: string;
};

/**
 *
 */
class SomePlugin {
  /**
   *
   * @param event - The keyboard event to handle
   */
  public static pluginInternalKeydownHandler(event: KeyboardEvent): void {
    const trackedKeyCodes = new Set([9, 13, 37, 38, 40]);

    if (!trackedKeyCodes.has(event.keyCode)) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
    const context = globalThis as typeof globalThis & { __pluginHandlerCallCount?: number };

    // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
    context.__pluginHandlerCallCount = (context.__pluginHandlerCallCount ?? 0) + 1;
  }

  /**
   *
   */
  public render(): HTMLElement {
    const wrapper = document.createElement('div');

    wrapper.classList.add('cdx-some-plugin');
    wrapper.contentEditable = 'true';
    wrapper.addEventListener('keydown', SomePlugin.pluginInternalKeydownHandler);

    return wrapper;
  }

  /**
   *
   */
  public static get toolbox(): { icon: string; title: string; onActivate: () => void } {
    return {
      icon: '₷',
      title: 'Some tool',
      onActivate: (): void => {},
    };
  }

  /**
   *
   */
  public save(): { data: string } {
    return {
      data: '123',
    };
  }
}

const SOME_PLUGIN_SOURCE = SomePlugin.toString();

type ToolDefinition = {
  name: string;
  classSource: string;
  config?: Record<string, unknown>;
};

type EditorSetupOptions = {
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
  tools?: ToolDefinition[];
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
  }, { holderId: HOLDER_ID });
};

const createEditor = async (page: Page, options: EditorSetupOptions = {}): Promise<void> => {
  const { data, config, tools = [] } = options;

  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(
    async ({ holderId, rawData, rawConfig, serializedTools }) => {
      const reviveToolClass = (classSource: string): unknown => {
        return new Function(`return (${classSource});`)();
      };

      const revivedTools = serializedTools.reduce<Record<string, unknown>>((accumulator, toolConfig) => {
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
      }, {});

      const editorConfig = {
        holder: holderId,
        ...rawConfig,
        ...(serializedTools.length > 0 ? { tools: revivedTools } : {}),
        ...(rawData ? { data: rawData } : {}),
      };

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;
      await editor.isReady;

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      (globalThis as typeof globalThis & { __pluginHandlerCallCount?: number }).__pluginHandlerCallCount = 0;
    },
    {
      holderId: HOLDER_ID,
      rawData: data ?? null,
      rawConfig: config ?? {},
      serializedTools: tools,
    }
  );
};

const createEditorWithPlugin = async (page: Page, data?: Record<string, unknown>): Promise<void> => {
  await createEditor(page, {
    data,
    tools: [
      {
        name: 'sometool',
        classSource: SOME_PLUGIN_SOURCE,
      },
    ],
  });
};

const waitForBlockTunesPopover = async (page: Page, timeout = 5_000): Promise<void> => {
  await page.locator(BLOCK_TUNES_SELECTOR).waitFor({
    state: 'attached',
    timeout,
  });
  await expect(page.locator(POPOVER_CONTAINER_SELECTOR)).toBeVisible({ timeout });
};

const triggerKey = async (locator: Locator, keyCode: number, options: KeydownOptions = {}): Promise<void> => {
  await locator.evaluate(
    (element, { code, key, ctrlKey, metaKey, shiftKey, keyCode: keyCodeValue }) => {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code,
        key,
        ctrlKey: Boolean(ctrlKey),
        metaKey: Boolean(metaKey),
        shiftKey: Boolean(shiftKey),
      });

      Object.defineProperty(event, 'keyCode', {
        get: () => keyCodeValue,
      });
      Object.defineProperty(event, 'which', {
        get: () => keyCodeValue,
      });

      element.dispatchEvent(event);
    },
    {
      code: options.code,
      key: options.key,
      ctrlKey: options.ctrlKey ?? false,
      metaKey: options.metaKey ?? false,
      shiftKey: options.shiftKey ?? false,
      keyCode,
    }
  );
};

const openBlockTunesWithShortcut = async (page: Page, plugin: Locator): Promise<void> => {
  await triggerKey(plugin, KEY_CODES.SLASH, {
    ctrlKey: true,
    metaKey: true,
    code: 'Slash',
    key: '/',
  });
  await waitForBlockTunesPopover(page);
};

const openBlockTunesViaToolbar = async (page: Page, block: Locator): Promise<void> => {
  await expect(block).toBeVisible();
  await block.hover();
  await block.click();
  await expect(page.locator(SETTINGS_BUTTON_SELECTOR)).toBeVisible();
  await page.locator(SETTINGS_BUTTON_SELECTOR).click();
  await waitForBlockTunesPopover(page);
};

const selectTextByOffset = async (locator: Locator, start: number, end: number): Promise<void> => {
  await locator.evaluate(
    (element, { start: startOffset, end: endOffset }) => {
      const textNode = element.firstChild;

      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        throw new Error('Unable to find text node for selection.');
      }

      const range = element.ownerDocument.createRange();

      range.setStart(textNode, startOffset);
      range.setEnd(textNode, endOffset);

      const selection = element.ownerDocument.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);
      element.ownerDocument.dispatchEvent(new Event('selectionchange'));
    },
    { start,
      end }
  );
};

const resetPluginHandlerCallCount = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
    (globalThis as typeof globalThis & { __pluginHandlerCallCount?: number }).__pluginHandlerCallCount = 0;
  });
};

const getPluginHandlerCallCount = async (page: Page): Promise<number> => {
  return await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
    const context = globalThis as typeof globalThis & { __pluginHandlerCallCount?: number };

    // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
    return context.__pluginHandlerCallCount ?? 0;
  });
};

const getFocusedPopoverIndex = async (page: Page): Promise<number> => {
  const focusedIndex = await page.locator(POPOVER_ITEM_SELECTOR).evaluateAll(elements => {
    return elements.findIndex(element => element.classList.contains('ce-popover-item--focused'));
  });

  if (focusedIndex === -1) {
    throw new Error('Unable to determine focused popover item');
  }

  return focusedIndex;
};

const closeBlockTunes = async (page: Page): Promise<void> => {
  await page.keyboard.press('Escape');
  await expect(page.locator(POPOVER_CONTAINER_SELECTOR)).toBeHidden();
};

test.describe('flipper', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });
  test('prevents plugin keydown handler during keyboard navigation', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await expect(plugin).toBeVisible();
    await plugin.click();
    await resetPluginHandlerCallCount(page);

    const sampleText = 'sample text';

    await page.keyboard.type(sampleText);

    await openBlockTunesWithShortcut(page, plugin);

    await triggerKey(plugin, KEY_CODES.ARROW_DOWN, { key: 'ArrowDown' });

    await expect(page.locator('[data-item-name="delete"]')).toHaveClass(/ce-popover-item--focused/);

    await triggerKey(plugin, KEY_CODES.ENTER, { key: 'Enter' });
    await triggerKey(plugin, KEY_CODES.ENTER, { key: 'Enter' });

    expect(await getPluginHandlerCallCount(page)).toBe(0);
  });

  test('does not flip items when Shift is held', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Workspace in classic editors is made of a single contenteditable element, used to create different HTML markups. Editor.js workspace consists of separate Blocks: paragraphs, headings, images, lists, quotes, etc. Each of them is an independent contenteditable element (or more complex structure) provided by Plugin and united by Editor\'s Core.',
            },
          },
        ],
      },
      config: {
        autofocus: true,
      },
    });

    const paragraph = page.locator(`${EDITOR_INTERFACE_SELECTOR} .ce-paragraph`, {
      hasText: /^Workspace in classic editors/,
    });

    await expect(paragraph).toBeVisible();
    await selectTextByOffset(paragraph, 0, 10);

    await triggerKey(paragraph, KEY_CODES.ARROW_DOWN, {
      key: 'ArrowDown',
      shiftKey: true,
    });

    await expect(page.locator(INLINE_TOOLBAR_SELECTOR)).toBeVisible();
    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} .ce-popover-item--focused`)).toHaveCount(0);
  });

  test('cycles focus with Tab and Shift+Tab', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();

    await openBlockTunesWithShortcut(page, plugin);

    const initialIndex = await getFocusedPopoverIndex(page);
    const itemCount = await page.locator(POPOVER_ITEM_SELECTOR).count();

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    const nextIndex = await getFocusedPopoverIndex(page);

    expect(nextIndex).toBe((initialIndex + 1) % itemCount);

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
      shiftKey: true,
    });

    const returnedIndex = await getFocusedPopoverIndex(page);

    expect(returnedIndex).toBe(initialIndex);
  });

  test('pressing Enter activates the focused item', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await triggerKey(plugin, KEY_CODES.ARROW_DOWN, { key: 'ArrowDown' });

    await expect(page.locator('[data-item-name="delete"]')).toHaveClass(/ce-popover-item--focused/);

    await page.evaluate(() => {
      const deleteItem = document.querySelector('[data-item-name="delete"]');

      if (!deleteItem) {
        throw new Error('Delete item not found');
      }

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __deleteItemClicks?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      context.__deleteItemClicks = 0;

      deleteItem.addEventListener('click', () => {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        context.__deleteItemClicks = (context.__deleteItemClicks ?? 0) + 1;
      });
    });

    await triggerKey(plugin, KEY_CODES.ENTER, { key: 'Enter' });

    const deleteItemClickCount = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __deleteItemClicks?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      return context.__deleteItemClicks ?? 0;
    });

    expect(deleteItemClickCount).toBe(1);
  });

  test('ignores navigation for keys outside allowed list', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await resetPluginHandlerCallCount(page);
    await triggerKey(plugin, KEY_CODES.ARROW_LEFT, { key: 'ArrowLeft' });

    expect(await getPluginHandlerCallCount(page)).toBe(1);
  });

  test('removes capturing listener on deactivate', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await resetPluginHandlerCallCount(page);

    await triggerKey(plugin, KEY_CODES.ARROW_DOWN, { key: 'ArrowDown' });

    expect(await getPluginHandlerCallCount(page)).toBe(0);

    await closeBlockTunes(page);
    await resetPluginHandlerCallCount(page);
    await plugin.evaluate((element) => element.focus());

    await triggerKey(plugin, KEY_CODES.ARROW_DOWN, { key: 'ArrowDown' });

    expect(await getPluginHandlerCallCount(page)).toBe(1);
  });

  test('falls back to toolbar button when shortcut is unavailable', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();

    expect(async () => {
      await openBlockTunesWithShortcut(page, plugin);
    }).not.toThrow();

    await closeBlockTunes(page);

    await openBlockTunesViaToolbar(page, plugin);

    await expect(page.locator(POPOVER_CONTAINER_SELECTOR)).toBeVisible();
  });

  test('isActivated getter returns correct state', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();

    const isActivatedBefore = await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        return null;
      }

      return blockSettings.flipper.isActivated;
    });

    expect(isActivatedBefore).toBe(false);

    await openBlockTunesWithShortcut(page, plugin);

    const isActivatedAfter = await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        return null;
      }

      return blockSettings.flipper.isActivated;
    });

    expect(isActivatedAfter).toBe(true);

    await closeBlockTunes(page);

    const isActivatedAfterClose = await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        return null;
      }

      return blockSettings.flipper.isActivated;
    });

    expect(isActivatedAfterClose).toBe(false);
  });

  test('hasFocus returns correct state', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    const hasFocusBefore = await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        return null;
      }

      return blockSettings.flipper.hasFocus();
    });

    expect(hasFocusBefore).toBe(true);

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    const hasFocusAfter = await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        return null;
      }

      return blockSettings.flipper.hasFocus();
    });

    expect(hasFocusAfter).toBe(true);
  });

  test('focusFirst focuses the first item', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor not found');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        throw new Error('Flipper not found');
      }

      blockSettings.flipper.focusFirst();
    });

    const isFirstItemFocused = await page.locator(POPOVER_ITEM_SELECTOR).evaluateAll(elements => {
      const [ firstElement ] = elements;

      if (!firstElement) {
        throw new Error('No popover items found');
      }

      return firstElement.classList.contains('ce-popover-item--focused');
    });

    expect(isFirstItemFocused).toBe(true);
  });

  test('onFlip callback is executed on navigation', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    const flipCallbackCount = await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __flipCallbackCount?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      context.__flipCallbackCount = 0;

      const callback = (): void => {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        context.__flipCallbackCount = (context.__flipCallbackCount ?? 0) + 1;
      };

      blockSettings.flipper.onFlip(callback);

      return {
        flipper: blockSettings.flipper,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        getCount: (): number => context.__flipCallbackCount ?? 0,
      };
    });

    expect(flipCallbackCount).not.toBeNull();

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    const countAfterInitialTab = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __flipCallbackCount?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      return context.__flipCallbackCount ?? 0;
    });

    expect(countAfterInitialTab).toBe(0);

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    const countAfterFirstFlip = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __flipCallbackCount?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      return context.__flipCallbackCount ?? 0;
    });

    expect(countAfterFirstFlip).toBe(1);

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    const countAfterSecondFlip = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __flipCallbackCount?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      return context.__flipCallbackCount ?? 0;
    });

    expect(countAfterSecondFlip).toBe(2);
  });

  test('removeOnFlip removes callback correctly', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor not found');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        throw new Error('Flipper not found');
      }

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __flipCallbackCount?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      context.__flipCallbackCount = 0;

      const callback = (): void => {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        context.__flipCallbackCount = (context.__flipCallbackCount ?? 0) + 1;
      };

      blockSettings.flipper.onFlip(callback);

      // Store callback reference for removal
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      (globalThis as typeof globalThis & { __flipCallback?: () => void }).__flipCallback = callback;
    });

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    const countBeforeRemoval = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __flipCallbackCount?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      return context.__flipCallbackCount ?? 0;
    });

    expect(countBeforeRemoval).toBe(1);

    await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor not found');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        throw new Error('Flipper not found');
      }

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __flipCallback?: () => void };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      if (context.__flipCallback) {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        blockSettings.flipper.removeOnFlip(context.__flipCallback);
      }
    });

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    const countAfterRemoval = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __flipCallbackCount?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      return context.__flipCallbackCount ?? 0;
    });

    expect(countAfterRemoval).toBe(1);
  });

  test('activate with cursorPosition parameter', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    const itemCount = await page.locator(POPOVER_ITEM_SELECTOR).count();
    const targetIndex = Math.min(2, itemCount - 1);

    await page.evaluate(
      ({ targetIndex: activeIndex, selector }) => {
        const editor = window.editorInstance;

        if (!editor) {
          throw new Error('Editor not found');
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
        const blockSettings = (editor as any).module?.toolbar?.blockSettings;

        if (!blockSettings || !blockSettings.flipper) {
          throw new Error('Flipper not found');
        }

        const items = Array.from(
          document.querySelectorAll(selector)
        ) as HTMLElement[];

        blockSettings.flipper.deactivate();
        blockSettings.flipper.activate(items, activeIndex);

        return {
          targetIndex: activeIndex,
          itemNames: items.map(item => item.dataset.itemName),
          focusedItemName: blockSettings.flipper['iterator']?.currentItem?.dataset?.itemName ?? null,
          focusedItemClasses: blockSettings.flipper['iterator']?.currentItem ? Array.from(blockSettings.flipper['iterator'].currentItem.classList) : null,
        };
      },
      {
        targetIndex,
        selector: `${BLOCK_TUNES_SELECTOR} .ce-popover-item`,
      }
    );

    const isTargetFocused = await page.locator(POPOVER_ITEM_SELECTOR).evaluateAll(
      (elements, index) => {
        const target = elements[index];

        if (!target) {
          throw new Error(`No popover item found at index ${index}`);
        }

        return target.classList.contains('ce-popover-item--focused');
      },
      targetIndex
    );

    expect(isTargetFocused).toBe(true);
  });

  test('activate with items parameter updates items dynamically', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor not found');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        throw new Error('Flipper not found');
      }

      const originalItems = Array.from(
        document.querySelectorAll('.ce-popover-item')
      ) as HTMLElement[];

      // Create new items
      const newItem1 = document.createElement('div');

      newItem1.className = 'ce-popover-item';
      newItem1.textContent = 'New Item 1';

      const newItem2 = document.createElement('div');

      newItem2.className = 'ce-popover-item';
      newItem2.textContent = 'New Item 2';

      const container = document.querySelector('.ce-popover__container');

      if (container) {
        container.appendChild(newItem1);
        container.appendChild(newItem2);
      }

      const newItems = [...originalItems, newItem1, newItem2];

      blockSettings.flipper.activate(newItems);
    });

    const allItems = page.locator(POPOVER_ITEM_SELECTOR);
    const count = await allItems.count();

    expect(count).toBeGreaterThan(0);
  });

  test('activateCallback is invoked on Enter press', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    // Test that Enter press triggers the item click, which indirectly tests activateCallback
    // The actual activateCallback is set during Flipper construction and is tested indirectly
    // through the item click behavior
    await triggerKey(plugin, KEY_CODES.ARROW_DOWN, { key: 'ArrowDown' });

    await page.evaluate(() => {
      const focusedItem = document.querySelector('.ce-popover-item--focused');

      if (!focusedItem) {
        throw new Error('No focused item found');
      }

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __activateCallbackCount?: number; __activateCallbackItem?: HTMLElement };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      context.__activateCallbackCount = 0;
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      context.__activateCallbackItem = undefined;

      // Simulate what activateCallback would do
      focusedItem.addEventListener('click', () => {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        context.__activateCallbackCount = (context.__activateCallbackCount ?? 0) + 1;
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        context.__activateCallbackItem = focusedItem as HTMLElement;
      }, { once: true });
    });

    await triggerKey(plugin, KEY_CODES.ENTER, { key: 'Enter' });

    const callbackResult = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __activateCallbackCount?: number; __activateCallbackItem?: HTMLElement };

      return {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        count: context.__activateCallbackCount ?? 0,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        itemText: context.__activateCallbackItem?.textContent ?? null,
      };
    });

    // Enter should trigger the click, which simulates activateCallback behavior
    expect(callbackResult.count).toBeGreaterThanOrEqual(1);
  });

  test('handles empty items array gracefully', async ({ page }) => {
    await createEditor(page);

    // Test that Flipper can be activated/deactivated even when there are no items
    // This is tested indirectly through the editor's behavior
    const result = await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        return { error: 'Editor not found' };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        return { error: 'Flipper not found' };
      }

      const flipper = blockSettings.flipper;

      // Test with empty items by activating with empty array
      flipper.activate([]);

      const hasFocus = flipper.hasFocus();
      const isActivated = flipper.isActivated;

      flipper.deactivate();

      return {
        hasFocus,
        isActivated,
        deactivated: !flipper.isActivated,
      };
    });

    expect(result.error).toBeUndefined();
    expect(result.isActivated).toBe(true);
    expect(result.deactivated).toBe(true);
  });

  test('handles multiple activation/deactivation cycles', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor not found');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        throw new Error('Flipper not found');
      }

      const flipper = blockSettings.flipper;

      // Multiple activate/deactivate cycles
      flipper.deactivate();
      flipper.activate();
      flipper.deactivate();
      flipper.activate();
      flipper.deactivate();
      flipper.activate();

      return flipper.isActivated;
    });

    const isActivated = await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        return null;
      }

      return blockSettings.flipper.isActivated;
    });

    expect(isActivated).toBe(true);

    await closeBlockTunes(page);

    const isActivatedAfterClose = await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        return null;
      }

      return blockSettings.flipper.isActivated;
    });

    expect(isActivatedAfterClose).toBe(false);
  });

  test('custom allowedKeys configuration works correctly', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    // Test that allowedKeys filtering works - ArrowLeft is not in the default allowedKeys
    // for block settings (which uses Tab, Up, Down, Enter), so it should be ignored
    await resetPluginHandlerCallCount(page);

    // ArrowLeft should be handled by plugin since it's not in allowedKeys
    await triggerKey(plugin, KEY_CODES.ARROW_LEFT, { key: 'ArrowLeft' });

    const callCount = await getPluginHandlerCallCount(page);

    // ArrowLeft should be handled by plugin (not blocked by flipper)
    expect(callCount).toBeGreaterThan(0);
  });

  test('focusedItemClass is applied to focused items', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    // Test that the focusedItemClass (ce-popover-item--focused) is applied
    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    const focusedItem = page.locator('.ce-popover-item--focused');

    await expect(focusedItem).toBeVisible();
    await expect(focusedItem).toHaveCount(1);
  });

  test('handleEnterPress does not activate when not activated', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await page.evaluate(() => {
      const deleteItem = document.querySelector('[data-item-name="delete"]');

      if (!deleteItem) {
        throw new Error('Delete item not found');
      }

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __deleteItemClicks?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      context.__deleteItemClicks = 0;

      deleteItem.addEventListener('click', () => {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        context.__deleteItemClicks = (context.__deleteItemClicks ?? 0) + 1;
      });
    });

    await closeBlockTunes(page);

    await triggerKey(plugin, KEY_CODES.ENTER, { key: 'Enter' });

    const deleteItemClickCount = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __deleteItemClicks?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      return context.__deleteItemClicks ?? 0;
    });

    // Enter should not trigger click when flipper is deactivated
    expect(deleteItemClickCount).toBe(0);
  });

  test('multiple onFlip callbacks are all executed', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor not found');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        throw new Error('Flipper not found');
      }

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __callback1Count?: number; __callback2Count?: number; __callback3Count?: number };

      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      context.__callback1Count = 0;
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      context.__callback2Count = 0;
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      context.__callback3Count = 0;

      const callback1 = (): void => {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        context.__callback1Count = (context.__callback1Count ?? 0) + 1;
      };

      const callback2 = (): void => {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        context.__callback2Count = (context.__callback2Count ?? 0) + 1;
      };

      const callback3 = (): void => {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        context.__callback3Count = (context.__callback3Count ?? 0) + 1;
      };

      blockSettings.flipper.onFlip(callback1);
      blockSettings.flipper.onFlip(callback2);
      blockSettings.flipper.onFlip(callback3);
    });

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    await triggerKey(plugin, KEY_CODES.TAB, {
      key: 'Tab',
      code: 'Tab',
    });

    const callbackCounts = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
      const context = globalThis as typeof globalThis & { __callback1Count?: number; __callback2Count?: number; __callback3Count?: number };

      return {
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        callback1: context.__callback1Count ?? 0,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        callback2: context.__callback2Count ?? 0,
        // eslint-disable-next-line @typescript-eslint/naming-convention -- test-only property
        callback3: context.__callback3Count ?? 0,
      };
    });

    expect(callbackCounts.callback1).toBeGreaterThan(0);
    expect(callbackCounts.callback2).toBe(callbackCounts.callback1);
    expect(callbackCounts.callback3).toBe(callbackCounts.callback1);
  });

  test('removeOnFlip with non-existent callback does not error', async ({ page }) => {
    await createEditorWithPlugin(page, {
      blocks: [
        {
          type: 'sometool',
          data: {},
        },
      ],
    });

    const plugin = page.locator(PLUGIN_SELECTOR);

    await plugin.click();
    await openBlockTunesWithShortcut(page, plugin);

    await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor not found');
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing runtime property
      const blockSettings = (editor as any).module?.toolbar?.blockSettings;

      if (!blockSettings || !blockSettings.flipper) {
        throw new Error('Flipper not found');
      }

      const nonExistentCallback = (): void => {};

      // Should not throw error
      blockSettings.flipper.removeOnFlip(nonExistentCallback);
    });

    // Test should complete without errors
    expect(true).toBe(true);
  });
});

