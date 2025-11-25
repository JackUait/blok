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
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"] [data-blok-block-tool="paragraph"]`;
const PARAGRAPH_INDEX_ATTRIBUTE = 'data-blok-testid-paragraph-index';
const SELECT_ALL_SHORTCUT = process.platform === 'darwin' ? 'Meta+A' : 'Control+A';

declare global {
  interface Window {
    editorInstance?: EditorJS;
  }
}

const resetEditor = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holderId }) => {
    if (window.editorInstance) {
      await window.editorInstance.destroy?.();
      window.editorInstance = undefined;
    }

    document.getElementById(holderId)?.remove();

    const container = document.createElement('div');

    container.id = holderId;
    container.setAttribute('data-blok-testid', holderId);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
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
    async ({ holderId, blocksData }) => {
      const editor = new window.EditorJS({
        holder: holderId,
        data: {
          blocks: blocksData,
        },
      });

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
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
    const firstParagraph = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="0"]`
    );
    const secondParagraph = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="1"]`
    );

    await expect(paragraphs).toHaveCount(2);
    await expect(firstParagraph).toHaveAttribute('data-blok-empty', 'false');
    await expect(secondParagraph).toHaveAttribute('data-blok-empty', 'true');
  });

  test('updates to "false" after typing', async ({ page }) => {
    await createEditorWithTextBlocks(page, ['First', '']);
    await assignParagraphIndexes(page);

    const lastParagraph = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="1"]`
    );

    await lastParagraph.click();
    await lastParagraph.type('Some text');
    await expect(lastParagraph).toHaveAttribute('data-blok-empty', 'false');
  });

  test('updates to "true" after removing content', async ({ page }) => {
    await createEditorWithTextBlocks(page, ['', 'Some text']);
    await assignParagraphIndexes(page);

    const lastParagraph = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="1"]`
    );

    await lastParagraph.click();
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await page.keyboard.press('Backspace');
    await expect(lastParagraph).toHaveAttribute('data-blok-empty', 'true');
  });

  test('applies to newly created blocks', async ({ page }) => {
    await createEditorWithTextBlocks(page, ['First', '']);
    await assignParagraphIndexes(page);

    const paragraphs = page.locator(PARAGRAPH_SELECTOR);
    const secondParagraph = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="1"]`
    );

    await secondParagraph.click();
    await page.keyboard.press('Enter');

    await assignParagraphIndexes(page);

    await expect(paragraphs).toHaveCount(3);
    const newestParagraph = page.locator(
      `${PARAGRAPH_SELECTOR}[${PARAGRAPH_INDEX_ATTRIBUTE}="2"]`
    );

    await expect(newestParagraph).toHaveAttribute('data-blok-empty', 'true');
  });
});

