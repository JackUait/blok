import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../cypress/fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const PARAGRAPH_SELECTOR = '[data-block-tool="paragraph"]';
const INLINE_TOOLBAR_SELECTOR = INLINE_TOOLBAR_INTERFACE_SELECTOR;
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_SELECTOR} [data-item-name="link"] button`;
const LINK_INPUT_SELECTOR = `input[data-link-tool-input-opened]`;
const NOTIFIER_SELECTOR = '.cdx-notifies';
const MODIFIER_KEY = process.platform === 'darwin' ? 'Meta' : 'Control';

const selectAll = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => {
    const el = element as HTMLElement;
    const doc = el.ownerDocument;
    const range = doc.createRange();
    const selection = doc.getSelection();

    if (!selection) {
      throw new Error('Selection is not available');
    }

    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: Node[] = [];

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    if (textNodes.length === 0) {
      throw new Error('Nothing to select');
    }

    const startNode = textNodes[0];
    const endNode = textNodes[textNodes.length - 1];
    const endOffset = endNode.textContent?.length ?? 0;

    range.setStart(startNode, 0);
    range.setEnd(endNode, endOffset);

    selection.removeAllRanges();
    selection.addRange(range);
    doc.dispatchEvent(new Event('selectionchange'));
  });
};

/**
 * Reset the editor holder and destroy any existing instance
 *
 * @param page - The Playwright page object
 */
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

/**
 * Create editor with provided blocks
 *
 * @param page - The Playwright page object
 * @param blocks - The blocks data to initialize the editor with
 */
const createEditorWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId, blocks: editorBlocks }) => {
    const editor = new window.EditorJS({
      holder: holderId,
      data: { blocks: editorBlocks },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, {
    holderId: HOLDER_ID,
    blocks,
  });
};

/**
 * Select text content within a locator by string match using Playwright's built-in methods
 *
 * @param locator - The Playwright locator for the element containing the text
 * @param text - The text string to select within the element
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  // Get the full text content to find the position
  const fullText = await locator.textContent();

  if (!fullText || !fullText.includes(text)) {
    throw new Error(`Text "${text}" was not found in element`);
  }

  const startIndex = fullText.indexOf(text);
  const endIndex = startIndex + text.length;

  // Click on the element to focus it
  await locator.click();

  // Get the page from the locator to use keyboard API
  const page = locator.page();

  // Move cursor to the start of the element
  await page.keyboard.press('Home');

  // Navigate to the start position of the target text
  for (let i = 0; i < startIndex; i++) {
    await page.keyboard.press('ArrowRight');
  }

  // Select the target text by holding Shift and moving right
  await page.keyboard.down('Shift');
  for (let i = startIndex; i < endIndex; i++) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.up('Shift');
};

/**
 * Submit a URL via the inline link input
 *
 * @param page - The Playwright page object
 * @param url - URL to submit
 */
const submitLink = async (page: Page, url: string): Promise<void> => {
  const linkInput = page.locator(LINK_INPUT_SELECTOR);

  await expect(linkInput).toBeVisible();
  await linkInput.fill(url);
  await linkInput.press('Enter');
};

test.describe('Inline Tool Link', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should create a link via Enter key', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'First block text');
    await page.keyboard.press(`${MODIFIER_KEY}+k`);

    await submitLink(page, 'https://codex.so');

    await expect(paragraph.locator('a')).toHaveAttribute('href', 'https://codex.so');
  });

  test('should create a link via toolbar button', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Link me please',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'Link me');

    const linkButton = page.locator(LINK_BUTTON_SELECTOR);

    await expect(linkButton).toBeVisible();
    await linkButton.click();

    await submitLink(page, 'example.com');

    const anchor = paragraph.locator('a');

    await expect(anchor).toHaveAttribute('href', 'http://example.com');
    await expect(anchor).toHaveText('Link me');
  });

  test('should show validation error for invalid URL', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Invalid URL test',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'Invalid URL test');
    await page.keyboard.press(`${MODIFIER_KEY}+k`);

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await linkInput.fill('https://example .com');
    await linkInput.press('Enter');

    await expect(linkInput).toBeVisible();
    await expect(linkInput).toHaveValue('https://example .com');
    await expect(paragraph.locator('a')).toHaveCount(0);

    await page.waitForFunction(({ notifierSelector }) => {
      const notifier = document.querySelector(notifierSelector);

      return Boolean(notifier && notifier.textContent && notifier.textContent.includes('Pasted link is not valid.'));
    }, { notifierSelector: NOTIFIER_SELECTOR });
  });

  test('should fill in and update existing link', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<a href="https://codex.so">First block text</a>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectAll(paragraph);
    // Use keyboard shortcut to trigger the link tool (this will open the toolbar and input)
    await page.keyboard.press(`${MODIFIER_KEY}+k`);

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    // Wait for the input to appear (it should open automatically when a link is detected)
    await expect(linkInput).toBeVisible();
    await expect(linkInput).toHaveValue('https://codex.so');

    // Verify button state - find button by data attributes directly
    const linkButton = page.locator('button[data-link-tool-unlink="true"][data-link-tool-active="true"]');

    await expect(linkButton).toBeVisible();

    await submitLink(page, 'example.org');

    await expect(paragraph.locator('a')).toHaveAttribute('href', 'http://example.org');
  });

  test('should remove link when toggled', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<a href="https://codex.so">Link to remove</a>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectAll(paragraph);
    // Use keyboard shortcut to trigger the link tool
    await page.keyboard.press(`${MODIFIER_KEY}+k`);

    // Find the unlink button by its data attributes
    const linkButton = page.locator('button[data-link-tool-unlink="true"]');

    await expect(linkButton).toBeVisible();
    await linkButton.click();

    await expect(paragraph.locator('a')).toHaveCount(0);
  });

  test('should persist link in saved output', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Persist me',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'Persist me');
    await page.keyboard.press(`${MODIFIER_KEY}+k`);
    await submitLink(page, 'https://codex.so');

    const savedData = await page.evaluate<OutputData | undefined>(async () => {
      return window.editorInstance?.save();
    });

    expect(savedData).toBeDefined();

    const paragraphBlock = savedData?.blocks.find((block) => block.type === 'paragraph');

    expect(paragraphBlock?.data.text).toContain('<a href="https://codex.so">Persist me</a>');
  });

  test('should work in read-only mode', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Clickable link',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    // Create a link
    await selectText(paragraph, 'Clickable link');
    await page.keyboard.press(`${MODIFIER_KEY}+k`);
    await submitLink(page, 'https://example.com');

    // Verify link was created
    const anchor = paragraph.locator('a');

    await expect(anchor).toHaveAttribute('href', 'https://example.com');
    await expect(anchor).toHaveText('Clickable link');

    // Enable read-only mode
    await page.evaluate(async () => {
      if (window.editorInstance) {
        await window.editorInstance.readOnly.toggle(true);
      }
    });

    // Verify read-only mode is enabled
    const isReadOnly = await page.evaluate(() => {
      return window.editorInstance?.readOnly.isEnabled ?? false;
    });

    expect(isReadOnly).toBe(true);

    // Verify link still exists and has correct href
    await expect(anchor).toHaveAttribute('href', 'https://example.com');
    await expect(anchor).toHaveText('Clickable link');

    // Verify link is clickable by checking it's not disabled and has proper href
    const href = anchor;

    await expect(href).toHaveAttribute('href', 'https://example.com');

    // Verify link element is visible and interactive
    await expect(anchor).toBeVisible();
    const isDisabled = await anchor.evaluate((el) => {
      return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
    });

    expect(isDisabled).toBe(false);
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}
