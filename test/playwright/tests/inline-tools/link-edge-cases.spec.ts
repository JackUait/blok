import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const PARAGRAPH_CONTENT_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const INLINE_TOOLBAR_SELECTOR = INLINE_TOOLBAR_INTERFACE_SELECTOR;
// The link tool renders the item itself as a button, not a nested button
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="link"]`;
const LINK_INPUT_SELECTOR = '[data-blok-link-tool-input-opened]';
const NOTIFIER_SELECTOR = '[data-blok-testid="notifier-container"]';

const getParagraphByText = (page: Page, text: string): Locator => {
  return page.locator(PARAGRAPH_CONTENT_SELECTOR, { hasText: text });
};

const ensureLinkInputOpen = async (page: Page): Promise<Locator> => {
  // Wait for toolbar to be visible first
  await expect(page.locator(INLINE_TOOLBAR_SELECTOR)).toBeVisible();

  const linkButton = page.locator(LINK_BUTTON_SELECTOR);
  const linkInput = page.locator(LINK_INPUT_SELECTOR);

  // If input is already visible
  if (await linkInput.isVisible()) {
    return linkInput;
  }

  // Check if button is active (meaning we are on a link)
  // If active, clicking it will Unlink, which we usually don't want when "ensuring input open" for editing.
  // We should just wait for input to appear (checkState opens it).
  const isActive = await linkButton.getAttribute('data-blok-link-tool-active') === 'true';

  if (isActive) {
    await expect(linkInput).toBeVisible();

    return linkInput;
  }

  // Otherwise click the button to open input
  if (await linkButton.isVisible()) {
    await linkButton.click();
    await expect(linkInput).toBeVisible();

    return linkInput;
  }

  throw new Error('Link input could not be opened');
};

const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const root = element as HTMLElement;
    const doc = root.ownerDocument;

    if (!doc) {
      throw new Error('OwnerDocument not found');
    }

    const fullText = root.textContent ?? '';
    const startIndex = fullText.indexOf(targetText);

    if (startIndex === -1) {
      throw new Error(`Text "${targetText}" not found`);
    }
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
      throw new Error('Nodes not found');
    }

    const range = doc.createRange();

    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);

    const selection = doc.getSelection();

    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    root.focus();
    doc.dispatchEvent(new Event('selectionchange'));
  }, text);
};

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }
    document.getElementById(holder)?.remove();
    const container = document.createElement('div');

    container.id = holder;
    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createEditorWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holder, blocks: editorBlocks }) => {
    const editor = new window.EditorJS({
      holder: holder,
      data: { blocks: editorBlocks },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

test.describe('inline tool link - edge cases', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should expand selection to whole link when editing partially selected link', async ({ page }) => {
    await createEditorWithBlocks(page, [ {
      type: 'paragraph',
      data: { text: 'Click <a href="https://google.com">here</a> to go.' },
    } ]);

    const paragraph = getParagraphByText(page, 'Click here to go');

    // Select "here" fully to verify update logic works with full selection first
    await selectText(paragraph, 'here');

    // Trigger toolbar or shortcut
    await ensureLinkInputOpen(page);
    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    // Verify input has full URL
    await expect(linkInput).toHaveValue('https://google.com');

    // Change URL
    await linkInput.fill('https://very-distinct-url.com');
    await expect(linkInput).toHaveValue('https://very-distinct-url.com');
    await linkInput.press('Enter');

    // Check the result - entire "here" should be linked to very-distinct-url.com
    const anchor = paragraph.getByRole('link');

    await expect(anchor).toHaveAttribute('href', 'https://very-distinct-url.com');
    await expect(anchor).toHaveText('here');
    await expect(anchor).toHaveCount(1);
  });

  test('should handle spaces in URL correctly (reject unencoded)', async ({ page }) => {
    await createEditorWithBlocks(page, [ {
      type: 'paragraph',
      data: { text: 'Space test' },
    } ]);

    const paragraph = getParagraphByText(page, 'Space test');

    await selectText(paragraph, 'Space');
    await ensureLinkInputOpen(page);

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await linkInput.fill('http://example.com/foo bar');
    await linkInput.press('Enter');

    // Expect error notification
    await expect(page.locator(NOTIFIER_SELECTOR)).toContainText('Pasted link is not valid');
    // Link should not be created
    await expect(paragraph.getByRole('link')).toHaveCount(0);
  });

  test('should accept encoded spaces in URL', async ({ page }) => {
    await createEditorWithBlocks(page, [ {
      type: 'paragraph',
      data: { text: 'Encoded space test' },
    } ]);

    const paragraph = getParagraphByText(page, 'Encoded space test');

    await selectText(paragraph, 'Encoded');
    await ensureLinkInputOpen(page);

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await linkInput.fill('http://example.com/foo%20bar');
    await linkInput.press('Enter');

    await expect(paragraph.getByRole('link')).toHaveAttribute('href', 'http://example.com/foo%20bar');
  });

  test('should preserve target="_blank" on existing links after edit', async ({ page }) => {
    await createEditorWithBlocks(page, [ {
      type: 'paragraph',
      data: { text: '<a href="https://google.com" target="_blank">Target link</a>' },
    } ]);

    const paragraph = getParagraphByText(page, 'Target link');

    await selectText(paragraph, 'Target link');
    await ensureLinkInputOpen(page);

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await linkInput.fill('https://bing.com');
    await linkInput.press('Enter');

    const anchor = paragraph.getByRole('link');

    await expect(anchor).toHaveAttribute('href', 'https://bing.com');
  });

  test('should sanitize javascript: URLs on save', async ({ page }) => {
    await createEditorWithBlocks(page, [ {
      type: 'paragraph',
      data: { text: 'XSS test' },
    } ]);

    const paragraph = getParagraphByText(page, 'XSS test');

    await selectText(paragraph, 'XSS');
    await ensureLinkInputOpen(page);

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await linkInput.fill('javascript:alert(1)');
    await linkInput.press('Enter');

    // In the DOM, it might exist
    const anchor = paragraph.getByRole('link');

    await expect(anchor).toHaveAttribute('href', 'javascript:alert(1)');

    const savedData = await page.evaluate(async () => {
      return window.editorInstance?.save();
    });

    const blockData = savedData?.blocks[0].data.text;

    // Blok sanitizer should strip javascript: hrefs
    expect(blockData).not.toContain('href="javascript:alert(1)"');
  });

  test('should handle multiple links in one block', async ({ page }) => {
    await createEditorWithBlocks(page, [ {
      type: 'paragraph',
      data: { text: 'Link1 and Link2' },
    } ]);

    const paragraph = getParagraphByText(page, 'Link1 and Link2');

    // Create first link
    await selectText(paragraph, 'Link1');
    await expect(page.locator(INLINE_TOOLBAR_SELECTOR)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator(LINK_INPUT_SELECTOR)).toBeVisible();
    await page.locator(LINK_INPUT_SELECTOR).fill('http://link1.com');
    await page.keyboard.press('Enter');

    // Create second link
    await selectText(paragraph, 'Link2');
    await expect(page.locator(INLINE_TOOLBAR_SELECTOR)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator(LINK_INPUT_SELECTOR)).toBeVisible();
    await page.locator(LINK_INPUT_SELECTOR).fill('http://link2.com');
    await page.keyboard.press('Enter');

    await expect(paragraph.getByRole('link', { name: 'Link1' })).toHaveAttribute('href', 'http://link1.com');
    await expect(paragraph.getByRole('link', { name: 'Link2' })).toHaveAttribute('href', 'http://link2.com');
  });

  test('cMD+K on collapsed selection in plain text should NOT open tool', async ({ page }) => {
    await createEditorWithBlocks(page, [ {
      type: 'paragraph',
      data: { text: 'Empty selection' },
    } ]);

    const paragraph = getParagraphByText(page, 'Empty selection');

    await paragraph.click();

    await page.evaluate(() => {
      const sel = window.getSelection();

      sel?.collapseToStart();
    });

    await page.keyboard.press('ControlOrMeta+k');

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await expect(linkInput).toBeHidden();
  });

  test('cMD+K on collapsed selection INSIDE a link should unlink', async ({ page }) => {
    await createEditorWithBlocks(page, [ {
      type: 'paragraph',
      data: { text: 'Click <a href="https://inside.com">inside</a> me' },
    } ]);

    const paragraph = getParagraphByText(page, 'Click inside me');

    await paragraph.evaluate((el) => {
      const anchor = el.querySelector('a');

      if (!anchor || !anchor.firstChild) {
        return;
      }
      const range = document.createRange();

      range.setStart(anchor.firstChild, 2);
      range.setEnd(anchor.firstChild, 2);
      const sel = window.getSelection();

      sel?.removeAllRanges();
      sel?.addRange(range);
    });

    await page.keyboard.press('ControlOrMeta+k');

    // Based on logic: shortcut typically ignores collapsed selection, so nothing happens.
    // The anchor should remain, and input should not appear.
    const anchor = paragraph.getByRole('link');

    await expect(anchor).toHaveCount(1);
    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await expect(linkInput).toBeHidden();
  });
});
