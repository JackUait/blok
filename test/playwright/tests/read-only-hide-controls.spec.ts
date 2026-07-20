import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import type { Blok } from '@/types';
import type { BlokConfig } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from './helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR
} from '../../../src/components/constants';

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
              // eslint-disable-next-line no-new-func, @typescript-eslint/no-unsafe-call -- Dynamic Function constructor is necessary for testing dynamic tool registration
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

      const blok = new window.Blok(blokConfig);

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

const waitForReadOnlyState = async (page: Page, expected: boolean): Promise<void> => {
  await page.waitForFunction(({ expectedState }) => {
    return window.blokInstance?.readOnly.isEnabled === expectedState;
  }, { expectedState: expected });
};

test.describe('read-only hideControls', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('does not show settings toggler on hover', async ({ page }) => {
    await createBlok(page, {
      readOnly: { hideControls: true },
      data: { blocks: [ { type: 'paragraph', data: { text: 'First paragraph' } } ] },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await expect(paragraph).toBeVisible();
    await paragraph.hover();

    await expect(page.locator(SETTINGS_BUTTON_SELECTOR)).toBeHidden();
  });

  test('does not show inline toolbar for read-only-capable tools on selection', async ({ page }) => {
    await createBlok(page, {
      readOnly: { hideControls: true },
      data: {
        blocks: [
          { type: 'header', data: { text: 'Read me carefully' } },
        ],
      },
      tools: {
        header: {
          className: 'Blok.Header',
          config: {
            inlineToolbar: [ 'readOnlyInline' ],
          },
        },
        readOnlyInline: {
          classCode: READ_ONLY_INLINE_TOOL_SOURCE,
        },
      },
    });

    const headerBlock = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-component="header"]`);

    await selectText(headerBlock, 'Read me');

    // negative assertion — flush the selectionchange handlers and any
    // rAF-scheduled UI work before asserting the toolbar did not appear
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));

    await expect(page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="read-only-inline"]`)).toHaveCount(0);
  });

  test('content is not editable', async ({ page }) => {
    await createBlok(page, {
      readOnly: { hideControls: true },
      data: { blocks: [ { type: 'paragraph', data: { text: 'Locked' } } ] },
    });

    const editable = page.locator(PARAGRAPH_SELECTOR).locator('[contenteditable]').first();

    await expect(editable).toHaveAttribute('contenteditable', 'false');
  });

  test('plain readOnly: true still shows settings toggler on hover (control)', async ({ page }) => {
    await createBlok(page, {
      readOnly: true,
      data: { blocks: [ { type: 'paragraph', data: { text: 'First paragraph' } } ] },
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await expect(paragraph).toBeVisible();
    await paragraph.hover();

    await expect(page.locator(SETTINGS_BUTTON_SELECTOR)).toBeVisible();
  });

  test('readOnly.set(false) restores editing controls; set(true) re-hides them', async ({ page }) => {
    await createBlok(page, {
      readOnly: { hideControls: true },
      data: { blocks: [ { type: 'paragraph', data: { text: 'First paragraph' } } ] },
    });

    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.set(false);
    });
    await waitForReadOnlyState(page, false);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await paragraph.hover();
    await expect(page.locator(SETTINGS_BUTTON_SELECTOR)).toBeVisible();

    await page.evaluate(async () => {
      await window.blokInstance?.readOnly.set(true);
    });
    await waitForReadOnlyState(page, true);

    // move away then re-hover so the toolbar repositioning logic runs fresh
    await page.mouse.move(0, 0);
    await paragraph.hover();

    await expect(page.locator(SETTINGS_BUTTON_SELECTOR)).toBeHidden();
  });
});
