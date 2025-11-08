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
  }, { holderId: HOLDER_ID,
    blocks });
};

/**
 * Select text content within a locator by string match
 *
 * @param locator - The Playwright locator for the element containing the text
 * @param text - The text string to select within the element
 */
const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    // Walk text nodes to find the target text within the element
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
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

    const range = element.ownerDocument.createRange();

    range.setStart(textNode, start);
    range.setEnd(textNode, start + targetText.length);

    const selection = element.ownerDocument.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    element.ownerDocument.dispatchEvent(new Event('selectionchange'));
  }, text);
};

test.describe('Inline Tool Bold', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should detect bold state when selection spans multiple bold words with non-bold space', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<b>first</b> <b>second</b>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await paragraph.evaluate((el) => {
      const paragraphEl = el as HTMLElement;
      const doc = paragraphEl.ownerDocument;
      const range = doc.createRange();
      const selection = doc.getSelection();

      if (!selection) {
        throw new Error('Selection not available');
      }

      const bolds = paragraphEl.querySelectorAll('strong, b');
      const firstBold = bolds[0];
      const secondBold = bolds[1];

      if (!firstBold || !secondBold) {
        throw new Error('Bold elements not found');
      }

      const firstBoldText = firstBold.firstChild;
      const secondBoldText = secondBold.firstChild;

      if (!firstBoldText || !secondBoldText) {
        throw new Error('Text nodes not found');
      }

      range.setStart(firstBoldText, 0);
      range.setEnd(secondBoldText, secondBoldText.textContent?.length ?? 0);

      selection.removeAllRanges();
      selection.addRange(range);

      doc.dispatchEvent(new Event('selectionchange'));
    });

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} .ce-popover--opened`)).toHaveCount(1);
    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`)).toHaveClass(/ce-popover-item--active/);
  });

  test('should detect bold state when selection is within a single bold word', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<b>bold text</b>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'bold');

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`)).toHaveClass(/ce-popover-item--active/);
  });

  test('should not detect bold state when selection is in non-bold text', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'normal text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'normal');

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`)).not.toHaveClass(/ce-popover-item--active/);
  });

  test('should toggle bold when selection spans multiple separate bold elements', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<b>first</b> <b>second</b>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    // Select text spanning both bold elements
    await paragraph.evaluate((el) => {
      const paragraphEl = el as HTMLElement;
      const doc = paragraphEl.ownerDocument;
      const range = doc.createRange();
      const selection = doc.getSelection();

      if (!selection) {
        throw new Error('Selection not available');
      }

      const bolds = paragraphEl.querySelectorAll('strong, b');
      const firstBold = bolds[0];
      const secondBold = bolds[1];

      if (!firstBold || !secondBold) {
        throw new Error('Bold elements not found');
      }

      const firstBoldText = firstBold.firstChild;
      const secondBoldText = secondBold.firstChild;

      if (!firstBoldText || !secondBoldText) {
        throw new Error('Text nodes not found');
      }

      range.setStart(firstBoldText, 0);
      range.setEnd(secondBoldText, secondBoldText.textContent?.length ?? 0);

      selection.removeAllRanges();
      selection.addRange(range);

      doc.dispatchEvent(new Event('selectionchange'));
    });

    // Click bold button to toggle (should unwrap and then wrap together)
    await page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`).click();

    // Wait for the text to be wrapped in a single <strong> tag
    await page.waitForFunction(
      ({ selector }) => {
        const element = document.querySelector(selector);

        return element && /<strong>first second<\/strong>/.test(element.innerHTML);
      },
      {
        selector: PARAGRAPH_SELECTOR,
      }
    );

    // Verify that the text is now wrapped in a single <strong> tag
    const html = await paragraph.innerHTML();

    expect(html).toMatch(/<strong>first second<\/strong>/);
  });

  test('should make entire selection bold when it contains both bold and non-bold text', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<b>bold</b> normal <b>bold2</b>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    // Select text spanning bold and non-bold
    await paragraph.evaluate((el) => {
      const paragraphEl = el as HTMLElement;
      const doc = paragraphEl.ownerDocument;
      const range = doc.createRange();
      const selection = doc.getSelection();

      if (!selection) {
        throw new Error('Selection not available');
      }

      const bolds = paragraphEl.querySelectorAll('strong, b');
      const firstBold = bolds[0];
      const secondBold = bolds[1];

      if (!firstBold || !secondBold) {
        throw new Error('Bold elements not found');
      }

      const firstBoldText = firstBold.firstChild;
      const secondBoldText = secondBold.firstChild;

      if (!firstBoldText || !secondBoldText) {
        throw new Error('Text nodes not found');
      }

      // Select from first bold through second bold (including the " normal " text)
      range.setStart(firstBoldText, 0);
      range.setEnd(secondBoldText, secondBoldText.textContent?.length ?? 0);

      selection.removeAllRanges();
      selection.addRange(range);

      doc.dispatchEvent(new Event('selectionchange'));
    });

    // Click bold button (should unwrap existing bold, then wrap everything)
    await page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`).click();

    // Wait for all selected text to be wrapped in a single <strong> tag
    await page.waitForFunction(
      ({ selector }) => {
        const element = document.querySelector(selector);

        return element && /<strong>bold normal bold2<\/strong>/.test(element.innerHTML);
      },
      {
        selector: PARAGRAPH_SELECTOR,
      }
    );

    // Verify that all selected text is now wrapped in a single <strong> tag
    const html = await paragraph.innerHTML();

    expect(html).toMatch(/<strong>bold normal bold2<\/strong>/);
  });

  test('should remove bold when toggled off on a fully bold selection', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<b>fully bold</b>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'fully bold');

    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`);

    await expect(boldButton).toHaveClass(/ce-popover-item--active/);

    await boldButton.click();

    await expect(boldButton).not.toHaveClass(/ce-popover-item--active/);

    const html = await paragraph.innerHTML();

    expect(html).toBe('fully bold');
  });

  test('should toggle bold using keyboard shortcut', async ({ page }) => {
    // eslint-disable-next-line playwright/no-conditional-in-test
    const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Keyboard shortcut',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'Keyboard');

    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`);

    await page.keyboard.press(`${modifierKey}+b`);

    await expect(boldButton).toHaveClass(/ce-popover-item--active/);

    let html = await paragraph.innerHTML();

    expect(html).toMatch(/<(strong|b)>Keyboard<\/(strong|b)> shortcut/);

    await page.keyboard.press(`${modifierKey}+b`);

    await expect(boldButton).not.toHaveClass(/ce-popover-item--active/);

    html = await paragraph.innerHTML();

    expect(html).toBe('Keyboard shortcut');
  });

  test('should apply bold formatting to typed text with a collapsed caret', async ({ page }) => {
    // eslint-disable-next-line playwright/no-conditional-in-test
    const modifierKey = process.platform === 'darwin' ? 'Meta' : 'Control';

    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Typing test',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await paragraph.evaluate((element) => {
      const paragraphEl = element as HTMLElement;
      const doc = paragraphEl.ownerDocument;
      const textNode = paragraphEl.childNodes[paragraphEl.childNodes.length - 1];

      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        throw new Error('Expected trailing text node');
      }

      const range = doc.createRange();
      const selection = doc.getSelection();

      range.setStart(textNode, textNode.textContent?.length ?? 0);
      range.collapse(true);

      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    await page.keyboard.press(`${modifierKey}+b`);
    await page.keyboard.type(' Bold');
    await page.keyboard.press(`${modifierKey}+b`);
    await page.keyboard.type(' normal');

    const html = await paragraph.innerHTML();

    expect(html.replace(/&nbsp;/g, ' ')).toBe('Typing test<strong> Bold</strong> normal');
  });

  test('should preserve links when applying bold across anchor boundaries', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<a href="https://example.com">link</a> text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await paragraph.evaluate((element) => {
      const paragraphEl = element as HTMLElement;
      const doc = paragraphEl.ownerDocument;
      const anchor = paragraphEl.querySelector('a');
      const textNode = paragraphEl.childNodes[1];

      if (!anchor || !anchor.firstChild || !textNode) {
        throw new Error('Expected anchor and trailing text');
      }

      const range = doc.createRange();
      const selection = doc.getSelection();

      range.setStart(anchor.firstChild, 0);
      range.setEnd(textNode, textNode.textContent?.length ?? 0);

      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    await page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`).click();

    const html = await paragraph.innerHTML();

    expect(html).toMatch(/<strong><a href="https:\/\/example.com">link<\/a> text<\/strong>/);
  });

  test('should persist bold markup in saved output', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'bold text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'bold');

    await page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`).click();

    const savedData = await page.evaluate<OutputData | undefined>(async () => {
      return window.editorInstance?.save();
    });

    expect(savedData).toBeDefined();

    const paragraphBlock = savedData?.blocks.find((block) => block.type === 'paragraph');

    expect(paragraphBlock?.data.text).toMatch(/<(strong|b)>bold<\/(strong|b)> text/);
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}
