import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR, MODIFIER_KEY } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-block-tool="paragraph"] .ce-paragraph`;
const INLINE_TOOLBAR_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-testid=inline-toolbar]`;

/**
 * Reset the editor holder and destroy any existing instance
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
    container.dataset.testid = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

/**
 * Create editor with provided blocks
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

test.describe('inline tool bold', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

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

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

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

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-popover-opened="true"]`)).toHaveCount(1);
    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`)).toHaveAttribute('data-popover-item-active', 'true');
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

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'bold');

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`)).toHaveAttribute('data-popover-item-active', 'true');
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

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'normal');

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`)).not.toHaveAttribute('data-popover-item-active', 'true');
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

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

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

    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`);

    // Verify bold button is active (since all text is visually bold)
    await expect(boldButton).toHaveAttribute('data-popover-item-active', 'true');

    // Click bold button - should remove bold on first click (since selection is visually bold)
    await boldButton.click();

    // Wait for the toolbar state to update (bold button should no longer be active)
    await expect(boldButton).not.toHaveAttribute('data-popover-item-active', 'true');

    // Verify that bold has been removed
    const html = await paragraph.innerHTML();

    expect(html).toBe('first second');
    expect(html).not.toMatch(/<strong>/);
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

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

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

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'fully bold');

    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`);

    await expect(boldButton).toHaveAttribute('data-popover-item-active', 'true');

    await boldButton.click();

    await expect(boldButton).not.toHaveAttribute('data-popover-item-active', 'true');

    const html = await paragraph.innerHTML();

    expect(html).toBe('fully bold');
  });

  test('toggles bold with keyboard shortcut', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Keyboard shortcut',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'Keyboard');

    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`);

    await page.keyboard.press(`${MODIFIER_KEY}+b`);

    await expect(boldButton).toHaveAttribute('data-popover-item-active', 'true');

    let html = await paragraph.innerHTML();

    expect(html).toMatch(/<strong>Keyboard<\/strong> shortcut/);

    await page.keyboard.press(`${MODIFIER_KEY}+b`);

    await expect(boldButton).not.toHaveAttribute('data-popover-item-active', 'true');

    html = await paragraph.innerHTML();

    expect(html).toBe('Keyboard shortcut');
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

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'bold');

    await page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`).click();

    const savedData = await page.evaluate<OutputData | undefined>(async () => {
      return window.editorInstance?.save();
    });

    expect(savedData).toBeDefined();

    const paragraphBlock = savedData?.blocks.find((block) => block.type === 'paragraph');

    expect(paragraphBlock?.data.text).toMatch(/<strong>bold<\/strong> text/);
  });

  test('removes bold from selection within bold text', async ({ page }) => {
    // Step 1: Create editor with "Some text"
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Some text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

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
    await expect(boldButton).toHaveAttribute('data-popover-item-active', 'true');

    // Click to remove bold from "Some"
    await boldButton.click();

    // Wait for the toolbar state to update (bold button should no longer be active for "Some")
    await expect(boldButton).not.toHaveAttribute('data-popover-item-active', 'true');

    // Step 4: Verify that "text" is still bold while "Some" is not
    html = await paragraph.innerHTML();

    // "text" should be wrapped in bold tags (with space before it)
    expect(html).toMatch(/<strong>\s*text<\/strong>/);
    // "Some" should not be wrapped in bold tags
    expect(html).not.toMatch(/<strong>Some<\/strong>/);
  });

  test('removes bold from separately bolded words', async ({ page }) => {
    // Step 1: Start with normal text "some text"
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'some text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    const boldButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-item-name="bold"]`);

    // Step 2: Make "some" bold
    await selectText(paragraph, 'some');
    await boldButton.click();

    // Verify "some" is now bold
    let html = await paragraph.innerHTML();

    expect(html).toMatch(/<strong>some<\/strong> text/);

    // Step 3: Make "text" bold (now we have <strong>some</strong> <strong>text</strong>)
    await selectText(paragraph, 'text');
    await boldButton.click();

    // Verify both words are now bold with space between them
    html = await paragraph.innerHTML();

    expect(html).toMatch(/<strong>some<\/strong> <strong>text<\/strong>/);

    // Step 4: Select the whole phrase including the space
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

      // Select from start of first bold to end of second bold (including the space)
      range.setStart(firstBoldText, 0);
      range.setEnd(secondBoldText, secondBoldText.textContent?.length ?? 0);

      selection.removeAllRanges();
      selection.addRange(range);

      doc.dispatchEvent(new Event('selectionchange'));
    });

    // Step 5: Verify the editor indicates the selection is bold (button is active)
    await expect(boldButton).toHaveAttribute('data-popover-item-active', 'true');

    // Step 6: Click bold button - should remove bold on first click (not wrap again)
    await boldButton.click();

    // Verify bold button is no longer active
    await expect(boldButton).not.toHaveAttribute('data-popover-item-active', 'true');

    // Verify that bold has been removed from both words on first click
    html = await paragraph.innerHTML();

    expect(html).toBe('some text');
    expect(html).not.toMatch(/<strong>/);
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}
