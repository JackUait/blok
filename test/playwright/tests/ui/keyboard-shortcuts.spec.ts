 
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { OutputData } from '@/types';
import type { BlockToolConstructable, InlineToolConstructable } from '@/types/tools';
import { BLOK_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;
const BLOK_BUNDLE_PATH = path.resolve(__dirname, '../../../../dist/editorjs.umd.js');

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;

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
  isInlineTool?: boolean;
};

declare global {
  interface Window {
    blokInstance?: Blok;
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
    const isInlineTool = (tool.class as { isInline?: boolean }).isInline === true;

    return {
      name: tool.name,
      classSource: tool.class.toString(),
      config: tool.config,
      staticProps: Object.keys(staticProps).length > 0 ? staticProps : undefined,
      isInlineTool,
    };
  });
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
  }, { holder: HOLDER_ID });
};

const ensureBlokBundleAvailable = async (page: Page): Promise<void> => {
  const hasGlobal = await page.evaluate(() => typeof window.Blok === 'function');

  if (hasGlobal) {
    return;
  }

  await page.addScriptTag({ path: BLOK_BUNDLE_PATH });
  await page.waitForFunction(() => typeof window.Blok === 'function');
};

const createBlokWithTools = async (
  page: Page,
  options: { data?: OutputData; tools?: ToolDefinition[] } = {}
): Promise<void> => {
  const { data = null, tools = [] } = options;
  const serializedTools = serializeTools(tools);

  await resetBlok(page);
  await ensureBlokBundleAvailable(page);

  await page.evaluate(
    async ({ holder, serializedTools: toolConfigs, initialData }) => {
      const reviveToolClass = (classSource: string): unknown => {
         
        return new Function(`return (${classSource});`)();
      };

      const inlineToolNames: string[] = [];
      const revivedTools = toolConfigs.reduce<Record<string, Record<string, unknown>>>((accumulator, toolConfig) => {
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

        if (toolConfig.isInlineTool) {
          inlineToolNames.push(toolConfig.name);
        }

        return {
          ...accumulator,
          [toolConfig.name]: toolSettings,
        };
      }, {});

      if (inlineToolNames.length > 0) {
        revivedTools.paragraph = {
          ...(revivedTools.paragraph ?? {}),
          inlineToolbar: inlineToolNames,
        };
      }

      const blokConfig: Record<string, unknown> = {
        holder: holder,
        ...(inlineToolNames.length > 0 ? { inlineToolbar: inlineToolNames } : {}),
      };

      if (initialData) {
        blokConfig.data = initialData;
      }

      if (toolConfigs.length > 0) {
        blokConfig.tools = revivedTools;
      }

      const blok = new window.Blok(blokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      serializedTools,
      initialData: data,
    }
  );
};

const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

test.describe('keyboard shortcuts', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('activates custom block tool via configured shortcut', async ({ page }) => {
    await createBlokWithTools(page, {
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

    const paragraph = page.locator(PARAGRAPH_SELECTOR, { hasText: 'Custom shortcut block' });
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    await expect(paragraph).toHaveCount(1);
    await paragraphInput.click();
    await paragraphInput.type(' — activated');

    const combo = `${MODIFIER_KEY}+Shift+KeyM`;

    await page.keyboard.press(combo);

    await expect.poll(async () => {
      const data = await saveBlok(page);

      return data.blocks.map((block) => block.type);
    }).toContain('shortcutBlock');
  });

  test('maps CMD shortcut definitions to platform-specific modifier keys', async ({ page }) => {
    await createBlokWithTools(page, {
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
            shortcut: 'CMD+SHIFT+Y',
          },
        },
      ],
    });

    const isMacPlatform = process.platform === 'darwin';

    const paragraph = page.locator(PARAGRAPH_SELECTOR, { hasText: 'Platform modifier paragraph' });
    const paragraphInput = paragraph.locator('[contenteditable="true"]');

    await expect(paragraph).toHaveCount(1);
    await paragraphInput.click();

    expect(MODIFIER_KEY).toBe(isMacPlatform ? 'Meta' : 'Control');

    await page.evaluate(() => {
      window.__lastShortcutEvent = null;

      const handler = (event: KeyboardEvent): void => {
        if (event.code !== 'KeyY' || !event.shiftKey) {
          return;
        }

        window.__lastShortcutEvent = {
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
        };

        document.removeEventListener('keydown', handler, true);
      };

      document.addEventListener('keydown', handler, true);
    });

    const combo = `${MODIFIER_KEY}+Shift+KeyY`;

    await page.keyboard.press(combo);

    await page.waitForFunction(() => window.__lastShortcutEvent !== null);

    const shortcutEvent = await page.evaluate(() => window.__lastShortcutEvent);

    expect(shortcutEvent?.metaKey).toBe(isMacPlatform);
    expect(shortcutEvent?.ctrlKey).toBe(!isMacPlatform);

    await expect.poll(async () => {
      const data = await saveBlok(page);

      return data.blocks.map((block) => block.type);
    }).toContain('cmdShortcutBlock');
  });
});
