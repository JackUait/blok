import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const EDITOR_ROOT_SELECTOR = EDITOR_INTERFACE_SELECTOR;
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-paragraph`;
const STYLE_TAG_SELECTOR = '#editor-js-styles';

type InitializationOptions = {
  readOnly?: boolean;
  style?: {
    nonce?: string;
  };
};
declare global {
  interface Window {
    editorInstance?: EditorJS;
  }
}

const waitForEditorConstructor = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const candidate = (window as unknown as { EditorJS?: unknown }).EditorJS;

    if (typeof candidate === 'function') {
      return true;
    }

    if (candidate && typeof candidate === 'object') {
      const defaultExport = (candidate as { default?: unknown }).default;

      return typeof defaultExport === 'function';
    }

    return false;
  });
};

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

const normalizeEditorConstructor = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const candidate = (window as unknown as { EditorJS?: unknown }).EditorJS;

    if (!candidate) {
      throw new Error('EditorJS constructor is not available on window');
    }

    if (typeof candidate === 'object') {
      const defaultExport = (candidate as { default?: unknown }).default;

      if (typeof defaultExport === 'function') {
        (window as unknown as { EditorJS: unknown }).EditorJS = defaultExport;
      }
    }
  });
};

const createEditor = async (page: Page, options: InitializationOptions = {}): Promise<void> => {
  await resetEditor(page);
  await waitForEditorConstructor(page);
  await normalizeEditorConstructor(page);

  await page.evaluate(async ({ serializedOptions }) => {
    if (typeof window.EditorJS !== 'function') {
      throw new Error('EditorJS constructor is not available on window');
    }

    const editorConfig: Record<string, unknown> = {};

    if (serializedOptions.readOnly !== undefined) {
      editorConfig.readOnly = serializedOptions.readOnly;
    }

    if (serializedOptions.style) {
      editorConfig.style = serializedOptions.style;
    }

    const editor = new window.EditorJS(editorConfig);

    window.editorInstance = editor;
    await editor.isReady;
  }, { serializedOptions: options });
};

test.describe('editor basic initialization', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe('zero-config initialization', () => {
    test('creates a visible UI', async ({ page }) => {
      await createEditor(page);

      await expect(page.locator(EDITOR_ROOT_SELECTOR)).toBeVisible();
    });
  });

  test.describe('configuration', () => {
    test.describe('readOnly', () => {
      test('creates editor without editing ability when true passed', async ({ page }) => {
        await createEditor(page, {
          readOnly: true,
        });

        const readOnlyParagraph = page.locator(`${PARAGRAPH_SELECTOR}[contenteditable="false"]`);

        await expect(readOnlyParagraph).toBeVisible();
      });
    });

    test('adds passed nonce attribute to editor styles when nonce provided', async ({ page }) => {
      await createEditor(page, {
        style: {
          nonce: 'test-nonce',
        },
      });

      await expect(page.locator(STYLE_TAG_SELECTOR)).toHaveAttribute('nonce', 'test-nonce');
    });
  });
});


