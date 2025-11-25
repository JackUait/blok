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
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-paragraph[data-blok-block-tool="paragraph"]`;
const TOOLBOX_CONTAINER_SELECTOR = '[data-testid="toolbox"] .ce-popover__container';
const TOOLBOX_ITEM_SELECTOR = (itemName: string): string =>
  `[data-testid="toolbox"] [data-testid="popover-item"][data-blok-item-name=${itemName}]`;
const BLOCK_TUNES_SELECTOR = '[data-testid="block-tunes-popover"] [data-testid="popover-container"]';
const PLUS_BUTTON_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-toolbar__plus`;

const modifierKeyVariants: Array<{ description: string; key: 'Control' | 'Meta' }> = [
  { description: 'Ctrl',
    key: 'Control' },
  { description: 'Cmd',
    key: 'Meta' },
];

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

const getTextContent = async (locator: Locator): Promise<string> => {
  return locator.evaluate((element) => element.textContent ?? '');
};

test.describe('slash keydown', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should add "/" in empty block and open Toolbox', async ({ page }) => {
    await createParagraphEditor(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeVisible();

    const textContent = await getTextContent(paragraph);

    expect(textContent).toBe('/');
  });

  for (const { description, key } of modifierKeyVariants) {
    test(`should not open Toolbox if Slash pressed with ${description}`, async ({ page }) => {
      await createParagraphEditor(page, [ '' ]);

      const paragraph = page.locator(PARAGRAPH_SELECTOR);

      await paragraph.click();
      await page.keyboard.down(key);
      await page.keyboard.press('Slash');
      await page.keyboard.up(key);

      await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeHidden();
      const textContent = await getTextContent(paragraph);

      expect(textContent).toBe('');
    });
  }

  test('should not open Toolbox in non-empty block and append slash character', async ({ page }) => {
    await createParagraphEditor(page, [ 'Hello' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await paragraph.type('/');

    await expect(page.locator(TOOLBOX_CONTAINER_SELECTOR)).toBeHidden();

    const textContent = await getTextContent(paragraph);

    expect(textContent).toBe('Hello/');
  });

  test('should not modify text outside editor when slash pressed', async ({ page }) => {
    await createParagraphEditor(page, [ '' ]);

    await page.evaluate(() => {
      const title = document.querySelector('h1');

      if (title) {
        title.setAttribute('data-testid', 'page-title');
      }
    });

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();

    const plusButton = page.locator(PLUS_BUTTON_SELECTOR);

    await plusButton.click();

    const toolbox = page.locator(TOOLBOX_CONTAINER_SELECTOR);

    await expect(toolbox).toBeVisible();

    const textToolOption = page.locator(TOOLBOX_ITEM_SELECTOR('paragraph'));

    await textToolOption.click();

    const pageTitle = page.getByTestId('page-title');

    await pageTitle.evaluate((element) => {
      element.setAttribute('contenteditable', 'true');
      element.focus();

      const selection = element.ownerDocument.getSelection();
      const range = element.ownerDocument.createRange();

      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });

    await pageTitle.evaluate((element) => {
      element.removeAttribute('contenteditable');
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: '/',
          code: 'Slash',
          which: 191,
          bubbles: true,
        })
      );
    });

    await expect(pageTitle).toHaveText('Editor.js test page');
  });

  test('should open Block Tunes when cmd+slash pressed', async ({ page }) => {
    await createParagraphEditor(page, [ '' ]);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await paragraph.click();
    await page.keyboard.down('Meta');
    await page.keyboard.press('Slash');
    await page.keyboard.up('Meta');

    await expect(page.locator(BLOCK_TUNES_SELECTOR)).toBeVisible();
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}

