import type { Page } from '@playwright/test';
import type { Blok } from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';
import { expect, gotoTestPage, test } from '../../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const TOOL_WITH_TWO_INPUTS_PRIMARY_SELECTOR = '[data-blok-testid=tool-with-two-inputs-primary]';
const TOOL_WITH_TWO_INPUTS_SECONDARY_SELECTOR = '[data-blok-testid=tool-with-two-inputs-secondary]';
const CONTENTLESS_TOOL_SELECTOR = '[data-blok-testid=contentless-tool]';
const REGULAR_INPUT_SELECTOR = '[data-blok-testid=regular-input]';

const resetBlok = async (page: Page): Promise<void> => {
  await page.evaluate(async ({ holder }) => {
    if (window.blokInstance) {
      await window.blokInstance.destroy?.();
      window.blokInstance = undefined;
    }

    document.getElementById(holder)?.remove();

    const container = document.createElement('div');

    container.id = holder;
    container.setAttribute('data-blok-testid', holder);
    container.style.border = '1px dotted #388AE5';

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createParagraphBlok = async (page: Page, paragraphs: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = paragraphs.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder: holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID,
    blocks });
};

const createDefaultBlok = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
    const blok = new window.Blok({
      holder: holder,
      data: {
        blocks: [
          {
            type: 'paragraph',
            data: {
              text: 'default paragraph',
            },
          },
        ],
      },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const createBlokWithTwoInputTool = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
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

        wrapper.setAttribute('data-blok-testid', 'tool-with-two-inputs');

        input1.contentEditable = 'true';
        input2.contentEditable = 'true';
        input1.setAttribute('data-blok-testid', 'tool-with-two-inputs-primary');
        input2.setAttribute('data-blok-testid', 'tool-with-two-inputs-secondary');

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

    const blok = new window.Blok({
      holder: holder,
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

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const createBlokWithContentlessTool = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
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

        wrapper.setAttribute('data-blok-testid', 'contentless-tool');
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

    const blok = new window.Blok({
      holder: holder,
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

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
};

const addRegularInput = async (page: Page, position: 'before' | 'after'): Promise<void> => {
  await page.evaluate(({ placement, holder }) => {
    const input = document.createElement('input');
    const holderElement = document.getElementById(holder);

    if (!holderElement || !holderElement.parentNode) {
      throw new Error('Blok holder is not available');
    }

    input.setAttribute('data-blok-testid', 'regular-input');

    if (placement === 'before') {
      holderElement.parentNode.insertBefore(input, holderElement);
    } else if (holderElement.nextSibling) {
      holderElement.parentNode.insertBefore(input, holderElement.nextSibling);
    } else {
      holderElement.parentNode.appendChild(input);
    }
  }, { placement: position,
    holder: HOLDER_ID });
};

test.describe('tab keydown', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('keeps focus in place when the first block has no preceding sibling to indent under', async ({ page }) => {
    await createParagraphBlok(page, ['first paragraph', 'second paragraph']);

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'first paragraph' });

    await firstParagraph.click();
    await firstParagraph.press('Tab');

    // Notion: a non-indentable Tab is a strict no-op — focus must NOT jump to the
    // next block. handleTab preventDefaults so native Tab cannot relocate focus.
    await expect(firstParagraph).toBeFocused();
  });

  test('walks to the next input within a multi-input block when Tab cannot indent', async ({ page }) => {
    await createBlokWithTwoInputTool(page);

    const firstInput = page.locator(TOOL_WITH_TWO_INPUTS_PRIMARY_SELECTOR);
    const secondInput = page.locator(TOOL_WITH_TWO_INPUTS_SECONDARY_SELECTOR);

    await firstInput.click();
    await firstInput.press('Tab');

    // The block can't indent (no preceding sibling), but it has a second input.
    // Native Tab walks to it — that keeps focus INSIDE the editor (the divergence
    // we fix is Tab leaving the editor, not Tab moving between a block's own inputs).
    await expect(secondInput).toBeFocused();
  });

  test('Tab is a no-op when there is no preceding sibling to indent under', async ({ page }) => {
    /**
     * Tab now performs Notion-style structural indentation: it nests the current
     * block under its preceding sibling. The first block of the document has no
     * preceding sibling, so `indentCurrentBlock` returns false
     * (keyboardNavigation.ts: getPrecedingSibling === null → return false) and
     * `handleTab` is a strict no-op — it does NOT relocate the caret to, or
     * highlight, the contentless block below it (the removed legacy behaviour).
     */
    await createBlokWithContentlessTool(page);

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'second paragraph' });

    await firstParagraph.click();
    await firstParagraph.press('Tab');

    // No-op contract #1: the contentless block must NOT be selected/highlighted.
    const contentlessSelected = await page.locator(CONTENTLESS_TOOL_SELECTOR).evaluate((element) => {
      return element.closest('[data-blok-element]')?.getAttribute('data-blok-selected') === 'true';
    });

    expect(contentlessSelected).toBe(false);

    // No-op contract #2: structure is untouched — no block was indented/nested
    // and the block order/count is unchanged.
    const savedTypes = await page.evaluate(async () => {
      const output = await window.blokInstance?.save();

      return output?.blocks.map((block) => block.type) ?? [];
    });

    expect(savedTypes).toEqual(['paragraph', 'contentlessTool', 'paragraph']);
  });

  test('keeps focus inside the editor on Tab instead of tabbing out to a sibling input', async ({ page }) => {
    await createDefaultBlok(page);
    await addRegularInput(page, 'after');

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'default paragraph' });
    const regularInput = page.locator(REGULAR_INPUT_SELECTOR);

    await lastParagraph.click();
    await lastParagraph.press('Tab');

    // The sole block has no preceding sibling → Tab is a strict no-op. Notion never
    // tabs focus out of the editor: preventDefault keeps the caret in the block and
    // the external input must NOT receive focus.
    await expect(lastParagraph).toBeFocused();
    await expect(regularInput).not.toBeFocused();
  });
});

