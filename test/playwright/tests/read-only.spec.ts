import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type Blok from '@/types';
import type { BlokConfig } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR
} from '../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="toolbar"]`;
const SETTINGS_BUTTON_SELECTOR = `${TOOLBAR_SELECTOR} [data-blok-testid="settings-toggler"]`;
const INLINE_TOOL_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-item"]`;


const READ_ONLY_INLINE_TOOL_SOURCE = `
class ReadOnlyInlineTool {
  static isInline = true;
  static isReadOnlySupported = true;

  render() {
    return {
      title: 'Read-only tool',
      name: 'read-only-inline',
      onActivate: () => {},
    };
  }
}
`;

const UNSUPPORTED_INLINE_TOOL_SOURCE = `
class UnsupportedInlineTool {
  static isInline = true;

  render() {
    return {
      title: 'Legacy inline tool',
      name: 'unsupported-inline',
      onActivate: () => {},
    };
  }
}
`;

const UNSUPPORTED_BLOCK_TOOL_SOURCE = `
class LegacyBlockTool {
  constructor({ data }) {
    this.data = data ?? { text: 'Legacy block' };
  }

  static get toolbox() {
    return {
      title: 'Legacy',
      icon: 'L',
    };
  }

  static get isReadOnlySupported() {
    return false;
  }

  render() {
    const element = document.createElement('div');

    element.contentEditable = 'true';
    element.innerHTML = this.data?.text ?? '';

    return element;
  }

  save(element) {
    return {
      text: element.innerHTML,
    };
  }
}
`;

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = Partial<Pick<BlokConfig, 'data' | 'inlineToolbar' | 'placeholder' | 'readOnly'>> & {
  tools?: Record<string, SerializableToolConfig>;
};

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

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

const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  await resetBlok(page);

  const { tools = {}, ...blokOptions } = options;
  const serializedTools = Object.entries(tools).map(([name, tool]) => {
    return {
      name,
      className: tool.className ?? null,
      classCode: tool.classCode ?? null,
      toolConfig: tool.config ?? {},
    };
  });

  await page.evaluate(
    async ({ holder, blokOptions: rawOptions, serializedTools: toolsConfig }) => {
      const { data, ...restOptions } = rawOptions;
      const blokConfig: Record<string, unknown> = {
        holder: holder,
        ...restOptions,
      };

      if (data) {
        blokConfig.data = data;
      }

      if (toolsConfig.length > 0) {
        const resolvedTools = toolsConfig.reduce<Record<string, { class: unknown } & Record<string, unknown>>>(
          (accumulator, { name, className, classCode, toolConfig }) => {
            let toolClass: unknown = null;

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
              throw new Error(`Tool "${name}" is not available globally`);
            }

            return {
              ...accumulator,
              [name]: {
                class: toolClass,
                ...toolConfig,
              },
            };
          },
          {}
        );

        blokConfig.tools = resolvedTools;
      }

      const blok = new window.Blok(blokConfig as BlokConfig);

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokOptions,
      serializedTools,
    }
  );
};

const toggleReadOnly = async (page: Page, state: boolean): Promise<void> => {
  await page.evaluate(async ({ targetState }) => {
    const blok = window.blokInstance ?? (() => {
      throw new Error('Blok instance not found');
    })();

    await blok.readOnly.toggle(targetState);
  }, { targetState: state });
};

const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let foundNode: Text | null = null;
    let offset = -1;

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const content = node.textContent ?? '';
      const index = content.indexOf(targetText);

      if (index !== -1) {
        foundNode = node;
        offset = index;
        break;
      }
    }

    if (!foundNode || offset === -1) {
      throw new Error(`Text "${targetText}" was not found inside element`);
    }

    const selection = element.ownerDocument.getSelection();
    const range = element.ownerDocument.createRange();

    range.setStart(foundNode, offset);
    range.setEnd(foundNode, offset + targetText.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  }, text);
};

const paste = async (page: Page, locator: Locator, data: Record<string, string>): Promise<void> => {
  await locator.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => pasteData[type] ?? '',
        types: Object.keys(pasteData),
      },
    });

    element.dispatchEvent(pasteEvent);
  }, data);

  await page.evaluate(() => {
    return new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  });
};

const placeCursorAtEnd = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element: HTMLElement) => {
    const selection = element.ownerDocument.getSelection();
    const range = element.ownerDocument.createRange();

    range.selectNodeContents(element);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  });
};

const expectSettingsButtonToDisappear = async (page: Page): Promise<void> => {
  await page.waitForFunction((selector) => document.querySelector(selector) === null, SETTINGS_BUTTON_SELECTOR);
};

const waitForReadOnlyState = async (page: Page, expected: boolean): Promise<void> => {
  await page.waitForFunction(({ expectedState }) => {
    return window.blokInstance?.readOnly.isEnabled === expectedState;
  }, { expectedState: expected });
};

