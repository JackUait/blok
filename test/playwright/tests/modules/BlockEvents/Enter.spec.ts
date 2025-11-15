import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureEditorBundleBuilt } from '../../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../fixtures/test.html')
).href;
const HOLDER_ID = 'editorjs';
const BLOCK_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} div.ce-block`;
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-block-tool="paragraph"]`;

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

const createParagraphEditor = async (page: Page, paragraphs: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = paragraphs.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

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

const selectText = async (locator: Locator, text: string): Promise<void> => {
  await locator.evaluate((element, targetText) => {
    const textNode = element.firstChild;

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
      throw new Error('Element does not contain a text node');
    }

    const content = textNode.textContent ?? '';
    const start = content.indexOf(targetText);

    if (start === -1) {
      throw new Error(`Text "${targetText}" was not found`);
    }

    const range = element.ownerDocument.createRange();

    range.setStart(textNode, start);
    range.setEnd(textNode, start + targetText.length);

    const selection = element.ownerDocument.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);
  }, text);
};

const saveEditor = async (page: Page): Promise<OutputData> => {
  return page.evaluate(async () => {
    if (!window.editorInstance) {
      throw new Error('Editor instance is not initialized');
    }

    return window.editorInstance.save();
  });
};

const getLastItem = <T>(items: T[]): T => {
  const lastItem = items.at(-1);

  if (!lastItem) {
    throw new Error('Expected to receive at least one item');
  }

  return lastItem;
};

test.describe('enter keydown', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should split block and remove selected fragment when part of text is selected', async ({ page }) => {
    await createParagraphEditor(page, [ 'The block with some text' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await selectText(paragraph, 'with so');
    await page.keyboard.press('Enter');

    const { blocks } = await saveEditor(page);

    expect(blocks).toHaveLength(2);
    expect((blocks[0].data as { text: string }).text).toBe('The block ');
    expect((blocks[1].data as { text: string }).text).toBe('me text');
  });

  test('should place caret into new block when Enter pressed at block end', async ({ page }) => {
    await createParagraphEditor(page, [ 'The block with some text' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.press('End');
    await paragraph.press('Enter');

    const blockCount = page.locator(BLOCK_SELECTOR);

    await expect(blockCount).toHaveCount(2);

    const blockHandles = await page.locator(BLOCK_SELECTOR).elementHandles();
    const lastBlockHandle = getLastItem(blockHandles);

    const caretInsideLastBlock = await lastBlockHandle.evaluate((element) => {
      const selection = element.ownerDocument?.getSelection();

      if (!selection || selection.rangeCount === 0) {
        return false;
      }

      const range = selection.getRangeAt(0);

      return element.contains(range.startContainer);
    });

    expect(caretInsideLastBlock).toBeTruthy();
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}

