import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Blok from '@/types';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR, INLINE_TOOLBAR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const PARAGRAPH_CONTENT_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-component="paragraph"] [contenteditable]`;
const INLINE_TOOLBAR_SELECTOR = INLINE_TOOLBAR_INTERFACE_SELECTOR;
const LINK_BUTTON_SELECTOR = `${INLINE_TOOLBAR_SELECTOR} [data-blok-item-name="link"]`;
const LINK_INPUT_SELECTOR = '[data-blok-link-tool-input-opened]';
const NOTIFIER_SELECTOR = '[data-blok-testid="notifier-container"]';

const getParagraphByText = (page: Page, text: string): Locator => {
  return page.locator(PARAGRAPH_CONTENT_SELECTOR, { hasText: text });
};

const ensureLinkInputOpen = async (page: Page): Promise<Locator> => {
  await expect(page.locator(INLINE_TOOLBAR_SELECTOR)).toBeVisible();

  const linkInput = page.locator(LINK_INPUT_SELECTOR);

  if (await linkInput.isVisible()) {
    return linkInput;
  }

  const linkButton = page.locator(LINK_BUTTON_SELECTOR);

  await expect(linkButton).toBeVisible();
  await linkButton.click();
  await expect(linkInput).toBeVisible();

  return linkInput;
};

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
 * Create blok with provided blocks
 * @param page - The Playwright page object
 * @param blocks - The blocks data to initialize the blok with
 */
const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    blocks,
  });
};

/**
 * Select text content within a locator by string match using Playwright's built-in methods
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
 * Submit a URL via the inline link input
 * @param page - The Playwright page object
 * @param url - URL to submit
 */
const submitLink = async (page: Page, url: string): Promise<void> => {
  const linkInput = page.locator(LINK_INPUT_SELECTOR);

  await expect(linkInput).toBeVisible();
  await linkInput.fill(url);
  await linkInput.press('Enter');
};

test.describe('inline tool link', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('should create a link via Enter key', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'First block text',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'First block text');

    await selectText(paragraph, 'First block text');
    await ensureLinkInputOpen(page);
    await submitLink(page, 'https://google.com');

    await expect(paragraph.getByRole('link')).toHaveAttribute('href', 'https://google.com');
  });

  test('should create a link via toolbar button', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Link me please',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Link me please');

    await selectText(paragraph, 'Link me');

    await ensureLinkInputOpen(page);
    await submitLink(page, 'example.com');

    const anchor = paragraph.getByRole('link');

    await expect(anchor).toHaveAttribute('href', 'http://example.com');
    await expect(anchor).toHaveText('Link me');
  });

  test('should show validation error for invalid URL', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Invalid URL test',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Invalid URL test');

    await selectText(paragraph, 'Invalid URL test');
    const linkInput = await ensureLinkInputOpen(page);

    await linkInput.fill('https://example .com');
    await linkInput.press('Enter');

    await expect(linkInput).toBeVisible();
    await expect(linkInput).toHaveValue('https://example .com');
    await expect(paragraph.getByRole('link')).toHaveCount(0);

    await page.waitForFunction(({ notifierSelector }) => {
      const notifier = document.querySelector(notifierSelector);

      return Boolean(notifier && notifier.textContent && notifier.textContent.includes('Pasted link is not valid.'));
    }, { notifierSelector: NOTIFIER_SELECTOR });
  });

  test('should fill in and update existing link', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<a href="https://google.com">First block text</a>',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'First block text');

    await selectAll(paragraph);
    const linkInput = await ensureLinkInputOpen(page);

    await expect(linkInput).toHaveValue('https://google.com');

    // Verify button state - find button by data attributes directly
    const linkButton = page.locator('[data-blok-link-tool-unlink="true"][data-blok-link-tool-active="true"]');

    await expect(linkButton).toBeVisible();

    await submitLink(page, 'example.org');

    await expect(paragraph.getByRole('link')).toHaveAttribute('href', 'http://example.org');
  });

  test('should remove link when toggled', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<a href="https://google.com">Link to remove</a>',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Link to remove');

    await selectAll(paragraph);
    await ensureLinkInputOpen(page);

    // Find the unlink button by its data attributes
    const linkButton = page.locator('[data-blok-link-tool-unlink="true"]');

    await expect(linkButton).toBeVisible();
    await linkButton.click();

    await expect(paragraph.getByRole('link')).toHaveCount(0);
  });

  test('should persist link in saved output', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Persist me',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Persist me');

    await selectText(paragraph, 'Persist me');
    await ensureLinkInputOpen(page);
    await submitLink(page, 'https://google.com');

    const savedData = await page.evaluate<OutputData | undefined>(async () => {
      return window.blokInstance?.save();
    });

    expect(savedData).toBeDefined();

    const paragraphBlock = savedData?.blocks.find((block) => block.type === 'paragraph');

    expect(paragraphBlock?.data.text).toContain('<a href="https://google.com" target="_blank" rel="nofollow">Persist me</a>');
  });

  test('should work in read-only mode', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Clickable link',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Clickable link');

    // Create a link
    await selectText(paragraph, 'Clickable link');
    await ensureLinkInputOpen(page);
    await submitLink(page, 'https://example.com');

    // Verify link was created
    const anchor = paragraph.getByRole('link');

    await expect(anchor).toHaveAttribute('href', 'https://example.com');
    await expect(anchor).toHaveText('Clickable link');

    // Enable read-only mode
    await page.evaluate(async () => {
      if (window.blokInstance) {
        await window.blokInstance.readOnly.toggle(true);
      }
    });

    // Verify read-only mode is enabled
    const isReadOnly = await page.evaluate(() => {
      return window.blokInstance?.readOnly.isEnabled ?? false;
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

  test('should open link input via Shortcut (CMD+K)', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Shortcut text',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Shortcut text');

    await selectText(paragraph, 'Shortcut');

    await expect(page.locator(INLINE_TOOLBAR_SELECTOR)).toBeVisible();

    await page.keyboard.press('ControlOrMeta+k');

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await expect(linkInput).toBeVisible();
    await expect(linkInput).toBeFocused();

    await submitLink(page, 'https://shortcut.com');
    await expect(paragraph.getByRole('link')).toHaveAttribute('href', 'https://shortcut.com');
  });

  test('should unlink if input is cleared and Enter is pressed', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<a href="https://google.com">Link to remove</a>',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Link to remove');

    await selectAll(paragraph);
    // Opening link tool on existing link opens the input pre-filled
    const linkInput = await ensureLinkInputOpen(page);

    await expect(linkInput).toHaveValue('https://google.com');

    await linkInput.fill('');
    await linkInput.press('Enter');

    await expect(paragraph.getByRole('link')).toHaveCount(0);
  });

  test('should auto-prepend http:// to domain-only links', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Auto-prepend protocol',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Auto-prepend protocol');

    await selectText(paragraph, 'Auto-prepend');
    await ensureLinkInputOpen(page);
    await submitLink(page, 'google.com');

    await expect(paragraph.getByRole('link')).toHaveAttribute('href', 'http://google.com');
  });

  test('should NOT prepend protocol to internal links', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Internal link',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Internal link');

    await selectText(paragraph, 'Internal');
    await ensureLinkInputOpen(page);
    await submitLink(page, '/about-us');

    await expect(paragraph.getByRole('link')).toHaveAttribute('href', '/about-us');
  });

  test('should NOT prepend protocol to anchors', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Anchor link',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Anchor link');

    await selectText(paragraph, 'Anchor');
    await ensureLinkInputOpen(page);
    await submitLink(page, '#section-1');

    await expect(paragraph.getByRole('link')).toHaveAttribute('href', '#section-1');
  });

  test('should NOT prepend protocol to protocol-relative URLs', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Protocol relative',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Protocol relative');

    await selectText(paragraph, 'Protocol');
    await ensureLinkInputOpen(page);
    await submitLink(page, '//cdn.example.com/lib.js');

    await expect(paragraph.getByRole('link')).toHaveAttribute('href', '//cdn.example.com/lib.js');
  });

  test('should close input when Escape is pressed', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Escape me',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Escape me');

    await selectText(paragraph, 'Escape');
    await ensureLinkInputOpen(page);

    const linkInput = page.locator(LINK_INPUT_SELECTOR);

    await expect(linkInput).toBeVisible();
    await expect(linkInput).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(linkInput).toBeHidden();
    // Escape closes only the link input (nested popover), not the entire inline toolbar.
    // The toolbar remains visible so users can select other formatting options.
    await expect(page.locator(INLINE_TOOLBAR_SELECTOR)).toBeVisible();
  });

  test('should not create link if input is empty and Enter is pressed (new link)', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Empty link test',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Empty link test');

    await selectText(paragraph, 'Empty link');
    const linkInput = await ensureLinkInputOpen(page);

    await linkInput.fill('');
    await linkInput.press('Enter');

    await expect(linkInput).toBeHidden();
    await expect(paragraph.getByRole('link')).toHaveCount(0);
  });

  test('should restore selection after Escape', async ({ page }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Selection restoration',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Selection restoration');
    const textToSelect = 'Selection';

    await selectText(paragraph, textToSelect);
    await ensureLinkInputOpen(page);

    await page.keyboard.press('Escape');

    // Verify text is still selected
    const selection = await page.evaluate(() => {
      const sel = window.getSelection();

      return sel ? sel.toString() : '';
    });

    expect(selection).toBe(textToSelect);
  });

  test('should unlink when button is clicked while input is open', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: '<a href="https://example.com">Unlink me</a>',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Unlink me');

    await selectAll(paragraph);
    const linkInput = await ensureLinkInputOpen(page);

    await expect(linkInput).toBeVisible();
    await expect(linkInput).toHaveValue('https://example.com');

    // Click the button again (it should be in unlink state)
    const linkButton = page.locator('[data-blok-link-tool-unlink="true"]');

    await expect(linkButton).toBeVisible();
    await linkButton.click();

    await expect(paragraph.getByRole('link')).toHaveCount(0);
  });

  test('should support IDN URLs', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'IDN Link',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'IDN Link');
    const url = 'https://пример.рф';

    await selectText(paragraph, 'IDN Link');
    await ensureLinkInputOpen(page);
    await submitLink(page, url);

    const anchor = paragraph.getByRole('link');

    await expect(anchor).toHaveAttribute('href', url);
  });

  test('should allow pasting URL into input', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Paste Link',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Paste Link');
    const url = 'https://pasted-example.com';

    await selectText(paragraph, 'Paste Link');
    const linkInput = await ensureLinkInputOpen(page);

    // Simulate paste
    await linkInput.evaluate((el, text) => {
      const input = el as HTMLInputElement;

      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, url);

    await linkInput.press('Enter');

    const anchor = paragraph.getByRole('link');

    await expect(anchor).toHaveAttribute('href', url);
  });

  test('should not open tool via Shortcut (CMD+K) when selection is collapsed', async ({ page }) => {
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'Collapsed selection',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'Collapsed selection');

    // Place caret without selection
    await paragraph.click();

    // Ensure inline toolbar is not visible initially
    await expect(page.locator(INLINE_TOOLBAR_SELECTOR)).toBeHidden();

    await page.keyboard.press('ControlOrMeta+k');

    // Should still be hidden because there is no range
    await expect(page.locator(INLINE_TOOLBAR_SELECTOR)).toBeHidden();
    await expect(page.locator(LINK_INPUT_SELECTOR)).toBeHidden();
  });

  test('should allow javascript: links (security check)', async ({ page }) => {
    // This test documents current behavior.
    // If the policy changes to disallow javascript: links, this test should be updated to expect failure/sanitization.
    await createBlokWithBlocks(page, [
      {
        type: 'paragraph',
        data: {
          text: 'XSS Link',
        },
      },
    ]);

    const paragraph = getParagraphByText(page, 'XSS Link');
    const url = 'javascript:alert(1)';

    await selectText(paragraph, 'XSS Link');
    await ensureLinkInputOpen(page);
    await submitLink(page, url);

    const anchor = paragraph.getByRole('link');

    // Current implementation does not strip javascript: protocol
    await expect(anchor).toHaveAttribute('href', url);
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
