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
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-block-tool="paragraph"] .ce-paragraph`;
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
    container.setAttribute('data-testid', holderId);
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

test.describe('inline tool italic', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('detects italic state across multiple italic words', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<i>first</i> <i>second</i>',
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

      const italics = paragraphEl.querySelectorAll('i');
      const firstItalic = italics[0];
      const secondItalic = italics[1];

      if (!firstItalic || !secondItalic) {
        throw new Error('Italic elements not found');
      }

      const firstItalicText = firstItalic.firstChild;
      const secondItalicText = secondItalic.firstChild;

      if (!firstItalicText || !secondItalicText) {
        throw new Error('Text nodes not found');
      }

      range.setStart(firstItalicText, 0);
      range.setEnd(secondItalicText, secondItalicText.textContent?.length ?? 0);

      selection.removeAllRanges();
      selection.addRange(range);

      doc.dispatchEvent(new Event('selectionchange'));
    });

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-popover-opened="true"]`)).toHaveCount(1);
    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`)).toHaveAttribute('data-blok-popover-item-active', 'true');
  });

  test('detects italic state within a single word', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<i>italic text</i>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'italic');

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`)).toHaveAttribute('data-blok-popover-item-active', 'true');
  });

  test('does not detect italic state in normal text', async ({ page }) => {
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

    await expect(page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`)).not.toHaveAttribute('data-blok-popover-item-active', 'true');
  });

  test('toggles italic across multiple italic elements', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<i>first</i> <i>second</i>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    // Select text spanning both italic elements
    await paragraph.evaluate((el) => {
      const paragraphEl = el as HTMLElement;
      const doc = paragraphEl.ownerDocument;
      const range = doc.createRange();
      const selection = doc.getSelection();

      if (!selection) {
        throw new Error('Selection not available');
      }

      const italics = paragraphEl.querySelectorAll('i');
      const firstItalic = italics[0];
      const secondItalic = italics[1];

      if (!firstItalic || !secondItalic) {
        throw new Error('Italic elements not found');
      }

      const firstItalicText = firstItalic.firstChild;
      const secondItalicText = secondItalic.firstChild;

      if (!firstItalicText || !secondItalicText) {
        throw new Error('Text nodes not found');
      }

      range.setStart(firstItalicText, 0);
      range.setEnd(secondItalicText, secondItalicText.textContent?.length ?? 0);

      selection.removeAllRanges();
      selection.addRange(range);

      doc.dispatchEvent(new Event('selectionchange'));
    });

    const italicButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`);

    // Verify italic button is active (since all text is visually italic)
    await expect(italicButton).toHaveAttribute('data-blok-popover-item-active', 'true');

    // Click italic button - should remove italic on first click (since selection is visually italic)
    await italicButton.click();

    // Wait for the toolbar state to update (italic button should no longer be active)
    await expect(italicButton).not.toHaveAttribute('data-blok-popover-item-active', 'true');

    // Verify that italic has been removed
    const html = await paragraph.innerHTML();

    expect(html).toBe('first second');
    expect(html).not.toMatch(/<i>/);
  });

  test('makes mixed selection (italic and normal text) italic', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<i>italic</i> normal <i>italic2</i>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    // Select text spanning italic and non-italic
    await paragraph.evaluate((el) => {
      const paragraphEl = el as HTMLElement;
      const doc = paragraphEl.ownerDocument;
      const range = doc.createRange();
      const selection = doc.getSelection();

      if (!selection) {
        throw new Error('Selection not available');
      }

      const italics = paragraphEl.querySelectorAll('i');
      const firstItalic = italics[0];
      const secondItalic = italics[1];

      if (!firstItalic || !secondItalic) {
        throw new Error('Italic elements not found');
      }

      const firstItalicText = firstItalic.firstChild;
      const secondItalicText = secondItalic.firstChild;

      if (!firstItalicText || !secondItalicText) {
        throw new Error('Text nodes not found');
      }

      // Select from first italic through second italic (including the " normal " text)
      range.setStart(firstItalicText, 0);
      range.setEnd(secondItalicText, secondItalicText.textContent?.length ?? 0);

      selection.removeAllRanges();
      selection.addRange(range);

      doc.dispatchEvent(new Event('selectionchange'));
    });

    // Click italic button (should unwrap existing italic, then wrap everything)
    await page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`).click();

    // Wait for all selected text to be wrapped in a single <i> tag
    await page.waitForFunction(
      ({ selector }) => {
        const element = document.querySelector(selector);

        return element && /<i>italic normal italic2<\/i>/.test(element.innerHTML);
      },
      {
        selector: PARAGRAPH_SELECTOR,
      }
    );

    // Verify that all selected text is now wrapped in a single <i> tag
    const html = await paragraph.innerHTML();

    console.log('Mixed selection HTML:', html);

    // Allow for merged tags or separate tags
    expect(html).toMatch(/<i>.*italic.*normal.*italic2.*<\/i>/);
  });

  test('removes italic from fully italic selection', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<i>fully italic</i>',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'fully italic');

    const italicButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`);

    await expect(italicButton).toHaveAttribute('data-blok-popover-item-active', 'true');

    await italicButton.click();

    await expect(italicButton).not.toHaveAttribute('data-blok-popover-item-active', 'true');

    const html = await paragraph.innerHTML();

    expect(html).toBe('fully italic');
  });

  test('toggles italic with keyboard shortcut', async ({ page }) => {
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
    await paragraph.focus();

    const italicButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`);

    await page.keyboard.press(`${MODIFIER_KEY}+i`);

    await expect(italicButton).toHaveAttribute('data-blok-popover-item-active', 'true');

    let html = await paragraph.innerHTML();

    expect(html).toMatch(/<i>Keyboard<\/i> shortcut/);

    await page.keyboard.press(`${MODIFIER_KEY}+i`);

    await expect(italicButton).not.toHaveAttribute('data-blok-popover-item-active', 'true');

    html = await paragraph.innerHTML();

    expect(html).toBe('Keyboard shortcut');
  });

  test('applies italic to typed text', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Typing test',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

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

    await paragraph.focus();

    await page.keyboard.press(`${MODIFIER_KEY}+i`);
    await page.keyboard.insertText(' Italic');
    await page.keyboard.press(`${MODIFIER_KEY}+i`);
    await page.keyboard.insertText(' normal');

    const html = await paragraph.innerHTML();

    expect(html.replace(/&nbsp;/g, ' ').replace(/\u200B/g, '')).toBe('Typing test<i> Italic</i> normal');
  });

  test('persists italic in saved output', async ({ page }) => {
    await createEditorWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'italic text',
        },
      },
    ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await selectText(paragraph, 'italic');

    await page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`).click();

    const savedData = await page.evaluate<OutputData | undefined>(async () => {
      return window.editorInstance?.save();
    });

    expect(savedData).toBeDefined();

    const paragraphBlock = savedData?.blocks.find((block) => block.type === 'paragraph');

    expect(paragraphBlock?.data.text).toMatch(/<i>italic<\/i> text/);
  });

  test('removes italic from selection within italic text', async ({ page }) => {
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

    // Step 2: Select entire text and make it italic
    await selectText(paragraph, 'Some text');

    const italicButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`);

    await italicButton.click();

    // Wait for the text to be wrapped in italic tags
    await page.waitForFunction(
      ({ selector }) => {
        const element = document.querySelector(selector);

        return element && /<i>Some text<\/i>/.test(element.innerHTML);
      },
      {
        selector: PARAGRAPH_SELECTOR,
      }
    );

    // Verify initial italic state
    let html = await paragraph.innerHTML();

    expect(html).toMatch(/<i>Some text<\/i>/);

    // Step 3: Select only "Some" and remove italic formatting
    await selectText(paragraph, 'Some');

    // Verify italic button is active (since "Some" is italic)
    await expect(italicButton).toHaveAttribute('data-blok-popover-item-active', 'true');

    // Click to remove italic from "Some"
    await italicButton.click();

    // Wait for the toolbar state to update (italic button should no longer be active for "Some")
    await expect(italicButton).not.toHaveAttribute('data-blok-popover-item-active', 'true');

    // Step 4: Verify that "text" is still italic while "Some" is not
    html = await paragraph.innerHTML();

    // "text" should be wrapped in italic tags (with space before it)
    expect(html).toMatch(/<i>\s*text<\/i>/);
    // "Some" should not be wrapped in italic tags
    expect(html).not.toMatch(/<i>Some<\/i>/);
  });

  test('removes italic from separately italic words', async ({ page }) => {
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
    const italicButton = page.locator(`${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="italic"]`);

    // Step 2: Make "some" italic
    await selectText(paragraph, 'some');
    await italicButton.click();

    // Verify "some" is now italic
    let html = await paragraph.innerHTML();

    expect(html).toMatch(/<i>some<\/i> text/);

    // Step 3: Make "text" italic (now we have <i>some</i> <i>text</i>)
    await selectText(paragraph, 'text');
    await italicButton.click();

    // Verify both words are now italic with space between them
    html = await paragraph.innerHTML();

    expect(html).toMatch(/<i>some<\/i> <i>text<\/i>/);

    // Step 4: Select the whole phrase including the space
    await paragraph.evaluate((el) => {
      const paragraphEl = el as HTMLElement;
      const doc = paragraphEl.ownerDocument;
      const range = doc.createRange();
      const selection = doc.getSelection();

      if (!selection) {
        throw new Error('Selection not available');
      }

      const italics = paragraphEl.querySelectorAll('i');
      const firstItalic = italics[0];
      const secondItalic = italics[1];

      if (!firstItalic || !secondItalic) {
        throw new Error('Italic elements not found');
      }

      const firstItalicText = firstItalic.firstChild;
      const secondItalicText = secondItalic.firstChild;

      if (!firstItalicText || !secondItalicText) {
        throw new Error('Text nodes not found');
      }

      // Select from start of first italic to end of second italic (including the space)
      range.setStart(firstItalicText, 0);
      range.setEnd(secondItalicText, secondItalicText.textContent?.length ?? 0);

      selection.removeAllRanges();
      selection.addRange(range);

      doc.dispatchEvent(new Event('selectionchange'));
    });

    // Step 5: Verify the editor indicates the selection is italic (button is active)
    await expect(italicButton).toHaveAttribute('data-blok-popover-item-active', 'true');

    // Step 6: Click italic button - should remove italic on first click (not wrap again)
    await italicButton.click();

    // Verify italic button is no longer active
    await expect(italicButton).not.toHaveAttribute('data-blok-popover-item-active', 'true');

    // Verify that italic has been removed from both words on first click
    html = await paragraph.innerHTML();

    expect(html).toBe('some text');
    expect(html).not.toMatch(/<i>/);
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}
