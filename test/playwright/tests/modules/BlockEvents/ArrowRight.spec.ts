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
const CONTENTLESS_TOOL_SELECTOR = '[data-cy-type="contentless-tool"]';

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

const createEditorWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
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

const createParagraphEditor = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createEditorWithBlocks(page, blocks);
};

const createEditorWithContentlessBlock = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId }) => {
    /**
     *
     */
    class ContentlessToolMock {
      /**
       *
       */
      public static get contentless(): boolean {
        return true;
      }

      /**
       *
       */
      public render(): HTMLElement {
        const wrapper = document.createElement('div');

        wrapper.dataset.cy = 'contentless-tool';
        wrapper.dataset.cyType = 'contentless-tool';
        wrapper.textContent = '***';

        return wrapper;
      }

      /**
       *
       */
      public save(): Record<string, never> {
        return {};
      }
    }

    const editor = new window.EditorJS({
      holder: holderId,
      tools: {
        delimiter: ContentlessToolMock,
      },
      data: {
        blocks: [
          {
            id: 'block1',
            type: 'paragraph',
            data: {
              text: '1',
            },
          },
          {
            id: 'block2',
            type: 'delimiter',
            data: {},
          },
          {
            id: 'block3',
            type: 'paragraph',
            data: {
              text: '2',
            },
          },
        ],
      },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID });
};

const getParagraphByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${PARAGRAPH_SELECTOR}, ${index + 1})`);
};

const getCaretInfo = (locator: Locator, options: { normalize?: boolean } = {}): Promise<{ inside: boolean; offset: number; textLength: number } | null> => {
  return locator.evaluate((element, { normalize }) => {
    const selection = element.ownerDocument.getSelection();

    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);

    if (normalize) {
      range.startContainer.normalize();
    }

    return {
      inside: element.contains(range.startContainer),
      offset: range.startOffset,
      textLength: element.textContent?.length ?? 0,
    };
  }, { normalize: options.normalize ?? false });
};

const getCaretInfoOrThrow = async (
  locator: Locator,
  options: { normalize?: boolean } = {}
): Promise<{ inside: boolean; offset: number; textLength: number }> => {
  const caretInfo = await getCaretInfo(locator, options);

  if (caretInfo === null) {
    throw new Error('Failed to retrieve caret information.');
  }

  return caretInfo;
};

test.describe('arrow right keydown', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test.describe('starting whitespaces handling', () => {
    test('should move caret over visible non-breaking space then to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1&nbsp;', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo).toMatchObject({
        inside: true,
        offset: 0,
      });
    });

    test('should ignore invisible space after caret and move to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1 ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo).toMatchObject({
        inside: true,
        offset: 0,
      });
    });

    test('should ignore empty tags after caret and move to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo).toMatchObject({
        inside: true,
        offset: 0,
      });
    });

    test('should move caret over visible space and then to next block when empty tag follows', async ({ page }) => {
      await createParagraphEditor(page, ['1&nbsp;<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo).toMatchObject({
        inside: true,
        offset: 0,
      });
    });

    test('should ignore empty tag and move caret over visible space before moving to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1<b></b>&nbsp;', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo).toMatchObject({
        inside: true,
        offset: 0,
      });
    });

    test('should move caret over visible space and ignore trailing space before moving to next block', async ({ page }) => {
      await createParagraphEditor(page, ['1&nbsp; ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo).toMatchObject({
        inside: true,
        offset: 0,
      });
    });
  });

  test('should move caret to next block if currently focused block is contentless', async ({ page }) => {
    await createEditorWithContentlessBlock(page);

    const firstParagraph = getParagraphByIndex(page, 0);
    const contentlessBlock = page.locator(BLOCK_SELECTOR, {
      has: page.locator(CONTENTLESS_TOOL_SELECTOR),
    });
    const lastParagraph = getParagraphByIndex(page, 1);

    await firstParagraph.click();
    await firstParagraph.press('End');
    await page.keyboard.press('ArrowRight');

    await expect(contentlessBlock).toHaveClass(/ce-block--selected/);

    await page.keyboard.press('ArrowRight');

    await expect(contentlessBlock).not.toHaveClass(/ce-block--selected/);
    const caretInfo = await getCaretInfoOrThrow(lastParagraph);

    expect(caretInfo).toMatchObject({
      inside: true,
      offset: 0,
    });
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}

