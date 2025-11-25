import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { EditorConfig } from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const PLACEHOLDER_TEXT = 'Write something or press / to select a tool';
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

type CreateEditorOptions = Pick<EditorConfig, 'placeholder' | 'autofocus'>;

const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  const { placeholder = null, autofocus = null } = options;

  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(
    async ({ holderId, editorOptions }) => {
      const config: Record<string, unknown> = {
        holder: holderId,
      };

      if (editorOptions.placeholder !== null) {
        config.placeholder = editorOptions.placeholder;
      }

      if (editorOptions.autofocus !== null) {
        config.autofocus = editorOptions.autofocus;
      }

      const editor = new window.EditorJS(config);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      editorOptions: {
        placeholder,
        autofocus,
      },
    }
  );
};

const escapeAttributeValue = (value: string): string => {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
};

const getParagraphWithPlaceholder = (page: Page, placeholder: string): Locator => {
  const escapedPlaceholder = escapeAttributeValue(placeholder);

  // The placeholder attribute is set on the contenteditable element inside the block wrapper
  const selectors = [
    `${PARAGRAPH_SELECTOR} [data-blok-placeholder='${escapedPlaceholder}']`,
    `${PARAGRAPH_SELECTOR} [data-blok-placeholder-active='${escapedPlaceholder}']`,
  ].join(', ');

  return page.locator(selectors);
};

const getPseudoElementContent = async (
  locator: Locator,
  pseudoElement: '::before' | '::after'
): Promise<string> => {
  return await locator.evaluate((element, pseudo) => {
    const view = element.ownerDocument.defaultView;

    if (!view) {
      throw new Error('Element is not attached to a window');
    }

    const content = view.getComputedStyle(element, pseudo).getPropertyValue('content');

    return content.replace(/['"]/g, '');
  }, pseudoElement);
};

const expectPlaceholderContent = async (locator: Locator, expected: string): Promise<void> => {
  await expect.poll(async () => {
    return await getPseudoElementContent(locator, '::before');
  }).toBe(expected);
};

test.describe('placeholders', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('shows placeholder when provided in config', async ({ page }) => {
    await createEditor(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);
  });

  test('shows placeholder when editor is autofocusable', async ({ page }) => {
    await createEditor(page, {
      placeholder: PLACEHOLDER_TEXT,
      autofocus: true,
    });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);
  });

  test('keeps placeholder visible when block receives focus', async ({ page }) => {
    await createEditor(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    await paragraph.click();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);
  });

  test('restores placeholder after clearing typed content', async ({ page }) => {
    await createEditor(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    await paragraph.click();
    await paragraph.type('aaa');
    await page.keyboard.press(SELECT_ALL_SHORTCUT);
    await page.keyboard.press('Backspace');

    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);
  });

  test('hides placeholder after typing characters', async ({ page }) => {
    await createEditor(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);

    await paragraph.type('a');

    await expectPlaceholderContent(paragraph, 'none');
  });

  test('hides placeholder after typing whitespace', async ({ page }) => {
    await createEditor(page, { placeholder: PLACEHOLDER_TEXT });

    const paragraph = getParagraphWithPlaceholder(page, PLACEHOLDER_TEXT);

    await expect(paragraph).toBeVisible();
    await expectPlaceholderContent(paragraph, PLACEHOLDER_TEXT);

    await paragraph.type('   ');

    await expectPlaceholderContent(paragraph, 'none');
  });
});


