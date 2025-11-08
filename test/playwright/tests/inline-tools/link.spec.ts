import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '@/types';
import type { OutputData } from '@/types';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../cypress/fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const EDITOR_SELECTOR = '[data-cy=editorjs]';
const PARAGRAPH_SELECTOR = `${EDITOR_SELECTOR} .ce-paragraph`;
const INLINE_TOOLBAR_SELECTOR = `${EDITOR_SELECTOR} [data-cy=inline-toolbar]`;
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_SELECTOR} [data-item-name="link"] button`;
const LINK_INPUT_SELECTOR = '.ce-inline-tool-input';
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
 * Select text content within a locator by string match
 *
 * @param locator - The Playwright locator for the element containing the text
 * @param text - The text string to select within the element
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const el = element as HTMLElement;
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let textNode: Node | null = null;
    let start = -1;

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const content = node.textContent ?? '';
      const idx = content.indexOf(targetText);

      if (idx !== -1) {
        textNode = node;
        start = idx;
        break;
      }
    }

    if (!textNode || start === -1) {
      throw new Error(`Text "${targetText}" was not found in element`);
    }

    const range = doc.createRange();

    range.setStart(textNode, start);
    range.setEnd(textNode, start + targetText.length);

    const selection = doc.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    doc.dispatchEvent(new Event('selectionchange'));
  }, text);
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
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should create a link by pressing Enter in the inline input', async ({ page }) => {
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

  test('should remove fake background on selection change', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block text',
        },
      },
      {
        type: 'paragraph',
        data: {
          text: 'Second block text',
        },
      },
    ]);

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).first();
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR).nth(1);

    await selectText(firstParagraph, 'First block text');
    await page.keyboard.press(`${MODIFIER_KEY}+k`);

    await expect(page.locator(`${PARAGRAPH_SELECTOR} span[style]`)).toHaveCount(1);

    await selectText(secondParagraph, 'Second block text');

    await expect(page.locator(`${PARAGRAPH_SELECTOR} span[style]`)).toHaveCount(0);
  });

  test('should create a link via the inline toolbar button', async ({ page }) => {
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

  test('should keep link input open and show validation notice for invalid URLs', async ({ page }) => {
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

  test('should prefill inline input and update an existing link', async ({ page }) => {
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

    const linkButton = page.locator(LINK_BUTTON_SELECTOR);
    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await expect(linkButton).toHaveClass(/ce-inline-tool--unlink/);
    await expect(linkButton).toHaveClass(/ce-inline-tool--active/);
    await expect(linkInput).toHaveValue('https://codex.so');

    await submitLink(page, 'example.org');

    await expect(paragraph.locator('a')).toHaveAttribute('href', 'http://example.org');
  });

  test('should remove link when toggled while selection is inside anchor', async ({ page }) => {
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

    const linkButton = page.locator(LINK_BUTTON_SELECTOR);

    await linkButton.click();

    await expect(paragraph.locator('a')).toHaveCount(0);
  });

  test('should persist link markup in saved output', async ({ page }) => {
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
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}

