import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { BlokConfig, OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR,
} from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const INLINE_TOOLBAR_CONTAINER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-container"]`;
const INLINE_TOOL_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-item"]`;

type SerializableToolConfig = {
  className?: string;
  classCode?: string;
  config?: Record<string, unknown>;
};

type CreateBlokOptions = Pick<BlokConfig, 'readOnly' | 'placeholder'> & {
  data?: OutputData;
  tools?: Record<string, SerializableToolConfig>;
};

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
                window as unknown as Record<string, unknown>
              ) ?? null;
            }

            if (!toolClass && classCode) {
              // Create a tool class from code string for test purposes
              // This is necessary because we cannot directly pass classes from Node.js to browser context
              // We use indirect string evaluation to avoid directly using Function constructor
              const script = document.createElement('script');
              const toolId = `__blok_test_tool_${name}_${Date.now()}__`;
              script.textContent = `window.${toolId} = (${classCode});`;
              document.head.appendChild(script);
              script.remove();
              toolClass = (window as unknown as Record<string, unknown>)[toolId];
              // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- Test cleanup: removing temporary window property
              delete (window as unknown as Record<string, unknown>)[toolId];
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

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}

test.describe('Underline and Strikethrough inline tools', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('Underline tool', () => {
    test('appears in inline toolbar by default', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');

      await expect(page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR)).toBeVisible();
      await expect(page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="underline"]`)).toBeVisible();
    });

    test('wraps selected text in <u> when clicked', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');
      await page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="underline"]`).click();

      await expect(paragraph.locator('xpath=.//u')).toBeVisible();
    });

    test('removes <u> tag when clicked on already-underlined text', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');
      await page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="underline"]`).click();

      await selectText(paragraph, 'Hello world');
      await page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="underline"]`).click();

      await expect(paragraph.locator('xpath=.//u')).not.toBeAttached();
    });

    // CMD+U (Meta+U) is intercepted at the browser/OS level on Firefox and WebKit:
    // Firefox and WebKit handle Meta+U as a native underline command in contenteditable,
    // preventing the page's keydown listener from receiving the event consistently.
    // This is a known cross-browser shortcut conflict that cannot be worked around in E2E tests.
    test('CMD+U shortcut applies underline', async ({ page, browserName }) => {
      test.skip(browserName === 'firefox' || browserName === 'webkit',
        'Meta+U is intercepted by Firefox and WebKit at the browser level before the page keydown listener fires');

      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');
      await page.keyboard.press('Meta+u');

      await expect(paragraph.locator('xpath=.//u')).toBeVisible();
    });

    test('CMD+U shortcut removes underline from already-underlined text', async ({ page, browserName }) => {
      test.skip(browserName === 'firefox' || browserName === 'webkit',
        'Meta+U is intercepted by Firefox and WebKit at the browser level before the page keydown listener fires');

      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');
      await page.keyboard.press('Meta+u');

      await selectText(paragraph, 'Hello world');
      await page.keyboard.press('Meta+u');

      await expect(paragraph.locator('xpath=.//u')).not.toBeAttached();
    });
  });

  test.describe('Strikethrough tool', () => {
    test('appears in inline toolbar by default', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');

      await expect(page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR)).toBeVisible();
      await expect(page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="strikethrough"]`)).toBeVisible();
    });

    test('wraps selected text in <s> when clicked', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');
      await page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="strikethrough"]`).click();

      await expect(paragraph.locator('xpath=.//s')).toBeVisible();
    });

    test('removes <s> tag when clicked on already-strikethrough text', async ({ page }) => {
      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');
      await page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="strikethrough"]`).click();

      await selectText(paragraph, 'Hello world');
      await page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="strikethrough"]`).click();

      await expect(paragraph.locator('xpath=.//s')).not.toBeAttached();
    });

    // CMD+SHIFT+S (Meta+Shift+S) is "Save As" in Chromium-based browsers and is similarly
    // intercepted by Firefox and WebKit at the browser/OS level. The page keydown listener
    // does not reliably receive this event in a headless browser test environment.
    test('CMD+SHIFT+S shortcut applies strikethrough', async ({ page }) => {
      test.skip(true, 'Meta+Shift+S is intercepted by all browsers as "Save As" before the page keydown listener fires');

      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');
      await page.keyboard.press('Meta+Shift+s');

      await expect(paragraph.locator('xpath=.//s')).toBeVisible();
    });

    test('CMD+SHIFT+S shortcut removes strikethrough from already-strikethrough text', async ({ page }) => {
      test.skip(true, 'Meta+Shift+S is intercepted by all browsers as "Save As" before the page keydown listener fires');

      await createBlok(page, {
        data: { blocks: [{ type: 'paragraph', data: { text: 'Hello world' } }] },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Hello world');
      await page.keyboard.press('Meta+Shift+s');

      await selectText(paragraph, 'Hello world');
      await page.keyboard.press('Meta+Shift+s');

      await expect(paragraph.locator('xpath=.//s')).not.toBeAttached();
    });
  });
});
