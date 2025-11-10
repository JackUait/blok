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

  test('detects bold state across multiple bold words', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<strong>first</strong> <strong>second</strong>',
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

      const bolds = paragraphEl.querySelectorAll('strong');
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

  test('detects bold state within a single word', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<strong>bold text</strong>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    await selectText(paragraph, 'bold');

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`)).toHaveClass(/ce-popover-item--active/);
  });

  test('does not detect bold state in normal text', async ({ page }) => {
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

  test('toggles bold across multiple bold elements', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<strong>first</strong> <strong>second</strong>',
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

      const bolds = paragraphEl.querySelectorAll('strong');
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

  test('makes mixed selection (bold and normal text) bold', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<strong>bold</strong> normal <strong>bold2</strong>',
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

      const bolds = paragraphEl.querySelectorAll('strong');
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

  test('removes bold from fully bold selection', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<strong>fully bold</strong>',
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

  test('toggles bold with keyboard shortcut', async ({ page }) => {
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

    expect(html).toMatch(/<strong>Keyboard<\/strong> shortcut/);

    await page.keyboard.press(`${modifierKey}+b`);

    await expect(boldButton).not.toHaveClass(/ce-popover-item--active/);

    html = await paragraph.innerHTML();

    expect(html).toBe('Keyboard shortcut');
  });

  test('applies bold to typed text', async ({ page }) => {
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

  test('persists bold in saved output', async ({ page }) => {
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

    expect(paragraphBlock?.data.text).toMatch(/<strong>bold<\/strong> text/);
  });

  test('removes bold from selected word while keeping the rest bold', async ({ page }) => {
    // Step 1: Create editor with "Some text"
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Some text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();

    // Step 2: Select entire text and make it bold
    await selectText(paragraph, 'Some text');

    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`);

    await boldButton.click();

    // Wait for the text to be wrapped in bold tags
    await page.waitForFunction(
      ({ selector }) => {
        const element = document.querySelector(selector);

        return element && /<strong>Some text<\/strong>/.test(element.innerHTML);
      },
      {
        selector: PARAGRAPH_SELECTOR,
      }
    );

    // Verify initial bold state
    let html = await paragraph.innerHTML();

    expect(html).toMatch(/<strong>Some text<\/strong>/);

    // Step 3: Select only "Some" and remove bold formatting
    await selectText(paragraph, 'Some');

    // Verify bold button is active (since "Some" is bold)
    await expect(boldButton).toHaveClass(/ce-popover-item--active/);

    // Click to remove bold from "Some"
    await boldButton.click();

    // Wait for the toolbar state to update (bold button should no longer be active for "Some")
    await expect(boldButton).not.toHaveClass(/ce-popover-item--active/);

    // Step 4: Verify that "text" is still bold while "Some" is not
    html = await paragraph.innerHTML();

    // "text" should be wrapped in bold tags (with space before it)
    expect(html).toMatch(/<strong>\s*text<\/strong>/);
    // "Some" should not be wrapped in bold tags
    expect(html).not.toMatch(/<strong>Some<\/strong>/);
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}
