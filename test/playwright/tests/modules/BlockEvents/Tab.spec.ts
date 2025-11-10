import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type EditorJS from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureEditorBundleBuilt } from '../../helpers/ensure-build';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../../cypress/fixtures/test.html')
).href;
const HOLDER_ID = 'editorjs';
const EDITOR_SELECTOR = '[data-cy=editorjs]';
const PARAGRAPH_SELECTOR = `${EDITOR_SELECTOR} [data-block-tool="paragraph"]`;
const TOOL_WITH_TWO_INPUTS_SELECTOR = '[data-cy=tool-with-two-inputs] div[contenteditable=true]';
const CONTENTLESS_TOOL_SELECTOR = '[data-cy=contentless-tool]';
const REGULAR_INPUT_SELECTOR = '[data-cy=regular-input]';

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

const createDefaultEditor = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId }) => {
    const editor = new window.EditorJS({ holder: holderId });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID });
};

const createEditorWithTwoInputTool = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId }) => {
    /**
     *
     */
    class ToolWithTwoInputs {
      /**
       *
       */
      public render(): HTMLElement {
        const wrapper = document.createElement('div');
        const input1 = document.createElement('div');
        const input2 = document.createElement('div');

        wrapper.dataset.cy = 'tool-with-two-inputs';

        input1.contentEditable = 'true';
        input2.contentEditable = 'true';

        wrapper.append(input1, input2);

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
        toolWithTwoInputs: ToolWithTwoInputs,
      },
      data: {
        blocks: [
          {
            type: 'toolWithTwoInputs',
            data: {},
          },
          {
            type: 'paragraph',
            data: {
              text: 'second paragraph',
            },
          },
        ],
      },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID });
};

const createEditorWithContentlessTool = async (page: Page): Promise<void> => {
  await resetEditor(page);
  await page.evaluate(async ({ holderId }) => {
    /**
     *
     */
    class ContentlessTool {
      public static contentless = true;

      /**
       *
       */
      public render(): HTMLElement {
        const wrapper = document.createElement('div');

        wrapper.dataset.cy = 'contentless-tool';
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
        contentlessTool: ContentlessTool,
      },
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'second paragraph',
            },
          },
          {
            type: 'contentlessTool',
            data: {},
          },
          {
            type: 'paragraph',
            data: {
              text: 'third paragraph',
            },
          },
        ],
      },
    });

    window.editorInstance = editor;
    await editor.isReady;
  }, { holderId: HOLDER_ID });
};

const addRegularInput = async (page: Page, position: 'before' | 'after'): Promise<void> => {
  await page.evaluate(({ placement, holderId }) => {
    const input = document.createElement('input');
    const holder = document.getElementById(holderId);

    if (!holder || !holder.parentNode) {
      throw new Error('Editor holder is not available');
    }

    input.dataset.cy = 'regular-input';

    if (placement === 'before') {
      holder.parentNode.insertBefore(input, holder);
    } else if (holder.nextSibling) {
      holder.parentNode.insertBefore(input, holder.nextSibling);
    } else {
      holder.parentNode.appendChild(input);
    }
  }, { placement: position,
    holderId: HOLDER_ID });
};

test.describe('Tab keydown', () => {
  test.beforeAll(() => {
    ensureEditorBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should focus next block when current block has single input', async ({ page }) => {
    await createParagraphEditor(page, ['first paragraph', 'second paragraph']);

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).first();
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await firstParagraph.click();
    await firstParagraph.press('Tab');

    await expect(secondParagraph).toBeFocused();
  });

  test('should focus next input within same block when block has multiple inputs', async ({ page }) => {
    await createEditorWithTwoInputTool(page);

    const firstInput = page.locator(TOOL_WITH_TWO_INPUTS_SELECTOR).first();
    const secondInput = page.locator(TOOL_WITH_TWO_INPUTS_SELECTOR).last();

    await firstInput.click();
    await firstInput.press('Tab');

    await expect(secondInput).toBeFocused();
  });

  test('should highlight next block when it is contentless (has no inputs)', async ({ page }) => {
    await createEditorWithContentlessTool(page);

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).first();

    await firstParagraph.click();
    await firstParagraph.press('Tab');

    await page.waitForFunction(
      ({ selector }) => {
        const element = document.querySelector(selector);

        return element?.closest('.ce-block')?.classList.contains('ce-block--selected') ?? false;
      },
      { selector: CONTENTLESS_TOOL_SELECTOR }
    );

    const contentlessTool = page.locator(CONTENTLESS_TOOL_SELECTOR);

    const isSelected = await contentlessTool.evaluate((element) => {
      return element.closest('.ce-block')?.classList.contains('ce-block--selected') ?? false;
    });

    expect(isSelected).toBeTruthy();
  });

  test('should focus input outside editor when Tab pressed in last block', async ({ page }) => {
    await createDefaultEditor(page);
    await addRegularInput(page, 'after');
    await page.evaluate(() => {
      /**
       * Hide block tune popovers to keep the tab order identical to the Cypress plugin,
       * which skips hidden elements when emulating native Tab navigation.
       */
      const elements = Array.from(document.querySelectorAll('.ce-popover__items'));

      for (const element of elements) {
        (element as HTMLElement).style.display = 'none';
      }
    });

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();
    const regularInput = page.locator(REGULAR_INPUT_SELECTOR);

    await lastParagraph.click();
    await lastParagraph.press('Tab');

    await expect(regularInput).toBeFocused();
  });
});

test.describe('Shift+Tab keydown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.EditorJS === 'function');
  });

  test('should focus previous block when current block has single input', async ({ page }) => {
    await createParagraphEditor(page, ['first paragraph', 'second paragraph']);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();
    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).first();

    await lastParagraph.click();
    await lastParagraph.press('Shift+Tab');

    await expect(firstParagraph).toBeFocused();
  });

  test('should focus previous input within same block when block has multiple inputs', async ({ page }) => {
    await createEditorWithTwoInputTool(page);

    const firstInput = page.locator(TOOL_WITH_TWO_INPUTS_SELECTOR).first();
    const secondInput = page.locator(TOOL_WITH_TWO_INPUTS_SELECTOR).last();

    await secondInput.click();
    await secondInput.press('Shift+Tab');

    await expect(firstInput).toBeFocused();
  });

  test('should highlight previous block when it is contentless (has no inputs)', async ({ page }) => {
    await createEditorWithContentlessTool(page);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).last();

    await lastParagraph.click();
    await lastParagraph.press('Shift+Tab');

    await page.waitForFunction(
      ({ selector }) => {
        const element = document.querySelector(selector);

        return element?.closest('.ce-block')?.classList.contains('ce-block--selected') ?? false;
      },
      { selector: CONTENTLESS_TOOL_SELECTOR }
    );

    const contentlessTool = page.locator(CONTENTLESS_TOOL_SELECTOR);
    const isSelected = await contentlessTool.evaluate((element) => {
      return element.closest('.ce-block')?.classList.contains('ce-block--selected') ?? false;
    });

    expect(isSelected).toBeTruthy();
  });

  test('should focus input outside editor when Shift+Tab pressed in first block', async ({ page }) => {
    await createDefaultEditor(page);
    await addRegularInput(page, 'before');

    const paragraph = page.locator(PARAGRAPH_SELECTOR).first();
    const regularInput = page.locator(REGULAR_INPUT_SELECTOR);

    await paragraph.click();
    await paragraph.press('Shift+Tab');

    await expect(regularInput).toBeFocused();
  });
});

declare global {
  interface Window {
    editorInstance?: EditorJS;
    EditorJS: new (...args: unknown[]) => EditorJS;
  }
}
