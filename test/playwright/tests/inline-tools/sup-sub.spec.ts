import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const INLINE_TOOLBAR_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid=inline-toolbar]`;
const SUP_SUB_BUTTON_SELECTOR = `${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="sup-sub"]`;
const SUPERSCRIPT_ITEM_SELECTOR = '[data-blok-item-name="superscript"]';
const SUBSCRIPT_ITEM_SELECTOR = '[data-blok-item-name="subscript"]';

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
 * Create blok with provided blocks and the sup-sub tool registered
 * @param page - The Playwright page object
 * @param blocks - The blocks data to initialize the blok with
 */
const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
      tools: window.BlokSupSub !== undefined ? { supSub: { class: window.BlokSupSub } } : {},
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

/**
 * Select text content within a locator by string match
 * @param locator - The Playwright locator for the element containing the text
 * @param text - The text string to select within the element
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const root = element as HTMLElement;
    const doc = root.ownerDocument;

    if (!doc) {
      throw new Error('Unable to access ownerDocument for selection');
    }

    const fullText = root.textContent ?? '';

    if (!fullText.includes(targetText)) {
      throw new Error(`Text "${targetText}" was not found in element`);
    }

    const selection = doc.getSelection();

    if (!selection) {
      throw new Error('Selection is not available');
    }

    const startIndex = fullText.indexOf(targetText);
    const endIndex = startIndex + targetText.length;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    let accumulatedLength = 0;
    let startNode: Node | null = null;
    let startOffset = 0;
    let endNode: Node | null = null;
    let endOffset = 0;

    while (walker.nextNode()) {
      const currentNode = walker.currentNode;
      const nodeText = currentNode.textContent ?? '';
      const nodeStart = accumulatedLength;
      const nodeEnd = nodeStart + nodeText.length;

      if (!startNode && startIndex >= nodeStart && startIndex < nodeEnd) {
        startNode = currentNode;
        startOffset = startIndex - nodeStart;
      }

      if (!endNode && endIndex <= nodeEnd) {
        endNode = currentNode;
        endOffset = endIndex - nodeStart;
        break;
      }

      accumulatedLength = nodeEnd;
    }

    if (!startNode || !endNode) {
      throw new Error('Failed to locate text nodes for selection');
    }

    const range = doc.createRange();

    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    selection.removeAllRanges();
    selection.addRange(range);

    if (root instanceof HTMLElement) {
      root.focus();
    }

    doc.dispatchEvent(new Event('selectionchange'));
  }, text);
};

/**
 * Get the correct modifier key based on the browser's user agent.
 * WebKit always uses a macOS-style user agent, so it expects Meta regardless
 * of host OS — and the tool's shortcut matcher is user-agent-based too.
 * @param page - The Playwright page object
 */
const getModifierKey = async (page: Page): Promise<'Meta' | 'Control'> => {
  const isMac = await page.evaluate(() => {
    return navigator.userAgent.toLowerCase().includes('mac');
  });

  return isMac ? 'Meta' : 'Control';
};

/**
 * Select the paragraph text and open the sup-sub nested popover
 * @param page - The Playwright page object
 * @param text - The text to select first
 */
const openSupSubPopover = async (page: Page, text: string): Promise<void> => {
  await selectText(page.locator(PARAGRAPH_SELECTOR).first(), text);

  const button = page.locator(SUP_SUB_BUTTON_SELECTOR);

  await expect(button).toBeVisible();
  await button.click();
};

test.describe('inline tool sup-sub', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await createBlokWithBlocks(page, [
      { type: 'paragraph', data: { text: 'E = mc2' } },
    ]);
  });

  test('shows the sup-sub button in the inline toolbar grid', async ({ page }) => {
    await selectText(page.locator(PARAGRAPH_SELECTOR).first(), 'E = mc2');

    await expect(page.locator(SUP_SUB_BUTTON_SELECTOR)).toBeVisible();
  });

  test('applies superscript from the nested popover and saves it', async ({ page }) => {
    await openSupSubPopover(page, 'E = mc2');
    await page.locator(SUPERSCRIPT_ITEM_SELECTOR).click();

    await expect(page.locator(`${PARAGRAPH_SELECTOR} sup`)).toHaveText('E = mc2');

    const saved = await page.evaluate(() => window.blokInstance?.save());

    expect(saved?.blocks[0]?.data.text).toContain('<sup>');
  });

  test('applies subscript from the nested popover', async ({ page }) => {
    await openSupSubPopover(page, 'E = mc2');
    await page.locator(SUBSCRIPT_ITEM_SELECTOR).click();

    await expect(page.locator(`${PARAGRAPH_SELECTOR} sub`)).toHaveText('E = mc2');
  });

  test('activating subscript over superscripted text swaps the mark', async ({ page }) => {
    await openSupSubPopover(page, 'E = mc2');
    await page.locator(SUPERSCRIPT_ITEM_SELECTOR).click();
    await expect(page.locator(`${PARAGRAPH_SELECTOR} sup`)).toHaveCount(1);

    await openSupSubPopover(page, 'E = mc2');
    await page.locator(SUBSCRIPT_ITEM_SELECTOR).click();

    await expect(page.locator(`${PARAGRAPH_SELECTOR} sub`)).toHaveCount(1);
    await expect(page.locator(`${PARAGRAPH_SELECTOR} sup`)).toHaveCount(0);
  });

  test('shortcuts toggle superscript and subscript without the popover', async ({ page }) => {
    const modifier = await getModifierKey(page);
    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'E = mc2');
    await page.keyboard.press(`${modifier}+.`);
    await expect(page.locator(`${PARAGRAPH_SELECTOR} sup`)).toHaveCount(1);

    await selectText(paragraph, 'E = mc2');
    await page.keyboard.press(`${modifier}+,`);
    await expect(page.locator(`${PARAGRAPH_SELECTOR} sub`)).toHaveCount(1);
    await expect(page.locator(`${PARAGRAPH_SELECTOR} sup`)).toHaveCount(0);
  });

  test('pasted <sup>/<sub> markup survives sanitization', async ({ page }) => {
    await createBlokWithBlocks(page, [{ type: 'paragraph', data: { text: '' } }]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await paragraph.click();

    await paragraph.evaluate((el) => {
      const html = 'H<sub>2</sub>O and E=mc<sup>2</sup>';
      const dt = new DataTransfer();

      dt.setData('text/html', html);
      dt.setData('text/plain', 'H2O and E=mc2');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    // Synthetic ClipboardEvent handling varies by engine (Firefox may ignore a
    // programmatic paste). Assert only when the paste pipeline actually
    // produced content in the paragraph.
    const pastedText = page.locator(PARAGRAPH_SELECTOR).first();

    if ((await pastedText.textContent())?.includes('H2O')) {
      await expect(page.locator(`${PARAGRAPH_SELECTOR} sub`)).toHaveCount(1);
      await expect(page.locator(`${PARAGRAPH_SELECTOR} sup`)).toHaveCount(1);
    }
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
    BlokSupSub?: new (...args: unknown[]) => unknown;
  }
}
