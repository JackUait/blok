/* eslint-disable jsdoc/require-jsdoc */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import type { BlockToolConstructable, InlineToolConstructable } from '@/types/tools';
import { EDITOR_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-block-tool="paragraph"]`;

type ToolDefinition = {
  name: string;
  class: BlockToolConstructable | InlineToolConstructable;
  config?: Record<string, unknown>;
};

type SerializedToolConfig = {
  name: string;
  classSource: string;
  config?: Record<string, unknown>;
  staticProps?: Record<string, unknown>;
};

declare global {
  interface Window {
    editorInstance?: EditorJS;
    __inlineShortcutLog?: string[];
    __lastShortcutEvent?: { metaKey: boolean; ctrlKey: boolean } | null;
  }
}

class ShortcutBlockTool {
  private data: { text?: string };

  constructor({ data }: { data?: { text?: string } }) {
    this.data = data ?? {};
  }

  public static get toolbox(): { title: string; icon: string } {
    return {
      title: 'Shortcut block',
      icon: '<svg></svg>',
    };
  }

  public render(): HTMLElement {
    const element = document.createElement('div');

    element.contentEditable = 'true';
    element.textContent = this.data.text ?? '';

    return element;
  }

  public save(element: HTMLElement): { text: string } {
    return {
      text: element.textContent ?? '',
    };
  }
}

class CmdShortcutBlockTool {
  private data: { text?: string };

  constructor({ data }: { data?: { text?: string } }) {
    this.data = data ?? {};
  }

  public static get toolbox(): { title: string; icon: string } {
    return {
      title: 'CMD shortcut block',
      icon: '<svg></svg>',
    };
  }

  public render(): HTMLElement {
    const element = document.createElement('div');

    element.contentEditable = 'true';
    element.textContent = this.data.text ?? '';

    return element;
  }

  public save(element: HTMLElement): { text: string } {
    return {
      text: element.textContent ?? '',
    };
  }
}

class PrimaryShortcutInlineTool {
  public static isInline = true;
  public static title = 'Primary inline shortcut';
  public static shortcut = 'CMD+SHIFT+8';

  public render(): HTMLElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = 'Primary inline';

    return button;
  }

  public surround(): void {
    window.__inlineShortcutLog = window.__inlineShortcutLog ?? [];
    window.__inlineShortcutLog.push('primary-inline');
  }

  public checkState(): boolean {
    return false;
  }
}

class SecondaryShortcutInlineTool {
  public static isInline = true;
  public static title = 'Secondary inline shortcut';
  public static shortcut = 'CMD+SHIFT+8';

  public render(): HTMLElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = 'Secondary inline';

    return button;
  }

  public surround(): void {
    window.__inlineShortcutLog = window.__inlineShortcutLog ?? [];
    window.__inlineShortcutLog.push('secondary-inline');
  }

  public checkState(): boolean {
    return false;
  }
}

const STATIC_PROP_BLACKLIST = new Set(['length', 'name', 'prototype']);

const extractSerializableStaticProps = (toolClass: ToolDefinition['class']): Record<string, unknown> => {
  return Object.getOwnPropertyNames(toolClass).reduce<Record<string, unknown>>((props, propName) => {
    if (STATIC_PROP_BLACKLIST.has(propName)) {
      return props;
    }

    const descriptor = Object.getOwnPropertyDescriptor(toolClass, propName);

    if (!descriptor || typeof descriptor.value === 'function' || descriptor.value === undefined) {
      return props;
    }

    return {
      ...props,
      [propName]: descriptor.value,
    };
  }, {});
};

const serializeTools = (tools: ToolDefinition[]): SerializedToolConfig[] => {
  return tools.map((tool) => {
    const staticProps = extractSerializableStaticProps(tool.class);

    return {
      name: tool.name,
      classSource: tool.class.toString(),
      config: tool.config,
      staticProps: Object.keys(staticProps).length > 0 ? staticProps : undefined,
    };
  });
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
    container.dataset.cy = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditorWithTools = async (
  page: Page,
  options: { data?: OutputData; tools?: ToolDefinition[] } = {}
): Promise<void> => {
  const { data = null, tools = [] } = options;
  const serializedTools = serializeTools(tools);

  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(
    async ({ holderId, serializedTools: toolConfigs, initialData }) => {
      const reviveToolClass = (classSource: string): unknown => {
        // eslint-disable-next-line no-new-func -- executed inside the browser context to revive tool classes
        return new Function(`return (${classSource});`)();
      };

      const revivedTools = toolConfigs.reduce<Record<string, unknown>>((accumulator, toolConfig) => {
        const revivedClass = reviveToolClass(toolConfig.classSource);

        if (toolConfig.staticProps) {
          Object.entries(toolConfig.staticProps).forEach(([prop, value]) => {
            Object.defineProperty(revivedClass, prop, {
              value,
              configurable: true,
              writable: true,
            });
          });
        }

        const toolSettings: Record<string, unknown> = {
          class: revivedClass,
          ...(toolConfig.config ?? {}),
        };

        return {
          ...accumulator,
          [toolConfig.name]: toolSettings,
        };
      }, {});

      const editorConfig: Record<string, unknown> = {
        holder: holderId,
      };

      if (initialData) {
        editorConfig.data = initialData;
      }

      if (toolConfigs.length > 0) {
        editorConfig.tools = revivedTools;
      }

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      serializedTools,
      initialData: data,
    }
  );
};

const saveEditor = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.editorInstance) {
      throw new Error('Editor instance not found');
    }

    return await window.editorInstance.save();
  });
};

const selectAllText = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => {
    const range = document.createRange();
    const selection = window.getSelection();

    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
};

test.describe('keyboard shortcuts', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('activates custom block tool via configured shortcut', async ({ page }) => {
    await createEditorWithTools(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Custom shortcut block',
            },
          },
        ],
      },
      tools: [
        {
          name: 'shortcutBlock',
          class: ShortcutBlockTool as unknown as BlockToolConstructable,
          config: {
            shortcut: 'CMD+SHIFT+M',
          },
        },
      ],
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);
    await paragraph.click();
    await paragraph.type(' — activated');

    const combo = `${MODIFIER_KEY}+Shift+KeyM`;

    await page.keyboard.press(combo);

    await expect.poll(async () => {
      const data = await saveEditor(page);

      return data.blocks.map((block) => block.type);
    }).toContain('shortcutBlock');
  });

  test('registers first inline tool when shortcuts conflict', async ({ page }) => {
    await createEditorWithTools(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Conflict test paragraph',
            },
          },
        ],
      },
      tools: [
        {
          name: 'primaryInline',
          class: PrimaryShortcutInlineTool as unknown as InlineToolConstructable,
          config: {
            shortcut: 'CMD+SHIFT+8',
          },
        },
        {
          name: 'secondaryInline',
          class: SecondaryShortcutInlineTool as unknown as InlineToolConstructable,
          config: {
            shortcut: 'CMD+SHIFT+8',
          },
        },
      ],
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    const pageErrors: Error[] = [];

    page.on('pageerror', (error) => {
      pageErrors.push(error);
    });

    await paragraph.click();
    await selectAllText(paragraph);
    await page.evaluate(() => {
      window.__inlineShortcutLog = [];
    });

    const combo = `${MODIFIER_KEY}+Shift+Digit8`;

    await page.keyboard.press(combo);

    const activations = await page.evaluate(() => window.__inlineShortcutLog ?? []);

    expect(activations).toStrictEqual([ 'primary-inline' ]);
    expect(pageErrors).toHaveLength(0);
  });

  test('maps CMD shortcut definitions to platform-specific modifier keys', async ({ page }) => {
    await createEditorWithTools(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Platform modifier paragraph',
            },
          },
        ],
      },
      tools: [
        {
          name: 'cmdShortcutBlock',
          class: CmdShortcutBlockTool as unknown as BlockToolConstructable,
          config: {
            shortcut: 'CMD+SHIFT+J',
          },
        },
      ],
    });

    const isMacPlatform = process.platform === 'darwin';

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();

    expect(MODIFIER_KEY).toBe(isMacPlatform ? 'Meta' : 'Control');

    await page.evaluate(() => {
      window.__lastShortcutEvent = null;
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.code === 'KeyJ' && event.shiftKey) {
            window.__lastShortcutEvent = {
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
            };
          }
        },
        {
          once: true,
          capture: true,
        }
      );
    });

    const combo = `${MODIFIER_KEY}+Shift+KeyJ`;

    await page.keyboard.press(combo);

    const shortcutEvent = await page.evaluate(() => window.__lastShortcutEvent);

    expect(shortcutEvent).toBeTruthy();

    expect(shortcutEvent?.metaKey).toBe(isMacPlatform);
    expect(shortcutEvent?.ctrlKey).toBe(!isMacPlatform);

    await expect.poll(async () => {
      const data = await saveEditor(page);

      return data.blocks.map((block) => block.type);
    }).toContain('cmdShortcutBlock');
  });
});
