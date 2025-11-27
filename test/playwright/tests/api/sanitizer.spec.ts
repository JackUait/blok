import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';

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

const createEditor = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(async ({ holder }) => {
    const editor = new window.EditorJS({
      holder: holder,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'Initial block',
            },
          },
        ],
      },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holder: HOLDER_ID });
};

test.describe('api.sanitizer', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await createEditor(page);
  });

  test('clean removes disallowed HTML', async ({ page }) => {
    const sanitized = await page.evaluate(() => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      const dirtyHtml = '<p>Safe<script>alert("XSS")</script></p>';

      return window.editorInstance.sanitizer.clean(dirtyHtml, {
        p: true,
      });
    });

    expect(sanitized).toBe('<p>Safe</p>');
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('alert');
  });

  test('clean applies custom sanitizer config', async ({ page }) => {
    const sanitized = await page.evaluate(() => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      const dirtyHtml = '<span data-blok-id="allowed" style="color:red">Span <em>content</em></span>';

      return window.editorInstance.sanitizer.clean(dirtyHtml, {
        span: {
          'data-blok-id': true,
        },
        em: {},
      });
    });

    expect(sanitized).toContain('<span data-blok-id="allowed">');
    expect(sanitized).toContain('<em>content</em>');
    expect(sanitized).not.toContain('style=');
  });
});
