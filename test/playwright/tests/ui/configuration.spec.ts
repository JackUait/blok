import { expect, test } from '@playwright/test';
import type { ConsoleMessage, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import {
  EDITOR_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR,
  MODIFIER_KEY
} from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const REDACTOR_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="redactor"]`;
const TOOLBOX_POPOVER_SELECTOR = '[data-blok-testid="toolbox-popover"][data-blok-popover-opened="true"]';
const FAILING_TOOL_SOURCE = `
  class FailingTool {
    render() {
      const element = document.createElement('div');

      element.contentEditable = 'true';

      return element;
    }

    save() {
      throw new Error('Save failure');
    }
  }
`;

type ToolDefinition = {
  name: string;
  classSource: string;
  config?: Record<string, unknown>;
  inlineToolbar?: string[] | boolean;
  toolbox?: { title: string; icon?: string };
  shortcut?: string;
};

type CreateEditorOptions = {
  data?: OutputData;
  config?: Record<string, unknown>;
  tools?: ToolDefinition[];
};

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
    __toolConfigReceived?: unknown;
    __onReadyCalls?: number;
  }
}

const getParagraphByIndex = (page: Page, index = 0): ReturnType<Page['locator']> => {
  return page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);
};

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  const { data = null, config = {}, tools = [] } = options;

  await resetEditor(page);

  await page.evaluate(
    async ({ holder, editorData, editorConfig, toolDefinitions }) => {
      const reviveToolClass = (source: string): unknown => {

        return new Function(`return (${source});`)();
      };

      const finalConfig: Record<string, unknown> = {
        holder: holder,
        ...editorConfig,
      };

      if (editorData) {
        finalConfig.data = editorData;
      }

      if (toolDefinitions.length > 0) {
        const revivedTools = toolDefinitions.reduce<Record<string, Record<string, unknown>>>(
          (accumulator, toolConfig) => {
            const revivedClass = reviveToolClass(toolConfig.classSource);

            const toolSettings: Record<string, unknown> = {
              class: revivedClass,
            };

            if (toolConfig.config) {
              toolSettings.config = toolConfig.config;
            }

            if (toolConfig.inlineToolbar !== undefined) {
              if (toolConfig.inlineToolbar === false) {
                toolSettings.inlineToolbar = false;
              } else {
                toolSettings.inlineToolbar = toolConfig.inlineToolbar;
              }
            }

            if (toolConfig.toolbox) {
              toolSettings.toolbox = toolConfig.toolbox;
            }

            if (toolConfig.shortcut) {
              toolSettings.shortcut = toolConfig.shortcut;
            }

            return {
              ...accumulator,
              [toolConfig.name]: toolSettings,
            };
          },
          {}
        );

        finalConfig.tools = revivedTools;
      }

      const editor = new window.EditorJS(finalConfig);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holder: HOLDER_ID,
      editorData: data,
      editorConfig: config,
      toolDefinitions: tools,
    }
  );
};

const getSelectionState = async (page: Page): Promise<{ isInsideParagraph: boolean; offset: number }> => {
  return await page.evaluate(({ paragraphSelector }) => {
    const paragraph = document.querySelector(paragraphSelector);
    const selection = window.getSelection();

    if (!paragraph || !selection || selection.rangeCount === 0) {
      return {
        isInsideParagraph: false,
        offset: -1,
      };
    }

    return {
      isInsideParagraph: paragraph.contains(selection.anchorNode ?? null),
      offset: selection.anchorOffset ?? -1,
    };
  }, { paragraphSelector: PARAGRAPH_SELECTOR });
};

const openToolbox = async (page: Page): Promise<void> => {
  const paragraph = getParagraphByIndex(page);

  await paragraph.click();

  const plusButton = page.locator(`${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="plus-button"]`);

  await plusButton.waitFor({ state: 'visible' });
  await plusButton.click();

  await expect(page.locator(TOOLBOX_POPOVER_SELECTOR)).toHaveCount(1);
};

const insertFailingToolAndTriggerSave = async (page: Page): Promise<void> => {
  await page.evaluate(async () => {
    const editor = window.editorInstance;

    if (!editor) {
      throw new Error('Editor instance not found');
    }

    editor.blocks.insert('failingTool');

    try {
      await editor.save();
    } catch (_error) {
      // Intentionally swallow to observe console logging side effects
    }
  });

  await page.waitForFunction((waitMs) => {
    return new Promise((resolve) => {
      setTimeout(() => resolve(true), waitMs);
    });
  }, 50);
};

test.describe('editor configuration options', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('autofocus', () => {
    test('focuses the default block when editor starts empty', async ({ page }) => {
      await createEditor(page, {
        config: {
          autofocus: true,
        },
      });

      await expect.poll(async () => {
        const { isInsideParagraph } = await getSelectionState(page);

        return isInsideParagraph;
      }).toBe(true);
    });

    test('focuses the first block when initial data is provided', async ({ page }) => {
      await createEditor(page, {
        config: {
          autofocus: true,
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Prefilled content',
              },
            },
          ],
        },
      });

      await expect.poll(async () => {
        const { isInsideParagraph, offset } = await getSelectionState(page);

        return isInsideParagraph && offset === 0;
      }).toBe(true);
    });

    test('does not focus any block when autofocus is false on empty editor', async ({ page }) => {
      await createEditor(page, {
        config: {
          autofocus: false,
        },
      });

      const selectionState = await getSelectionState(page);

      expect(selectionState.isInsideParagraph).toBe(false);
      expect(selectionState.offset).toBe(-1);
    });

    test('does not focus when autofocus is omitted on empty editor', async ({ page }) => {
      await createEditor(page);

      const selectionState = await getSelectionState(page);

      expect(selectionState.isInsideParagraph).toBe(false);
      expect(selectionState.offset).toBe(-1);
    });

    test('does not focus last block when autofocus is false for prefilled data', async ({ page }) => {
      await createEditor(page, {
        config: {
          autofocus: false,
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Prefilled content',
              },
            },
          ],
        },
      });

      const selectionState = await getSelectionState(page);

      expect(selectionState.isInsideParagraph).toBe(false);
    });

    test('does not focus when autofocus is omitted for prefilled data', async ({ page }) => {
      await createEditor(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Prefilled content',
              },
            },
          ],
        },
      });

      const selectionState = await getSelectionState(page);

      expect(selectionState.isInsideParagraph).toBe(false);
    });
  });

  test.describe('placeholder', () => {
    const getPlaceholderValue = async (page: Page): Promise<string | null> => {
      return await page.evaluate(({ paragraphSelector }) => {
        const paragraphWrapper = document.querySelector(paragraphSelector);

        if (!(paragraphWrapper instanceof HTMLElement)) {
          return null;
        }

        // The placeholder attribute is on the contenteditable element inside the block wrapper
        const contentEditable = paragraphWrapper.querySelector('[contenteditable]');

        if (!(contentEditable instanceof HTMLElement)) {
          return null;
        }

        return contentEditable.getAttribute('data-blok-placeholder');
      }, { paragraphSelector: PARAGRAPH_SELECTOR });
    };

    test('uses provided placeholder string', async ({ page }) => {
      const placeholder = 'Start typing...';

      await createEditor(page, {
        config: {
          placeholder,
        },
      });

      await expect.poll(async () => {
        return await getPlaceholderValue(page);
      }).toBe(placeholder);
    });

    test('hides placeholder when set to false', async ({ page }) => {
      await createEditor(page, {
        config: {
          placeholder: false,
        },
      });

      await expect.poll(async () => {
        return await getPlaceholderValue(page);
      }).toBeNull();
    });

    test('does not set placeholder when option is omitted', async ({ page }) => {
      await createEditor(page);

      await expect.poll(async () => {
        return await getPlaceholderValue(page);
      }).toBeNull();
    });
  });

  test('applies custom minHeight padding', async ({ page }) => {
    await createEditor(page, {
      config: {
        minHeight: 180,
      },
    });

    const paddingBottom = await page.evaluate(({ selector }) => {
      const redactor = document.querySelector(selector) as HTMLElement | null;

      return redactor?.style.paddingBottom ?? null;
    }, { selector: REDACTOR_SELECTOR });

    expect(paddingBottom).toBe('180px');
  });

  test('uses default minHeight when option is omitted', async ({ page }) => {
    await createEditor(page);

    const paddingBottom = await page.evaluate(({ selector }) => {
      const redactor = document.querySelector(selector) as HTMLElement | null;

      return redactor?.style.paddingBottom ?? null;
    }, { selector: REDACTOR_SELECTOR });

    expect(paddingBottom).toBe('300px');
  });

  test('respects logLevel configuration', async ({ page }) => {
    const consoleMessages: { type: string; text: string }[] = [];

    const listener = (message: ConsoleMessage): void => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
    };

    page.on('console', listener);

    const triggerInvalidMove = async (): Promise<void> => {
      await page.evaluate(() => {
        const editor = window.editorInstance;

        if (!editor) {
          throw new Error('Editor instance not found');
        }

        editor.blocks.move(-1, -1);
      });

      await page.evaluate(() => {
        return new Promise((resolve) => {
          setTimeout(resolve, 50);
        });
      });
    };

    await createEditor(page);
    await triggerInvalidMove();

    const warningsWithDefaultLevel = consoleMessages.filter((message) => {
      return message.type === 'warning' && message.text.includes("Warning during 'move' call");
    }).length;

    await createEditor(page, {
      config: {
        logLevel: 'ERROR',
      },
    });

    const warningsBeforeSuppressedMove = consoleMessages.length;

    await triggerInvalidMove();

    const warningsAfterSuppressedMove = consoleMessages
      .slice(warningsBeforeSuppressedMove)
      .filter((message) => message.type === 'warning' && message.text.includes("Warning during 'move' call"))
      .length;

    page.off('console', listener);

    expect(warningsWithDefaultLevel).toBeGreaterThan(0);
    expect(warningsAfterSuppressedMove).toBe(0);
  });

  test('logLevel VERBOSE outputs both warnings and log messages', async ({ page }) => {
    const consoleMessages: { type: string; text: string }[] = [];

    const listener = (message: ConsoleMessage): void => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
    };

    page.on('console', listener);

    await createEditor(page, {
      config: {
        logLevel: 'VERBOSE',
      },
      data: {
        blocks: [
          {
            type: 'missingTool',
            data: { text: 'should warn' },
          },
        ],
      },
      tools: [
        {
          name: 'failingTool',
          classSource: FAILING_TOOL_SOURCE,
        },
      ],
    });

    await insertFailingToolAndTriggerSave(page);

    page.off('console', listener);

    const warningCount = consoleMessages.filter((message) => {
      return message.type === 'warning';
    }).length;

    const logCount = consoleMessages.filter((message) => {
      return message.type === 'log' && message.text.includes('Saving process for');
    }).length;

    expect(warningCount).toBeGreaterThan(0);
    expect(logCount).toBeGreaterThan(0);
  });

  test('logLevel INFO suppresses labeled warnings but keeps log messages', async ({ page }) => {
    const consoleMessages: { type: string; text: string }[] = [];

    const listener = (message: ConsoleMessage): void => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
    };

    page.on('console', listener);

    await createEditor(page, {
      config: {
        logLevel: 'INFO',
      },
      data: {
        blocks: [
          {
            type: 'missingTool',
            data: { text: 'should warn' },
          },
        ],
      },
      tools: [
        {
          name: 'failingTool',
          classSource: FAILING_TOOL_SOURCE,
        },
      ],
    });

    await insertFailingToolAndTriggerSave(page);

    page.off('console', listener);

    const warningCount = consoleMessages.filter((message) => message.type === 'warning').length;
    const logCount = consoleMessages.filter((message) => message.type === 'log').length;

    expect(warningCount).toBe(0);
    expect(logCount).toBeGreaterThan(0);
  });

  test('logLevel WARN outputs warnings while suppressing log messages', async ({ page }) => {
    const consoleMessages: { type: string; text: string }[] = [];

    const listener = (message: ConsoleMessage): void => {
      consoleMessages.push({
        type: message.type(),
        text: message.text(),
      });
    };

    page.on('console', listener);

    await createEditor(page, {
      config: {
        logLevel: 'WARN',
      },
      data: {
        blocks: [
          {
            type: 'missingTool',
            data: { text: 'should warn' },
          },
        ],
      },
      tools: [
        {
          name: 'failingTool',
          classSource: FAILING_TOOL_SOURCE,
        },
      ],
    });

    await insertFailingToolAndTriggerSave(page);

    page.off('console', listener);

    const warningCount = consoleMessages.filter((message) => message.type === 'warning').length;
    const logCount = consoleMessages.filter((message) => message.type === 'log').length;

    expect(warningCount).toBeGreaterThan(0);
    expect(logCount).toBe(0);
  });

  test('uses configured defaultBlock when data is empty', async ({ page }) => {
    const simpleBlockTool = `
      class SimpleBlockTool {
        constructor({ data }) {
          this.data = data || {};
        }

        static get toolbox() {
          return {
            title: 'Simple block',
            icon: '<svg></svg>',
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.textContent = this.data.text || '';

          return element;
        }

        save(element) {
          return {
            text: element.textContent || '',
          };
        }
      }
    `;

    await createEditor(page, {
      config: {
        defaultBlock: 'simple',
      },
      tools: [
        {
          name: 'simple',
          classSource: simpleBlockTool,
        },
      ],
    });

    const firstBlockType = await page.evaluate(async () => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor instance not found');
      }

      const block = editor.blocks.getBlockByIndex(0);

      return block?.name ?? null;
    });

    expect(firstBlockType).toBe('simple');
  });

  test('falls back to paragraph when configured defaultBlock is missing', async ({ page }) => {
    await createEditor(page, {
      config: {
        defaultBlock: 'nonexistentTool',
      },
    });

    const firstBlockType = await page.evaluate(async () => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor instance not found');
      }

      const block = editor.blocks.getBlockByIndex(0);

      return block?.name ?? null;
    });

    expect(firstBlockType).toBe('paragraph');
  });

  test('applies custom sanitizer configuration', async ({ page }) => {
    await createEditor(page, {
      config: {
        sanitizer: {
          span: true,
        },
      },
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: '<span data-blok-test="allowed">Span content</span>',
            },
          },
        ],
      },
    });

    const savedHtml = await page.evaluate(async () => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor instance not found');
      }

      const data = await editor.save();

      return data.blocks[0]?.data?.text ?? '';
    });

    expect(savedHtml).toContain('<span');
    expect(savedHtml).toContain('data-blok-test="allowed"');
  });

  test('uses default sanitizer rules when option is omitted', async ({ page }) => {
    await createEditor(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: '<script>window.__danger = true;</script><b>Safe text</b>',
            },
          },
        ],
      },
    });

    const savedHtml = await page.evaluate(async () => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor instance not found');
      }

      const data = await editor.save();

      return data.blocks[0]?.data?.text ?? '';
    });

    expect(savedHtml).not.toContain('<script');
    expect(savedHtml).toContain('Safe text');
  });

  test('invokes onReady callback after initialization', async ({ page }) => {
    await resetEditor(page);

    const onReadyCalls = await page.evaluate(async ({ holder }) => {
      window.__onReadyCalls = 0;

      const editor = new window.EditorJS({
        holder: holder,
        onReady() {
          window.__onReadyCalls = (window.__onReadyCalls ?? 0) + 1;
        },
      });

      window.editorInstance = editor;
      await editor.isReady;

      return window.__onReadyCalls ?? 0;
    }, { holder: HOLDER_ID });

    expect(onReadyCalls).toBe(1);
  });

  test('activates tool via configured shortcut', async ({ page }) => {
    const shortcutTool = `
      class ShortcutTool {
        constructor({ data }) {
          this.data = data || {};
        }

        static get toolbox() {
          return {
            title: 'Shortcut block',
            icon: '<svg></svg>',
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.textContent = this.data.text || '';

          return element;
        }

        save(element) {
          return {
            text: element.textContent || '',
          };
        }
      }
    `;

    await createEditor(page, {
      tools: [
        {
          name: 'shortcutTool',
          classSource: shortcutTool,
          shortcut: 'CMD+SHIFT+L',
        },
      ],
    });

    const paragraph = getParagraphByIndex(page);

    await paragraph.click();
    await paragraph.type('Shortcut text');

    const combo = `${MODIFIER_KEY}+Shift+KeyL`;

    await page.keyboard.press(combo);

    await expect.poll(async () => {
      const data = await page.evaluate(async () => {
        const editor = window.editorInstance;

        if (!editor) {
          throw new Error('Editor instance not found');
        }

        return await editor.save();
      });

      return data.blocks.some((block: { type: string }) => block.type === 'shortcutTool');
    }).toBe(true);
  });

  test('applies tool inlineToolbar, toolbox, and config overrides', async ({ page }) => {
    const configurableToolSource = `
      class ConfigurableTool {
        constructor({ data, config }) {
          this.data = data || {};
          this.config = config || {};
          window.__toolConfigReceived = config;
        }

        static get toolbox() {
          return {
            title: 'Default title',
            icon: '<svg></svg>',
          };
        }

        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';
          element.textContent = this.data.text || '';

          if (this.config.placeholderText) {
            element.setAttribute('data-blok-placeholder', this.config.placeholderText);
          }

          return element;
        }

        save(element) {
          return {
            text: element.textContent || '',
          };
        }
      }
    `;

    await page.evaluate(() => {
      window.__toolConfigReceived = undefined;
    });

    await createEditor(page, {
      tools: [
        {
          name: 'configurableTool',
          classSource: configurableToolSource,
          inlineToolbar: [ 'bold' ],
          toolbox: {
            title: 'Configured Tool',
            icon: '<svg><circle cx="5" cy="5" r="5"></circle></svg>',
          },
          config: {
            placeholderText: 'Custom placeholder',
          },
        },
      ],
    });

    await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor instance not found');
      }

      editor.blocks.insert('configurableTool');
    });

    const configurableSelector = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="configurableTool"]`;
    const blockCount = await page.locator(configurableSelector).count();

    expect(blockCount).toBeGreaterThan(0);

    const customBlock = page.locator(`:nth-match(${configurableSelector}, ${blockCount})`);
    const blockContent = customBlock.locator('[contenteditable="true"]');

    await blockContent.click();
    await blockContent.type('Config text');

    await expect(blockContent).toHaveAttribute('data-blok-placeholder', 'Custom placeholder');

    await blockContent.selectText();

    const inlineToolbar = page.locator(INLINE_TOOLBAR_INTERFACE_SELECTOR);

    await expect(inlineToolbar).toBeVisible();
    await expect(inlineToolbar.locator('[data-blok-item-name="bold"]')).toBeVisible();
    await expect(inlineToolbar.locator('[data-blok-item-name="link"]')).toHaveCount(0);

    await openToolbox(page);

    const toolboxItem = page.locator(`${TOOLBOX_POPOVER_SELECTOR} [data-blok-item-name="configurableTool"]`);

    await expect(toolboxItem).toContainText('Configured Tool');

    const receivedConfig = await page.evaluate(() => {
      return window.__toolConfigReceived ?? null;
    });

    expect(receivedConfig).toMatchObject({
      placeholderText: 'Custom placeholder',
    });
  });

  test('disables inline toolbar when tool config sets inlineToolbar to false', async ({ page }) => {
    const inlineToggleTool = `
      class InlineToggleTool {
        render() {
          const element = document.createElement('div');

          element.contentEditable = 'true';

          return element;
        }

        save(element) {
          return {
            text: element.textContent || '',
          };
        }
      }
    `;

    await createEditor(page, {
      tools: [
        {
          name: 'inlineToggleTool',
          classSource: inlineToggleTool,
          inlineToolbar: false,
        },
      ],
    });

    await page.evaluate(() => {
      const editor = window.editorInstance;

      if (!editor) {
        throw new Error('Editor instance not found');
      }

      editor.blocks.insert('inlineToggleTool');
    });

    const inlineToggleSelector = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="inlineToggleTool"]`;
    const inlineToggleBlocks = page.locator(inlineToggleSelector);

    await expect(inlineToggleBlocks).toHaveCount(1);

    const blockContent = page.locator(`${inlineToggleSelector} [contenteditable="true"]`);

    await expect(blockContent).toBeVisible();
    await blockContent.click();
    await blockContent.type('inline toolbar disabled');
    await blockContent.selectText();

    const inlineToolbar = page.locator(INLINE_TOOLBAR_INTERFACE_SELECTOR);

    await expect(inlineToolbar).toBeHidden();
  });
});
