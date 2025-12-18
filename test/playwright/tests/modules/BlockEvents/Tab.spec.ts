import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Blok } from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const TEST_PAGE_URL = pathToFileURL(
  path.resolve(__dirname, '../../../fixtures/test.html')
).href;
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
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('should focus next block when current block has single input', async ({ page }) => {
    await createParagraphBlok(page, ['first paragraph', 'second paragraph']);

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'first paragraph' });
    const secondParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'second paragraph' });

    await firstParagraph.click();
    await firstParagraph.press('Tab');

    await expect(secondParagraph).toBeFocused();
  });

  test('should focus next input within same block when block has multiple inputs', async ({ page }) => {
    await createBlokWithTwoInputTool(page);

    const firstInput = page.locator(TOOL_WITH_TWO_INPUTS_PRIMARY_SELECTOR);
    const secondInput = page.locator(TOOL_WITH_TWO_INPUTS_SECONDARY_SELECTOR);

    await firstInput.click();
    await firstInput.press('Tab');

    await expect(secondInput).toBeFocused();
  });

  test('should highlight next block when it is contentless (has no inputs)', async ({ page }) => {
    await createBlokWithContentlessTool(page);

    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'second paragraph' });

    await firstParagraph.click();
    await firstParagraph.press('Tab');

    await page.waitForFunction(
      ({ selector }) => {
        const element = document.querySelector(selector);

        return element?.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-selected') === 'true';
      },
      { selector: CONTENTLESS_TOOL_SELECTOR }
    );

    const contentlessTool = page.locator(CONTENTLESS_TOOL_SELECTOR);

    const isSelected = await contentlessTool.evaluate((element) => {
      return element.closest('[data-blok-element]')?.getAttribute('data-blok-selected') === 'true';
    });

    expect(isSelected).toBeTruthy();
  });

  test('should focus input outside blok when Tab pressed in last block', async ({ page }) => {
    await createDefaultBlok(page);
    await addRegularInput(page, 'after');
    await page.evaluate(() => {
      /**
       * Hide block tune popovers to keep the tab order identical to the previous e2e plugin,
       * which skips hidden elements when emulating native Tab navigation.
       */
      const elements = Array.from(document.querySelectorAll('[data-blok-testid="popover-items"]'));

      for (const element of elements) {
        (element as HTMLElement).style.display = 'none';
      }
    });

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'default paragraph' });
    const regularInput = page.locator(REGULAR_INPUT_SELECTOR);

    await lastParagraph.click();
    await lastParagraph.press('Tab');

    await expect(regularInput).toBeFocused();
  });
});

test.describe('shift+Tab keydown', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
  });

  test('should focus previous block when current block has single input', async ({ page }) => {
    await createParagraphBlok(page, ['first paragraph', 'second paragraph']);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'second paragraph' });
    const firstParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'first paragraph' });

    await lastParagraph.click();
    await lastParagraph.press('Shift+Tab');

    await expect(firstParagraph).toBeFocused();
  });

  test('should focus previous input within same block when block has multiple inputs', async ({ page }) => {
    await createBlokWithTwoInputTool(page);

    const firstInput = page.locator(TOOL_WITH_TWO_INPUTS_PRIMARY_SELECTOR);
    const secondInput = page.locator(TOOL_WITH_TWO_INPUTS_SECONDARY_SELECTOR);

    await secondInput.click();
    await secondInput.press('Shift+Tab');

    await expect(firstInput).toBeFocused();
  });

  test('should highlight previous block when it is contentless (has no inputs)', async ({ page }) => {
    await createBlokWithContentlessTool(page);

    const lastParagraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'third paragraph' });

    await lastParagraph.click();
    await lastParagraph.press('Shift+Tab');

    await page.waitForFunction(
      ({ selector }) => {
        const element = document.querySelector(selector);

        return element?.closest('[data-blok-testid="block-wrapper"]')?.getAttribute('data-blok-selected') === 'true';
      },
      { selector: CONTENTLESS_TOOL_SELECTOR }
    );

    const contentlessTool = page.locator(CONTENTLESS_TOOL_SELECTOR);
    const isSelected = await contentlessTool.evaluate((element) => {
      return element.closest('[data-blok-element]')?.getAttribute('data-blok-selected') === 'true';
    });

    expect(isSelected).toBeTruthy();
  });

  test('should focus input outside blok when Shift+Tab pressed in first block', async ({ page }) => {
    await createDefaultBlok(page);
    await addRegularInput(page, 'before');

    const paragraph = page.locator(PARAGRAPH_SELECTOR).filter({ hasText: 'default paragraph' });
    const regularInput = page.locator(REGULAR_INPUT_SELECTOR);

    await paragraph.click();
    await paragraph.press('Shift+Tab');

    await expect(regularInput).toBeFocused();
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