test.describe('read-only mode', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('allows toggling editing state dynamically', async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Editable text',
            },
          },
        ],
      },
    });

    const paragraphWrapper = page.locator(PARAGRAPH_SELECTOR);
    // The contenteditable element is inside the block wrapper
    const paragraph = paragraphWrapper.locator('[contenteditable]');

    await expect(paragraphWrapper).toHaveCount(1);
    await paragraph.click();
    await placeCursorAtEnd(paragraph);
    await page.keyboard.type(' + edit');
    await expect(paragraph).toContainText('Editable text');
    await expect(paragraph).toContainText('+ edit');

    await toggleReadOnly(page, true);
    await waitForReadOnlyState(page, true);
    await expect(paragraph).toHaveAttribute('contenteditable', 'false');
    await expect(paragraph).toContainText('Editable text');
    await expect(paragraph).toContainText('+ edit');

    await paragraph.click();
    await page.keyboard.type(' should not appear');
    await expect(paragraph).toContainText('Editable text');
    await expect(paragraph).toContainText('+ edit');

    await toggleReadOnly(page, false);
    await waitForReadOnlyState(page, false);
    await expect(paragraph).toHaveAttribute('contenteditable', 'true');

    await paragraph.click();
    await placeCursorAtEnd(paragraph);
    await page.keyboard.type(' + writable again');
    await expect(paragraph).toContainText('writable again');
  });

  test('only shows read-only inline tools when blok is locked', async ({ page }) => {
    
    await createBlok(page, {
      readOnly: true,
      data: {
        blocks: [
          {
            type: 'header',
            data: {
              text: 'Read me carefully',
            },
          },
        ],
      },
      tools: {
        header: {
          className: 'Blok.Header',
          config: {
            inlineToolbar: ['readOnlyInline', 'legacyInline'],
          },
        },
        readOnlyInline: {
          classCode: READ_ONLY_INLINE_TOOL_SOURCE,
        },
        legacyInline: {
          classCode: UNSUPPORTED_INLINE_TOOL_SOURCE,
        },
      },
    });

    const headerBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`);

    await selectText(headerBlock, 'Read me');

    const readOnlyToolItem = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="read-only-inline"]`);
    const unsupportedToolItem = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="unsupported-inline"]`);

    await expect(readOnlyToolItem).toBeVisible();
    await expect(unsupportedToolItem).toHaveCount(0);

    await toggleReadOnly(page, false);
    await waitForReadOnlyState(page, false);
    await selectText(headerBlock, 'Read me');

    await expect(readOnlyToolItem).toBeVisible();
    await expect(unsupportedToolItem).toBeVisible();
  });

  test('removes block settings UI while read-only is enabled', async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Block tunes availability',
            },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);
    await paragraph.click();
    await expect(page.locator(SETTINGS_BUTTON_SELECTOR)).toBeVisible();

    await toggleReadOnly(page, true);
    await expectSettingsButtonToDisappear(page);

    await toggleReadOnly(page, false);
    await waitForReadOnlyState(page, false);
    await paragraph.click();
    await expect(page.locator(SETTINGS_BUTTON_SELECTOR)).toBeVisible();
  });

  test('prevents paste operations while read-only is enabled', async ({ page }) => {
    await createBlok(page, {
      readOnly: true,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Original content',
            },
          },
        ],
      },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);
    await paste(page, paragraph, {
       
      'text/plain': ' + pasted text',
    });

    await expect(paragraph).toHaveText('Original content');

    await toggleReadOnly(page, false);
    await waitForReadOnlyState(page, false);
    await paragraph.click();

    await paste(page, paragraph, {
       
      'text/plain': ' + pasted text',
    });

    await expect(paragraph).toContainText('Original content + pasted text');
  });

  test('throws descriptive error when enabling read-only with unsupported tools', async ({ page }) => {
    await createBlok(page, {
      data: {
        blocks: [
          {
            type: 'legacy',
            data: {
              text: 'Legacy feature block',
            },
          },
        ],
      },
      tools: {
        legacy: {
          classCode: UNSUPPORTED_BLOCK_TOOL_SOURCE,
        },
      },
    });

    const errorMessage = await page.evaluate(async () => {
      const blok = window.blokInstance ?? (() => {
        throw new Error('Blok instance not found');
      })();

      try {
        await blok.readOnly.toggle(true);

        return null;
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });

    expect(errorMessage).toContain('Tools legacy don\'t support read-only mode');

    const isReadOnlyEnabled = await page.evaluate(() => {
      return window.blokInstance?.readOnly.isEnabled ?? false;
    });

    expect(isReadOnlyEnabled).toBe(false);
  });
});
