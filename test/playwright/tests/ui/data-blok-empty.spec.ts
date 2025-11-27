import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { OutputData } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const PARAGRAPH_INDEX_ATTRIBUTE = 'data-blok-testid-paragraph-index';
const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

declare global {
  interface Window {
    editorInstance?: EditorJS;
  }
}

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createEditorWithTextBlocks = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text, index) => ({
    id: `paragraph-${index + 1}`,
    type: 'paragraph',
    data: {
      text,
    },
  }));

  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(
    async ({ holder, blocksData }) => {
      const editor = new window.EditorJS({
        holder: holder,
        data: {
          blocks: blocksData,
        },
      });

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holder: HOLDER_ID,
      blocksData: blocks,
    }
  );
};

const assignParagraphIndexes = async (page: Page): Promise<void> => {
  await page.evaluate(
    ({ selector, attribute }) => {
      const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));

      elements.forEach((element, index) => {
        element.setAttribute(attribute, String(index));
      });
    },
    {
      selector: PARAGRAPH_SELECTOR,
      attribute: PARAGRAPH_INDEX_ATTRIBUTE,
    }
  );
};

test.describe('data-blok-empty attribute', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('reflects initial block content', async ({ page }) => {
    await createEditorWithTextBlocks(page, ['First', '']);
    await assignParagraphIndexes(page);

    const paragraphs = page.locator(PARAGRAPH_SELECTOR);
    const firstParagraphWrapper = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="0"]`
    );
    const secondParagraphWrapper = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="1"]`
    );

    // The data-blok-empty attribute is on the contenteditable element inside the block wrapper
    const firstParagraph = firstParagraphWrapper.locator('[contenteditable]');
    const secondParagraph = secondParagraphWrapper.locator('[contenteditable]');

    await expect(paragraphs).toHaveCount(2);

    // Trigger focus to ensure the attribute is set (via focusin event listener)
    await firstParagraph.focus();
    await secondParagraph.focus();

    // Wait for the data-blok-empty attribute to be set
    await expect.poll(async () => {
      return await firstParagraph.getAttribute('data-blok-empty');
    }).toBe('false');
    await expect.poll(async () => {
      return await secondParagraph.getAttribute('data-blok-empty');
    }).toBe('true');
  });

  test('updates to "false" after typing', async ({ page }) => {
    await createEditorWithTextBlocks(page, ['First', '']);
    await assignParagraphIndexes(page);

    const lastParagraphWrapper = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="1"]`
    );
    // The data-blok-empty attribute is on the contenteditable element inside the block wrapper
    const lastParagraph = lastParagraphWrapper.locator('[contenteditable]');

    await lastParagraph.click();
    await lastParagraph.pressSequentially('Some text');

    // Wait for the data-blok-empty attribute to update
    await expect.poll(async () => {
      return await lastParagraph.getAttribute('data-blok-empty');
    }).toBe('false');
  });

  test('updates to "true" after removing content', async ({ page }) => {
    await createEditorWithTextBlocks(page, ['', 'Some text']);
    await assignParagraphIndexes(page);

    const lastParagraphWrapper = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="1"]`
    );
    // The data-blok-empty attribute is on the contenteditable element inside the block wrapper
    const lastParagraph = lastParagraphWrapper.locator('[contenteditable]');

    await lastParagraph.click();
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await page.keyboard.press('Backspace');

    // Wait for the data-blok-empty attribute to update
    await expect.poll(async () => {
      return await lastParagraph.getAttribute('data-blok-empty');
    }).toBe('true');
  });

  test('applies to newly created blocks', async ({ page }) => {
    await createEditorWithTextBlocks(page, ['First', '']);
    await assignParagraphIndexes(page);

    const paragraphs = page.locator(PARAGRAPH_SELECTOR);
    const secondParagraphWrapper = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="1"]`
    );
    // The contenteditable element is inside the block wrapper
    const secondParagraph = secondParagraphWrapper.locator('[contenteditable]');

    await secondParagraph.click();
    await page.keyboard.press('Enter');

    await assignParagraphIndexes(page);

    await expect(paragraphs).toHaveCount(3);
    const newestParagraphWrapper = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="2"]`
    );
    // The data-blok-empty attribute is on the contenteditable element inside the block wrapper
    const newestParagraph = newestParagraphWrapper.locator('[contenteditable]');

    // Wait for the data-blok-empty attribute to be set on newly created block
    await expect.poll(async () => {
      return await newestParagraph.getAttribute('data-blok-empty');
    }).toBe('true');
  });
});

