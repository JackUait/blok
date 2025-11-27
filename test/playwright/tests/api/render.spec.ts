import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type EditorJS from '@/types';
import { ensureEditorBundleBuilt } from '../helpers/ensure-build';
import { EDITOR_INTERFACE_SELECTOR } from '../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../fixtures/test.html')
).href;

const HOLDER_ID = 'editorjs';
const BLOCK_WRAPPER_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;

const getBlockWrapperByIndex = (page: Page, index: number = 0): Locator => {
  return page.locator(`:nth-match(${BLOCK_WRAPPER_SELECTOR}, ${index + 1})`);
};

type SerializableOutputData = {
  version?: string;
  time?: number;
  blocks: Array<{
    id?: string;
    type: string;
    data: Record<string, unknown>;
    tunes?: Record<string, unknown>;
  }>;
};

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

const createEditor = async (page: Page, data?: SerializableOutputData): Promise<void> => {
  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(
    async ({ holder, rawData }) => {
      const editorConfig: Record<string, unknown> = {
        holder: holder,
      };

      if (rawData) {
        editorConfig.data = rawData;
      }

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holder: HOLDER_ID,
      rawData: data ?? null,
    }
  );
};

const defaultInitialData: SerializableOutputData = {
  blocks: [
    {
      id: 'initial-block',
      type: 'paragraph',
      data: {
        text: 'Initial block content',
      },
    },
  ],
};

test.describe('api.render', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test('editor.render replaces existing document content', async ({ page }) => {
    await createEditor(page, defaultInitialData);

    const initialBlock = getBlockWrapperByIndex(page);

    await expect(initialBlock).toHaveText('Initial block content');

    const newData: SerializableOutputData = {
      blocks: [
        {
          id: 'rendered-block',
          type: 'paragraph',
          data: { text: 'Rendered via API' },
        },
      ],
    };

    await page.evaluate(async ({ data }) => {
      if (!window.editorInstance) {
        throw new Error('Editor instance not found');
      }

      await window.editorInstance.render(data);
    }, { data: newData });

    await expect(initialBlock).toHaveText('Rendered via API');
  });

  test.describe('render accepts different data formats', () => {
    const dataVariants: Array<{ title: string; data: SerializableOutputData; expectedText: string; }> = [
      {
        title: 'with metadata (version + time)',
        data: {
          version: '2.30.0',
          time: Date.now(),
          blocks: [
            {
              id: 'meta-block',
              type: 'paragraph',
              data: { text: 'Metadata format' },
            },
          ],
        },
        expectedText: 'Metadata format',
      },
      {
        title: 'minimal object containing only blocks',
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: { text: 'Minimal format' },
            },
          ],
        },
        expectedText: 'Minimal format',
      },
    ];

    for (const variant of dataVariants) {
      test(`renders data ${variant.title}`, async ({ page }) => {
        await createEditor(page, defaultInitialData);

        await page.evaluate(async ({ data }) => {
          if (!window.editorInstance) {
            throw new Error('Editor instance not found');
          }

          await window.editorInstance.render(data);
        }, { data: variant.data });

        await expect(getBlockWrapperByIndex(page)).toHaveText(variant.expectedText);
      });
    }
  });

  test.describe('edge cases', () => {
    test('inserts a default block when empty data is rendered', async ({ page }) => {
      await createEditor(page, defaultInitialData);

      const blockCount = await page.evaluate(async () => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        await window.editorInstance.render({ blocks: [] });

        return window.editorInstance.blocks.getBlocksCount();
      });

      await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
      expect(blockCount).toBe(1);
    });

    test('throws a descriptive error when data is invalid', async ({ page }) => {
      await createEditor(page, defaultInitialData);

      const errorMessage = await page.evaluate(async () => {
        if (!window.editorInstance) {
          throw new Error('Editor instance not found');
        }

        try {
          await window.editorInstance.render({} as SerializableOutputData);

          return null;
        } catch (error) {
          return (error as Error).message;
        }
      });

      expect(errorMessage).toBe('Incorrect data passed to the render() method');
      await expect(getBlockWrapperByIndex(page)).toHaveText('Initial block content');
    });
  });
});
