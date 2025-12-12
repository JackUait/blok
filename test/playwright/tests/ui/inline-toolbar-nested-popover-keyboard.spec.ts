import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { BlokConfig, OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR
} from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const INLINE_TOOLBAR_CONTAINER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-container"]`;
const INLINE_TOOL_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-item"]`;
const NESTED_POPOVER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-nested="true"] [data-blok-testid="popover-container"]`;

type CreateBlokOptions = Pick<BlokConfig, 'readOnly' | 'placeholder'> & {
  data?: OutputData;
  tools?: Record<string, { className?: string; config?: Record<string, unknown> }>;
};

/**
 * Reset the blok holder and destroy any existing instance
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
 */
const createBlok = async (page: Page, options: CreateBlokOptions = {}): Promise<void> => {
  await resetBlok(page);

  const { tools = {}, data, ...restOptions } = options;

  const serializedTools = Object.entries(tools).map(([name, toolConfig]) => {
    return {
      name,
      className: toolConfig.className ?? null,
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
          (accumulator, { name, className, config }) => {
            let toolClass: unknown;

            if (className) {
              toolClass = className.split('.').reduce(
                (obj: unknown, key: string) => (obj as Record<string, unknown>)?.[key],
                window
              ) ?? null;
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
 * Navigate with Tab key until the target element is focused
 */
const tabUntilFocused = async (page: Page, targetLocator: Locator, maxAttempts = 10): Promise<void> => {
  // First ensure the element is visible before trying to interact
  await expect(targetLocator).toBeVisible({ timeout: 5000 });

  for (let i = 0; i < maxAttempts; i++) {
    const isFocused = await targetLocator.getAttribute('data-blok-focused');

    if (isFocused === 'true') {
      return;
    }
    await page.keyboard.press('Tab');
  }
};

/**
 * Select text content within a locator by string match
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.scrollIntoViewIfNeeded();
  await locator.focus();

  const fullText = await locator.textContent();

  if (!fullText || !fullText.includes(text)) {
    throw new Error(`Text "${text}" was not found in element`);
  }

  const startIndex = fullText.indexOf(text);
  const endIndex = startIndex + text.length;

  await locator.evaluate(
    (element, { start, end }) => {
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

        return null;
      };

      const startPosition = findPosition(start);
      const endPosition = findPosition(end);

      if (!startPosition || !endPosition) {
        return;
      }

      const range = ownerDocument.createRange();

      range.setStart(startPosition.node, startPosition.nodeOffset);
      range.setEnd(endPosition.node, endPosition.nodeOffset);

      selection.removeAllRanges();
      selection.addRange(range);
    },
    { start: startIndex, end: endIndex }
  );
};

test.describe('inline toolbar keyboard navigation after closing nested popover', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('tab key behavior', () => {
    test('tab moves focus to next item after closing nested popover with Escape', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
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

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Some text to select');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      // Click on convert-to option to open nested popover
      const convertToOption = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);

      await expect(convertToOption).toBeVisible();
      await convertToOption.click();

      // Nested popover should appear
      const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

      await expect(nestedPopover).toBeVisible();

      // Press Escape to close nested popover
      await page.keyboard.press('Escape');

      // Nested popover should be closed
      await expect(nestedPopover).toHaveCount(0);

      // Inline toolbar should still be visible
      await expect(toolbar).toBeVisible();

      // Convert-to button should be focused after closing nested popover
      await expect(convertToOption).toHaveAttribute('data-blok-focused', 'true');

      // Press Tab - should move focus to the NEXT item (not stay on convert-to)
      await page.keyboard.press('Tab');

      // Convert-to should no longer be focused
      await expect(convertToOption).not.toHaveAttribute('data-blok-focused', 'true');

      // Some other item should now be focused
      const focusedItems = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-focused="true"]`);

      await expect(focusedItems).toHaveCount(1);
    });

    test('shift+Tab moves focus to previous item after closing nested popover with Escape', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
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

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Some text to select');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      // Click on convert-to option to open nested popover
      const convertToOption = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);

      await expect(convertToOption).toBeVisible();
      await convertToOption.click();

      // Nested popover should appear
      const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

      await expect(nestedPopover).toBeVisible();

      // Press Escape to close nested popover
      await page.keyboard.press('Escape');

      // Nested popover should be closed
      await expect(nestedPopover).toHaveCount(0);

      // Convert-to button should be focused
      await expect(convertToOption).toHaveAttribute('data-blok-focused', 'true');

      // Press Shift+Tab - should move focus to the PREVIOUS item
      await page.keyboard.press('Shift+Tab');

      // Convert-to should no longer be focused
      await expect(convertToOption).not.toHaveAttribute('data-blok-focused', 'true');

      // Some other item should now be focused (wraps around to last item)
      const focusedItems = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-focused="true"]`);

      await expect(focusedItems).toHaveCount(1);
    });
  });

  test.describe('enter key behavior', () => {
    test('enter reopens nested popover after closing with Escape', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
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

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Some text to select');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      // Click on convert-to option to open nested popover
      const convertToOption = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);

      await expect(convertToOption).toBeVisible();
      await convertToOption.click();

      // Nested popover should appear
      const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

      await expect(nestedPopover).toBeVisible();

      // Press Escape to close nested popover
      await page.keyboard.press('Escape');

      // Nested popover should be closed
      await expect(nestedPopover).toHaveCount(0);

      // Convert-to button should be focused
      await expect(convertToOption).toHaveAttribute('data-blok-focused', 'true');

      // Press Enter - should reopen the nested popover
      await page.keyboard.press('Enter');

      // Nested popover should be visible again
      await expect(nestedPopover).toBeVisible();
    });

    test('enter activates inline tool after closing nested popover and navigating with Tab', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
          },
        },
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'Some text to make bold',
              },
            },
          ],
        },
      });

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'text to make');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      // Click on convert-to option to open nested popover
      const convertToOption = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);

      await expect(convertToOption).toBeVisible();
      await convertToOption.click();

      // Nested popover should appear
      const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

      await expect(nestedPopover).toBeVisible();

      // Press Escape to close nested popover
      await page.keyboard.press('Escape');

      // Nested popover should be closed
      await expect(nestedPopover).toHaveCount(0);

      // Navigate to bold button using Tab
      const boldButton = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="bold"]`);

      await tabUntilFocused(page, boldButton);
      await expect(boldButton).toHaveAttribute('data-blok-focused', 'true');

      // Press Enter to activate bold
      await page.keyboard.press('Enter');

      // Bold should now be active
      await expect(boldButton).toHaveAttribute('data-blok-popover-item-active', 'true');
    });
  });

  test.describe('multiple open/close cycles', () => {
    test('keyboard navigation works correctly after multiple open/close cycles', async ({ page }) => {
      await createBlok(page, {
        tools: {
          header: {
            className: 'Blok.Header',
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

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await selectText(paragraph, 'Some text to select');

      const toolbar = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

      await expect(toolbar).toBeVisible();

      const convertToOption = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-item-name="convert-to"]`);
      const nestedPopover = page.locator(NESTED_POPOVER_SELECTOR);

      // First cycle: open and close with Escape
      await convertToOption.click();
      await expect(nestedPopover).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(nestedPopover).toHaveCount(0);

      // Wait for toolbar to be stable after closing nested popover
      await expect(toolbar).toBeVisible();

      // Verify Tab works
      await page.keyboard.press('Tab');

      let focusedItems = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-focused="true"]`);

      await expect(focusedItems).toHaveCount(1);
      await expect(convertToOption).not.toHaveAttribute('data-blok-focused', 'true');

      // Ensure toolbar is still visible after Tab navigation
      await expect(toolbar).toBeVisible();

      // Second cycle: reopen with Enter (need to navigate back to convert-to first)
      await tabUntilFocused(page, convertToOption);
      await expect(convertToOption).toHaveAttribute('data-blok-focused', 'true');

      // Open with Enter
      await page.keyboard.press('Enter');
      await expect(nestedPopover).toBeVisible();

      // Close with Escape
      await page.keyboard.press('Escape');
      await expect(nestedPopover).toHaveCount(0);

      // Verify Tab still works after second cycle
      await page.keyboard.press('Tab');
      focusedItems = page.locator(`${INLINE_TOOL_SELECTOR}[data-blok-focused="true"]`);
      await expect(focusedItems).toHaveCount(1);
      await expect(convertToOption).not.toHaveAttribute('data-blok-focused', 'true');

      // Third cycle: verify Enter still works
      await tabUntilFocused(page, convertToOption);
      await page.keyboard.press('Enter');
      await expect(nestedPopover).toBeVisible();
    });
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