test.describe('shift+Tab keydown', () => {
  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('keeps focus in place when a root block cannot be outdented (single input)', async ({ page }) => {
    await createParagraphBlok(page, ['first paragraph', 'second paragraph']);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'second paragraph' });

    await lastParagraph.click();
    await lastParagraph.press('Shift+Tab');

    // The block is already at root (parentId === null) → Shift+Tab is a strict
    // no-op. Notion never relocates the caret to another block: focus stays put.
    await expect(lastParagraph).toBeFocused();
  });

  test('walks to the previous input within a multi-input block when Shift+Tab cannot outdent', async ({ page }) => {
    await createBlokWithTwoInputTool(page);

    const firstInput = page.locator(TOOL_WITH_TWO_INPUTS_PRIMARY_SELECTOR);
    const secondInput = page.locator(TOOL_WITH_TWO_INPUTS_SECONDARY_SELECTOR);

    await secondInput.click();
    await secondInput.press('Shift+Tab');

    // Can't outdent (root block) but there is an earlier input — native Shift+Tab
    // walks back to it, keeping focus INSIDE the editor.
    await expect(firstInput).toBeFocused();
  });

  test('Shift+Tab is a no-op when the block is already at the root level', async ({ page }) => {
    /**
     * Shift+Tab now performs Notion-style structural outdent: it lifts the current
     * block out of its parent. A root block has `parentId === null`, so
     * `outdentCurrentBlock` returns false (keyboardNavigation.ts:
     * currentBlock.parentId === null → return false) and `handleTab` is a strict
     * no-op — it does NOT relocate the caret to, or highlight, the contentless
     * block above it (the removed legacy behaviour).
     */
    await createBlokWithContentlessTool(page);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'third paragraph' });

    await lastParagraph.click();
    await lastParagraph.press('Shift+Tab');

    // No-op contract #1: the contentless block must NOT be selected/highlighted.
    const contentlessSelected = await page.locator(CONTENTLESS_TOOL_SELECTOR).evaluate((element) => {
      return element.closest('[data-blok-element]')?.getAttribute('data-blok-selected') === 'true';
    });

    expect(contentlessSelected).toBe(false);

    // No-op contract #2: structure is untouched — no block was outdented and the
    // block order/count is unchanged.
    const savedTypes = await page.evaluate(async () => {
      const output = await window.blokInstance?.save();

      return output?.blocks.map((block) => block.type) ?? [];
    });

    expect(savedTypes).toEqual(['paragraph', 'contentlessTool', 'paragraph']);
  });

  test('keeps focus inside the editor on Shift+Tab instead of tabbing out to a sibling input', async ({ page }) => {
    await createDefaultBlok(page);
    await addRegularInput(page, 'before');

    const paragraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'default paragraph' });
    const regularInput = page.locator(REGULAR_INPUT_SELECTOR);

    await paragraph.click();
    await paragraph.press('Shift+Tab');

    // The sole block is at root → Shift+Tab is a strict no-op. Notion never tabs
    // focus out of the editor: focus stays in the block, the external input does not.
    await expect(paragraph).toBeFocused();
    await expect(regularInput).not.toBeFocused();
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
