import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from './helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../cypress/fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const EDITOR_SELECTOR = '[data-cy=editorjs]';
const BLOCK_SELECTOR = `${EDITOR_SELECTOR} div.ce-block`;

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
 * Create editor with empty config
 *
 * @param page - The Playwright page object
 */
const createEditor = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId }) => {
    const editor = new window.EditorJS({
      holder: holderId,
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID });
};

/**
 * Save editor data
 *
 * @param page - The Playwright page object
 * @returns The saved output data
 */
const saveEditor = async (page: Page): Promise<OutputData> => {
  return await page.evaluate<OutputData>(async () => {
    if (!window.editorInstance) {
      throw new Error('Editor instance not found');
    }

    return await window.editorInstance.save();
  });
};

/**
 * Simulate paste event with clipboard data
 *
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
  // The editor is already ready, so we just wait a brief moment for processing
  await page.evaluate(() => new Promise((resolve) => {
    setTimeout(resolve, 200);
  }));
};

test.describe('Sanitizing', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('Output should save inline formatting', () => {
    test('should save initial formatting for paragraph', async ({ page }) => {
      await createEditorWithBlocks(page, [
        {
          type: 'paragraph',
          data: { text: '<strong>Bold text</strong>' },
        },
      ]);

      const output = await saveEditor(page);

      expect(output.blocks[0].data.text).toBe('<strong>Bold text</strong>');
    });

    test('should save formatting for paragraph', async ({ page }) => {
      await createEditor(page);

      const block = page.locator(BLOCK_SELECTOR).first();

      await block.click();
      await block.type('This text should be bold.');

      // Select all text
      await block.evaluate((element) => {
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

      // Click bold button
      const boldButton = page.locator(`${EDITOR_SELECTOR} [data-item-name="bold"]`);

      await boldButton.click();

      // Click block to deselect
      await block.click();

      const output = await saveEditor(page);
      const text = output.blocks[0].data.text;

      expect(text).toMatch(/<strong>This text should be bold\.(<br>)?<\/strong>/);
    });

    test('should save formatting for paragraph on paste', async ({ page }) => {
      await createEditor(page);

      const block = page.locator(BLOCK_SELECTOR).first();

      await block.click();
      await paste(page, block, {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'text/html': '<p>Text</p><p><strong>Bold text</strong></p>',
      });

      const output = await saveEditor(page);

      expect(output.blocks[1].data.text).toBe('<strong>Bold text</strong>');
    });
  });

  test('should sanitize unwanted html on blocks merging', async ({ page }) => {
    await createEditorWithBlocks(page, [
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

    const lastParagraph = page.locator(`${EDITOR_SELECTOR} .ce-paragraph`).last();

    await lastParagraph.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Backspace');

    const { blocks } = await saveEditor(page);

    // text has been merged, span has been removed
    expect(blocks[0].data.text).toBe('First blockSecond XSS block');
  });
});

