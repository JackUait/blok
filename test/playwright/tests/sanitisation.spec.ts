import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OutputData } from '@/types';
import { ensureBlokBundleBuilt } from './helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HOLDER_ID = 'blok';
const INITIAL_BLOCK_ID = 'sanitisation-initial-block';

const getBlockById = (page: Page, blockId: string): Locator => {
  return page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-id="${blockId}"]`);
};

const getParagraphByBlockId = (page: Page, blockId: string): Locator => {
  return getBlockById(page, blockId).locator('[contenteditable]');
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
const createBlokWithElements = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
      tools: {
        paragraph: {
          inlineToolbar: true,
          config: {
            preserveBlank: true,
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

/**
 * Create blok with empty config
 * @param page - The Playwright page object
 */
const createBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, initialBlockId }) => {
    const blok = new window.Blok({
      holder: holder,
      data: {
        blocks: [
          {
            id: initialBlockId,
            type: 'paragraph',
            data: {
              text: '',
            },
          },
        ],
      },
      tools: {
        paragraph: {
          inlineToolbar: true,
          config: {
            preserveBlank: true,
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    initialBlockId: INITIAL_BLOCK_ID });
};

/**
 * Save blok data
 * @param page - The Playwright page object
 * @returns The saved output data
 */
const saveBlok = async (page: Page): Promise<OutputData> => {
  return await page.evaluate<OutputData>(async () => {
    if (!window.blokInstance) {
      throw new Error('Blok instance not found');
    }

    return await window.blokInstance.save();
  });
};

/**
 * Simulate paste event with clipboard data
 * @param page - The Playwright page object
 * @param locator - The locator for the element to paste into
 * @param data - Map with MIME type as key and data as value
 */
const paste = async (page: Page, locator: Locator, data: Record<string, string>): Promise<void> => {
  await locator.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => pasteData[type] ?? '',
        types: Object.keys(pasteData),
      },
    });

    element.dispatchEvent(pasteEvent);
  }, data);

  // Wait for paste processing to complete
  // Some tools (paragraph) could have async hydration
  // The blok is already ready, so we just wait a brief moment for processing
  await page.evaluate(() => new Promise((resolve) => {
    setTimeout(resolve, 200);
  }));
};

/**
 * Set caret to beginning of element
 * @param locator - The locator for the element
 */
const setCaretToStart = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => {
    const el = element as HTMLElement;
    const doc = el.ownerDocument;
    const selection = doc.getSelection();

    if (!selection) {
      throw new Error('Selection not available');
    }

    const range = doc.createRange();

    // Find first text node or use the element itself
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const firstTextNode = walker.nextNode();

    if (firstTextNode) {
      range.setStart(firstTextNode, 0);
    } else {
      range.setStart(el, 0);
    }
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
  });
};

/**
 * Select all text in a block
 * @param locator - The locator for the block element
 */
const selectAllText = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => {
    const el = element as HTMLElement;
    const doc = el.ownerDocument;
    const range = doc.createRange();
    const selection = doc.getSelection();

    if (!selection) {
      throw new Error('Selection not available');
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
 * Create blok with custom sanitizer config
 * @param page - The Playwright page object
 * @param sanitizerConfig - Custom sanitizer configuration
 */
const createBlokWithSanitizer = async (page: Page, sanitizerConfig: Record<string, unknown>): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, sanitizer }) => {
    const blok = new window.Blok({
      holder: holder,
      sanitizer,
      tools: {
        paragraph: {
          config: {
            preserveBlank: true,
          },
        },
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    sanitizer: sanitizerConfig });
};

test.describe('sanitizing', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test.describe('output should save inline formatting', () => {
    test('should save initial formatting for paragraph', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<strong>Bold text</strong>' },
        },
      ]);

      const output = await saveBlok(page);

      expect(output.blocks[0].data.text).toBe('<strong>Bold text</strong>');
    });

    test('should save formatting for paragraph', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          id: INITIAL_BLOCK_ID,
          type: 'paragraph',
          data: { text: 'This text should be bold.' },
        },
      ]);

      const paragraph = getParagraphByBlockId(page, INITIAL_BLOCK_ID);

      await paragraph.click();

      // Select all text
      await selectAllText(paragraph);

      // Click bold button
      const boldButton = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-item-name="bold"]`);

      await boldButton.click();

      // Click paragraph to deselect and wait for inline toolbar to close
      await paragraph.click();
      await boldButton.waitFor({ state: 'hidden' });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toMatch(/<strong>This text should be bold\.(<br>)?<\/strong>/);
    });

    test('should save formatting for paragraph on paste', async ({ page }) => {
      await createBlok(page);

      const block = getBlockById(page, INITIAL_BLOCK_ID);

      await block.click();
      await paste(page, block, {

        'text/html': '<p>Text</p><p><strong>Bold text</strong></p>',
      });

      const output = await saveBlok(page);

      expect(output.blocks[1].data.text).toBe('<strong>Bold text</strong>');
    });
  });

  test('should sanitize unwanted html on blocks merging', async ({ page }) => {
    await createBlokWithElements(page, [
      {
        id: 'block1',
        type: 'paragraph',
        data: {
          text: 'First block',
        },
      },
      {
        id: 'paragraph',
        type: 'paragraph',
        data: {
          /**
           * Tool does not support spans in its sanitization config
           */
          text: 'Second <span id="taint-html">XSS<span> block',
        },
      },
    ]);

    const lastParagraph = getParagraphByBlockId(page, 'paragraph');

    await lastParagraph.click();
    await setCaretToStart(lastParagraph);
    await page.keyboard.press('Backspace');

    const { blocks } = await saveBlok(page);

    // text has been merged, span has been removed
    expect(blocks[0].data.text).toBe('First blockSecond XSS block');
  });

  test.describe('other inline tools', () => {
    test('should save italic formatting', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<i>Italic text</i>' },
        },
      ]);

      const output = await saveBlok(page);

      expect(output.blocks[0].data.text).toBe('<i>Italic text</i>');
    });

    test('should save italic formatting applied via toolbar', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          id: INITIAL_BLOCK_ID,
          type: 'paragraph',
          data: { text: 'This text should be italic.' },
        },
      ]);

      const paragraph = getParagraphByBlockId(page, INITIAL_BLOCK_ID);

      await paragraph.click();

      await selectAllText(paragraph);

      const italicButton = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-item-name="italic"]`);

      await italicButton.click();

      // Click paragraph to deselect and wait for inline toolbar to close
      await paragraph.click();
      await italicButton.waitFor({ state: 'hidden' });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toMatch(/<i>This text should be italic\.(<br>)?<\/i>/);
    });

    test('should save link formatting with href attribute', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<a href="https://example.com">Link text</a>' },
        },
      ]);

      const output = await saveBlok(page);

      expect(output.blocks[0].data.text).toContain('<a href="https://example.com">');
      expect(output.blocks[0].data.text).toContain('Link text');
    });

    test('should save link formatting applied via toolbar', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          id: INITIAL_BLOCK_ID,
          type: 'paragraph',
          data: { text: 'Link text' },
        },
      ]);

      const paragraph = getParagraphByBlockId(page, INITIAL_BLOCK_ID);

      await paragraph.click();

      await selectAllText(paragraph);

      const linkButton = page.locator(`${BLOK_INTERFACE_SELECTOR} [data-blok-item-name="link"]`);

      await linkButton.click();

      const linkInput = page.locator('[data-blok-link-tool-input-opened="true"]');

      await linkInput.fill('https://example.com');
      await linkInput.press('Enter');

      // Wait for link input to close after pressing Enter
      await linkInput.waitFor({ state: 'hidden' });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toMatch(/<a href="https:\/\/example\.com"[^>]*>Link text<\/a>/);
    });
  });

  test.describe('attribute sanitization', () => {
    test('should strip unwanted attributes from links', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<a href="https://example.com" onclick="alert(1)" style="color:red" id="malicious">Link</a>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('href="https://example.com"');
      expect(text).not.toContain('onclick');
      expect(text).not.toContain('style');
      expect(text).not.toContain('id="malicious"');
    });

    test('should preserve allowed link attributes', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<a href="https://example.com" target="_blank" rel="nofollow">Link</a>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('href="https://example.com"');
      expect(text).toContain('target="_blank"');
      expect(text).toContain('rel="nofollow"');
    });

    test('should strip attributes while keeping tags when rule is false', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<strong style="color:red" onclick="alert(1)">Bold</strong>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('<strong>');
      expect(text).toContain('Bold');
      expect(text).not.toContain('style');
      expect(text).not.toContain('onclick');
    });
  });

  test.describe('xSS prevention', () => {
    test('should remove script tags', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: 'Text<script>alert("XSS")</script>More text' },
        },
      ]);

      const output = await saveBlok(page);

      expect(output.blocks[0].data.text).not.toContain('<script>');
      expect(output.blocks[0].data.text).not.toContain('alert');
      expect(output.blocks[0].data.text).toBe('TextMore text');
    });

    test('should remove event handlers', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<strong onclick="alert(1)" onerror="alert(2)" onload="alert(3)">Bold</strong>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).not.toContain('onclick');
      expect(text).not.toContain('onerror');
      expect(text).not.toContain('onload');
      expect(text).toContain('<strong>');
    });

    test('should remove javascript: URLs', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<a href="javascript:alert(1)">Link</a>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      // The link should be removed or href should be sanitized
      expect(text).not.toContain('javascript:');
    });

    test('should remove data: URLs with scripts', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<img src="data:text/html,<script>alert(1)</script>" />' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).not.toContain('data:text/html');
      expect(text).not.toContain('<script>');
    });

    test('should remove style attributes with expressions', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<span style="expression(alert(1))">Text</span>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).not.toContain('style');
      expect(text).not.toContain('expression');
    });

    test('should remove malicious attributes', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<strong onmouseover="alert(1)" onfocus="alert(2)">Bold</strong>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).not.toContain('onmouseover');
      expect(text).not.toContain('onfocus');
    });
  });

  test.describe('nested HTML structures', () => {
    test('should save nested formatting (bold inside italic)', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<i>Italic <strong>and bold</strong> text</i>' },
        },
      ]);

      const output = await saveBlok(page);

      expect(output.blocks[0].data.text).toContain('<i>');
      expect(output.blocks[0].data.text).toContain('<strong>');
      expect(output.blocks[0].data.text).toContain('and bold');
    });

    test('should save multiple levels of nesting', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<strong>Bold <i>italic <a href="https://example.com">link</a></i></strong>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('<strong>');
      expect(text).toContain('<i>');
      expect(text).toContain('<a href="https://example.com">');
      expect(text).toContain('link');
    });

    test('should sanitize nested unwanted tags', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<strong>Bold <span id="bad">bad</span> text</strong>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('<strong>');
      expect(text).not.toContain('<span>');
      expect(text).toContain('bad');
    });
  });

  test.describe('edge cases', () => {
    test('should handle empty sanitization config', async ({ page }) => {
      await createBlokWithSanitizer(page, {});

      await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.blocks.insert('paragraph', {
          text: '<strong>Bold</strong> <i>italic</i>',
        });

        // Wait for block to be rendered
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      // With empty config, all HTML should be preserved
      expect(text).toContain('<strong>Bold</strong> <i>italic</i>');
    });

    test('should handle empty string', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '' },
        },
      ]);

      const output = await saveBlok(page);

      expect(output.blocks).toHaveLength(0);
    });

    test('should handle whitespace-only content', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '   \n\t  ' },
        },
      ]);

      const output = await saveBlok(page);

      expect(output.blocks[0].data.text).toBeTruthy();
    });

    test('should handle HTML entities', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          type: 'paragraph',
          data: { text: '<strong>&lt;script&gt;</strong>' },
        },
      ]);

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('<strong>');
      // Entities should be preserved or decoded appropriately
      expect(text).toContain('script');
    });
  });

  test.describe('editor-level sanitizer config', () => {
    test('should apply custom sanitizer config', async ({ page }) => {
      await createBlokWithSanitizer(page, {
        strong: true,
        i: true,
        // No 'a' tags allowed
      });

      await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.blocks.insert('paragraph', {
          text: '<strong>Bold</strong> <i>italic</i> <a href="#">link</a>',
        });

        // Wait for block to be rendered
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('<strong>');
      expect(text).toContain('<i>');
      expect(text).not.toContain('<a>');
    });

    test('should override tool-level sanitization', async ({ page }) => {
      await createBlokWithSanitizer(page, {
        span: true,
        div: true,
      });

      await page.evaluate(async () => {
        if (!window.blokInstance) {
          throw new Error('Blok instance not found');
        }

        window.blokInstance.blocks.insert('paragraph', {
          text: '<span>Span</span> <div>Div</div>',
        });

        // Wait for block to be rendered
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      // Custom config should allow span and div, even when blok adds safe attributes
      expect(text).toMatch(/<span\b[^>]*>Span<\/span>/);
      expect(text).toMatch(/<div\b[^>]*>Div<\/div>/);
    });
  });

  test.describe('block merging edge cases', () => {
    test('should sanitize when merging blocks with different configs', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          id: 'block1',
          type: 'paragraph',
          data: {
            text: 'First block',
          },
        },
        {
          id: 'block2',
          type: 'paragraph',
          data: {
            text: 'Second <span id="taint">block</span>',
          },
        },
      ]);

      const lastParagraph = getParagraphByBlockId(page, 'block2');

      await lastParagraph.click();
      await setCaretToStart(lastParagraph);
      await page.keyboard.press('Backspace');

      const { blocks } = await saveBlok(page);

      expect(blocks[0].data.text).toBe('First blockSecond block');
      expect(blocks[0].data.text).not.toContain('<span>');
    });

    test('should sanitize nested structures when merging', async ({ page }) => {
      await createBlokWithElements(page, [
        {
          id: 'block1',
          type: 'paragraph',
          data: {
            text: '<strong>First</strong>',
          },
        },
        {
          id: 'block2',
          type: 'paragraph',
          data: {
            // Test that nested disallowed tags are sanitized when merging
            text: 'Second <span>nested <strong>bad</strong></span> block',
          },
        },
      ]);

      const lastParagraph = getParagraphByBlockId(page, 'block2');

      await lastParagraph.click();
      await setCaretToStart(lastParagraph);
      await page.keyboard.press('Backspace');

      const { blocks } = await saveBlok(page);

      // Verify that merge happened
      expect(blocks).toHaveLength(1);

      const text = blocks[0].data.text;

      // The span should be sanitized out, but strong and content preserved
      expect(text).toContain('<strong>');
      expect(text).toContain('First');
      expect(text).toContain('Second');
      expect(text).toContain('nested');
      expect(text).toContain('bad');
      expect(text).toContain('block');
      expect(text).not.toContain('<span>');
    });
  });

  test.describe('paste sanitization', () => {
    test('should sanitize malicious content on paste', async ({ page }) => {
      await createBlok(page);

      const block = getBlockById(page, INITIAL_BLOCK_ID);

      await block.click();
      await paste(page, block, {

        'text/html': '<p>Text<script>alert("XSS")</script></p>',
      });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).not.toContain('<script>');
      expect(text).not.toContain('alert');
    });

    test('should sanitize mixed allowed/disallowed tags on paste', async ({ page }) => {
      await createBlok(page);

      const block = getBlockById(page, INITIAL_BLOCK_ID);

      await block.click();
      await paste(page, block, {

        'text/html': '<p><strong>Bold</strong> <span id="bad">bad</span> <i>italic</i></p>',
      });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('<strong>');
      expect(text).toContain('<i>');
      expect(text).not.toContain('<span>');
      expect(text).toContain('bad');
    });

    test('should sanitize nested structures on paste', async ({ page }) => {
      await createBlok(page);

      const block = getBlockById(page, INITIAL_BLOCK_ID);

      await block.click();
      await paste(page, block, {

        'text/html': '<p><strong>Bold <span>nested</span></strong></p>',
      });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('<strong>');
      expect(text).not.toContain('<span>');
      expect(text).toContain('nested');
    });

    test('should sanitize event handlers on paste', async ({ page }) => {
      await createBlok(page);

      const block = getBlockById(page, INITIAL_BLOCK_ID);

      await block.click();
      await paste(page, block, {

        'text/html': '<p><strong onclick="alert(1)">Bold</strong></p>',
      });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('<strong>');
      expect(text).not.toContain('onclick');
    });
  });

  test.describe('deep sanitization', () => {
    test('should sanitize nested objects with HTML strings', async ({ page }) => {
      await resetBlok(page);

      await page.evaluate(async ({ holder }) => {
        /**
         * Custom tool with nested data structure
         */
        class CustomTool {
          public static toolbox = {
            icon: 'C',
            title: 'Custom',
          };

          public static sanitize = {
            text: {
              strong: {},
            },
            items: {
              strong: {},
            },
          };

          private data: { text: string; items: Array<{ content: string }> };

          /**
           * @param data - tool data
           */
          constructor({ data }: { data: { text: string; items: Array<{ content: string }> } }) {
            this.data = data;
          }

          /**
           * Render tool content
           */
          public render(): HTMLElement {
            const wrapper = document.createElement('div');

            wrapper.innerHTML = this.data.text;

            return wrapper;
          }

          /**
           * Save tool data
           */
          public save(): { text: string; items: Array<{ content: string }> } {
            return this.data;
          }
        }

        const blok = new window.Blok({
          holder: holder,
          tools: {
            custom: CustomTool,
          },
          data: {
            blocks: [
              {
                type: 'custom',
                data: {
                  text: '<strong>Bold</strong> <span>bad</span>',
                  items: [
                    { content: '<strong>Item</strong> <span>bad</span>' },
                  ],
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      const output = await saveBlok(page);
      const blockData = output.blocks[0].data;

      expect(blockData.text).toContain('<strong>');
      expect(blockData.text).not.toContain('<span>');
      expect(blockData.items[0].content).toContain('<strong>');
      expect(blockData.items[0].content).not.toContain('<span>');
    });

    test('should sanitize arrays containing HTML strings', async ({ page }) => {
      await resetBlok(page);

      await page.evaluate(async ({ holder }) => {
        /**
         * Custom tool with array data structure
         */
        class CustomTool {
          public static toolbox = {
            icon: 'C',
            title: 'Custom',
          };

          public static sanitize = {
            items: {
              strong: {},
            },
          };

          private data: { items: string[] };

          /**
           * @param data - tool data
           */
          constructor({ data }: { data: { items: string[] } }) {
            this.data = data;
          }

          /**
           * Render tool content
           */
          public render(): HTMLElement {
            const wrapper = document.createElement('div');

            wrapper.innerHTML = this.data.items.join('');

            return wrapper;
          }

          /**
           * Save tool data
           */
          public save(): { items: string[] } {
            return this.data;
          }
        }

        const blok = new window.Blok({
          holder: holder,
          tools: {
            custom: CustomTool,
          },
          data: {
            blocks: [
              {
                type: 'custom',
                data: {
                  items: [
                    '<strong>Bold</strong>',
                    '<span>bad</span>',
                    '<i>italic</i>',
                  ],
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      const output = await saveBlok(page);
      const blockData = output.blocks[0].data;

      expect(blockData.items[0]).toContain('<strong>');
      expect(blockData.items[1]).not.toContain('<span>');
      expect(blockData.items[2]).not.toContain('<i>'); // Not in sanitize config
    });
  });

  test.describe('function-based sanitization rules', () => {
    test('should apply function-based sanitization rules', async ({ page }) => {
      await resetBlok(page);

      await page.evaluate(async ({ holder }) => {
        /**
         * Custom tool with function-based sanitization
         */
        class CustomTool {
          public static toolbox = {
            icon: 'C',
            title: 'Custom',
          };

          public static sanitize = {
            text: {
              a: (el: Element) => {
                const href = el.getAttribute('href');

                if (href && href.startsWith('http')) {
                  return {
                    href: true,
                    target: '_blank',
                  };
                }

                return {
                  href: true,
                };
              },
            },
          };

          private data: { text: string };

          /**
           * @param data - tool data
           */
          constructor({ data }: { data: { text: string } }) {
            this.data = data;
          }

          /**
           * Render tool content
           */
          public render(): HTMLElement {
            const wrapper = document.createElement('div');

            wrapper.innerHTML = this.data.text;

            return wrapper;
          }

          /**
           * Save tool data
           */
          public save(): { text: string } {
            return this.data;
          }
        }

        const blok = new window.Blok({
          holder: holder,
          tools: {
            custom: CustomTool,
          },
          data: {
            blocks: [
              {
                type: 'custom',
                data: {
                  text: '<a href="https://example.com">HTTP link</a> <a href="javascript:alert(1)">JS link</a>',
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('href="https://example.com"');
      expect(text).toContain('target="_blank"');
      // javascript: links should be handled by sanitizer
      expect(text).not.toContain('javascript:');
    });

    test('should apply conditional sanitization based on content', async ({ page }) => {
      await resetBlok(page);

      await page.evaluate(async ({ holder }) => {
        /**
         * Custom tool with conditional sanitization
         */
        class CustomTool {
          public static toolbox = {
            icon: 'C',
            title: 'Custom',
          };

          public static sanitize = {
            text: {
              strong: (el: Element) => {
                // Only allow strong tags that are not empty
                return el.textContent !== '';
              },
            },
          };

          private data: { text: string };

          /**
           * @param data - tool data
           */
          constructor({ data }: { data: { text: string } }) {
            this.data = data;
          }

          /**
           * Render tool content
           */
          public render(): HTMLElement {
            const wrapper = document.createElement('div');

            wrapper.innerHTML = this.data.text;

            return wrapper;
          }

          /**
           * Save tool data
           */
          public save(): { text: string } {
            return this.data;
          }
        }

        const blok = new window.Blok({
          holder: holder,
          tools: {
            custom: CustomTool,
          },
          data: {
            blocks: [
              {
                type: 'custom',
                data: {
                  text: '<strong>Valid</strong> <strong></strong>',
                },
              },
            ],
          },
        });

        window.blokInstance = blok;
        await blok.isReady;
      }, { holder: HOLDER_ID });

      const output = await saveBlok(page);
      const text = output.blocks[0].data.text;

      expect(text).toContain('<strong>Valid</strong>');
      // Empty strong should be removed
      expect(text).not.toContain('<strong></strong>');
    });
  });
});

