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
const PARAGRAPH_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .ce-paragraph`;
const REDACTOR_SELECTOR = `${EDITOR_INTERFACE_SELECTOR} .codex-editor__redactor`;

type CreateEditorOptions = {
  data?: OutputData;
  readOnly?: boolean;
};

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
    container.dataset.cy = holderId;
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holderId: HOLDER_ID });
};

const createEditor = async (page: Page, options: CreateEditorOptions = {}): Promise<void> => {
  const { data, readOnly } = options;

  await resetEditor(page);
  await page.waitForFunction(() => typeof window.EditorJS === 'function');

  await page.evaluate(
    async ({ holderId, editorData, readOnlyMode }) => {
      const editorConfig: Record<string, unknown> = {
        holder: holderId,
      };

      if (editorData !== null) {
        editorConfig.data = editorData;
      }

      if (readOnlyMode !== null) {
        editorConfig.readOnly = readOnlyMode;
      }

      const editor = new window.EditorJS(editorConfig);

      window.editorInstance = editor;
      await editor.isReady;
    },
    {
      holderId: HOLDER_ID,
      editorData: data ?? null,
      readOnlyMode: typeof readOnly === 'boolean' ? readOnly : null,
    }
  );
};

const ensureBottomPadding = async (page: Page): Promise<void> => {
  await page.evaluate(({ selector }) => {
    const redactor = document.querySelector(selector);

    if (!redactor) {
      throw new Error('Redactor element not found');
    }

    (redactor as HTMLElement).style.paddingBottom = '200px';
  }, { selector: REDACTOR_SELECTOR });
};

const clickBottomZone = async (page: Page): Promise<void> => {
  const clickPoint = await page.evaluate(({ selector }) => {
    const redactor = document.querySelector(selector);

    if (!redactor) {
      throw new Error('Redactor element not found');
    }

    const rect = redactor.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = Math.min(rect.bottom - 4, rect.top + rect.height - 4);

    return {
      x: clientX,
      y: clientY,
    };
  }, { selector: REDACTOR_SELECTOR });

  await page.mouse.click(clickPoint.x, clickPoint.y);
};

test.describe('ui module', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
  });

  test.describe('documentKeydown', () => {
    const initialData: OutputData = {
      blocks: [
        {
          id: 'block1',
          type: 'paragraph',
          data: {
            text: 'The first block',
          },
        },
        {
          id: 'block2',
          type: 'paragraph',
          data: {
            text: 'The second block',
          },
        },
      ],
    };

    const selectBlocks = async (page: Page): Promise<void> => {
      const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({
        hasText: 'The first block',
      });

      await firstParagraph.click();
      await page.keyboard.press('Shift+ArrowDown');
    };

    const getSavedBlocksCount = async (page: Page): Promise<number> => {
      return await page.evaluate(async () => {
        const editor = window.editorInstance;

        if (!editor) {
          throw new Error('Editor instance not found');
        }

        const savedData = await editor.save();

        return savedData.blocks.length;
      });
    };

    test('removes selected blocks with Backspace', async ({ page }) => {
      await createEditor(page, { data: initialData });
      await selectBlocks(page);

      await page.keyboard.press('Backspace');
      await page.waitForFunction(() => {
        const editor = window.editorInstance;

        if (!editor) {
          return false;
        }

        return editor.blocks.getBlocksCount() === 1;
      });

      const savedBlocksCount = await getSavedBlocksCount(page);

      expect(savedBlocksCount).toBe(0);
    });

    test('removes selected blocks with Delete', async ({ page }) => {
      await createEditor(page, { data: initialData });
      await selectBlocks(page);

      await page.keyboard.press('Delete');
      await page.waitForFunction(() => {
        const editor = window.editorInstance;

        if (!editor) {
          return false;
        }

        return editor.blocks.getBlocksCount() === 1;
      });

      const savedBlocksCount = await getSavedBlocksCount(page);

      expect(savedBlocksCount).toBe(0);
    });
  });

  test.describe('mousedown', () => {
    const textBlocks: OutputData = {
      blocks: [
        {
          type: 'paragraph',
          data: {
            text: 'first block',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'second block',
          },
        },
        {
          type: 'paragraph',
          data: {
            text: 'third block',
          },
        },
      ],
    };

    test('updates current block on click', async ({ page }) => {
      await createEditor(page, { data: textBlocks });

      const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({
        hasText: 'second block',
      });

      await secondParagraph.click();
      const currentIndex = await page.evaluate(() => {
        const editor = window.editorInstance;

        if (!editor) {
          throw new Error('Editor instance not found');
        }

        return editor.blocks.getCurrentBlockIndex();
      });

      expect(currentIndex).toBe(1);
    });

    test('updates current block on click in read-only mode', async ({ page }) => {
      await createEditor(page, {
        data: textBlocks,
        readOnly: true,
      });

      const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({
        hasText: 'second block',
      });

      await secondParagraph.click();
      const currentIndex = await page.evaluate(() => {
        const editor = window.editorInstance;

        if (!editor) {
          throw new Error('Editor instance not found');
        }

        return editor.blocks.getCurrentBlockIndex();
      });

      expect(currentIndex).toBe(1);
    });
  });

  test.describe('bottom zone interactions', () => {
    test('keeps single empty default block when clicking bottom zone', async ({ page }) => {
      await createEditor(page);
      await ensureBottomPadding(page);

      await clickBottomZone(page);

      const result = await page.evaluate(() => {
        const editor = window.editorInstance;

        if (!editor) {
          throw new Error('Editor instance not found');
        }

        return {
          blocksCount: editor.blocks.getBlocksCount(),
          currentIndex: editor.blocks.getCurrentBlockIndex(),
        };
      });

      expect(result.blocksCount).toBe(1);
      expect(result.currentIndex).toBe(0);
    });

    test('inserts new default block when clicking bottom zone with non-empty block', async ({ page }) => {
      await createEditor(page, {
        data: {
          blocks: [
            {
              type: 'paragraph',
              data: {
                text: 'The only block',
              },
            },
          ],
        },
      });
      await ensureBottomPadding(page);

      await clickBottomZone(page);
      await page.waitForFunction(() => {
        const editor = window.editorInstance;

        if (!editor) {
          return false;
        }

        return editor.blocks.getBlocksCount() === 2;
      });

      const result = await page.evaluate(() => {
        const editor = window.editorInstance;

        if (!editor) {
          throw new Error('Editor instance not found');
        }

        const blocksCount = editor.blocks.getBlocksCount();
        const currentIndex = editor.blocks.getCurrentBlockIndex();
        const lastBlock = editor.blocks.getBlockByIndex(blocksCount - 1);

        return {
          blocksCount,
          currentIndex,
          lastBlockIsEmpty: lastBlock?.isEmpty ?? false,
        };
      });

      expect(result.blocksCount).toBe(2);
      expect(result.currentIndex).toBe(1);
      expect(result.lastBlockIsEmpty).toBe(true);
    });
  });
});

