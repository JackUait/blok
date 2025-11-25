/* eslint-disable jsdoc/require-jsdoc, @typescript-eslint/explicit-function-return-type */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import type { OutputBlockData, OutputData } from '@/types';
import { ensureEditorBundleBuilt } from './helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';

declare global {
  interface Window {
    editorInstance?: EditorJS;
  }
}

type SerializableOutputData = {
  blocks?: Array<OutputBlockData>;
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
    container.setAttribute('data-testid', holderId);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

test.describe('editor error handling', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('reports a descriptive error when tool configuration is invalid', async ({ page }) => {
    await resetEditor(page);

    const errorMessage = await page.evaluate(async ({ holderId }) => {
      try {
        const editor = new window.EditorJS({
          holder: holderId,
          tools: {
            brokenTool: {
              inlineToolbar: true,
            },
          },
        });

        window.editorInstance = editor;
        await editor.isReady;

        return null;
      } catch (error) {
        return (error as Error).message;
      }
    }, { holderId: HOLDER_ID });

    expect(errorMessage).toBe('Tool «brokenTool» must be a constructor function or an object with function in the «class» property');
  });

  test('logs a warning when required inline tool methods are missing', async ({ page }) => {
    await resetEditor(page);

    const warningPromise = page.waitForEvent('console', {
      predicate: (message) => message.type() === 'warning' && message.text().includes('Incorrect Inline Tool'),
    });

    await page.evaluate(async ({ holderId }) => {
      class InlineWithoutRender {
        public static isInline = true;
      }

      const editor = new window.EditorJS({
        holder: holderId,
        tools: {
          inlineWithoutRender: {
            class: InlineWithoutRender,
          },
        },
      });

      window.editorInstance = editor;
      await editor.isReady;
    }, { holderId: HOLDER_ID });

    const warningMessage = await warningPromise;

    expect(warningMessage.text()).toContain('Incorrect Inline Tool: inlineWithoutRender');
  });

  test('throws a descriptive error when render() receives invalid data format', async ({ page }) => {
    await resetEditor(page);

    const initialData: SerializableOutputData = {
      blocks: [
        {
          id: 'initial-block',
          type: 'paragraph',
          data: { text: 'Initial block' },
        },
      ],
    };

    await page.evaluate(async ({ holderId, data }) => {
      const editor = new window.EditorJS({
        holder: holderId,
        data,
      });

      window.editorInstance = editor;
      await editor.isReady;
    }, { holderId: HOLDER_ID,
      data: initialData });

    const errorMessage = await page.evaluate(async () => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      try {
        await window.editorInstance.render({} as OutputData);

        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(errorMessage).toBe('Incorrect data passed to the render() method');
  });

  test('blocks read-only initialization when tools do not support read-only mode', async ({ page }) => {
    await resetEditor(page);

    const errorMessage = await page.evaluate(async ({ holderId }) => {
      try {
        class NonReadOnlyTool {
          public static get toolbox() {
            return {
              title: 'Non-readonly tool',
              icon: '<svg></svg>',
            };
          }

          public render(): HTMLElement {
            const element = document.createElement('div');

            element.textContent = 'Non read-only block';

            return element;
          }

          public save(element: HTMLElement): Record<string, unknown> {
            return {
              text: element.textContent ?? '',
            };
          }
        }

        const editor = new window.EditorJS({
          holder: holderId,
          readOnly: true,
          tools: {
            nonReadOnly: {
              class: NonReadOnlyTool,
            },
          },
          data: {
            blocks: [
              {
                type: 'nonReadOnly',
                data: { text: 'content' },
              },
            ],
          },
        });

        window.editorInstance = editor;
        await editor.isReady;

        return null;
      } catch (error) {
        return (error as Error).message;
      }
    }, { holderId: HOLDER_ID });

    expect(errorMessage).toContain('To enable read-only mode all connected tools should support it.');
    expect(errorMessage).toContain('nonReadOnly');
  });

  test('throws a descriptive error when default holder element is missing', async ({ page }) => {
    await page.evaluate(({ holderId }) => {
      document.getElementById(holderId)?.remove();
    }, { holderId: HOLDER_ID });

    const errorMessage = await page.evaluate(async () => {
      try {
        const editor = new window.EditorJS();

        window.editorInstance = editor;
        await editor.isReady;

        return null;
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(errorMessage).toBe('element with ID «editorjs» is missing. Pass correct holder\'s ID.');
  });

  test('throws a descriptive error when holder config is not an Element node', async ({ page }) => {
    await resetEditor(page);

    const errorMessage = await page.evaluate(async ({ holderId }) => {
      try {
        const fakeHolder = { id: holderId };
        const editor = new window.EditorJS({
          holder: fakeHolder as unknown as HTMLElement,
        });

        window.editorInstance = editor;
        await editor.isReady;

        return null;
      } catch (error) {
        return (error as Error).message;
      }
    }, { holderId: HOLDER_ID });

    expect(errorMessage).toBe('«holder» value must be an Element node');
  });
});
