import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Blok } from '../../../../../types';
import type { OutputData } from '../../../../../types';
import { ensureBlokBundleBuilt, TEST_PAGE_URL } from '../../helpers/ensure-build';
import { BLOK_INTERFACE_SELECTOR } from '../../../../../src/components/constants';

const HOLDER_ID = 'blok';
const BLOCK_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"] [contenteditable]`;
const CONTENTLESS_TOOL_SELECTOR = '[data-blok-testid-type="contentless-tool"]';

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

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
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

const createParagraphBlok = async (page: Page, textBlocks: string[]): Promise<void> => {
  const blocks: OutputData['blocks'] = textBlocks.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));

  await createBlokWithBlocks(page, blocks);
};

const createBlokWithContentlessBlock = async (page: Page): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder }) => {
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

        wrapper.setAttribute('data-blok-testid', 'contentless-tool');
        wrapper.setAttribute('data-blok-testid-type', 'contentless-tool');
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

    window.blokInstance = blok;
    await blok.isReady;
  }, { holder: HOLDER_ID });
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

const waitForCaretInBlock = async (page: Page, locator: Locator, expectedBlockIndex: number): Promise<void> => {
  await expect.poll(async () => {
    const caretInfo = await getCaretInfo(locator);

    if (!caretInfo || !caretInfo.inside) {
      return null;
    }

    const currentIndex = await page.evaluate(() => {
      return window.blokInstance?.blocks.getCurrentBlockIndex?.() ?? -1;
    });

    return currentIndex;
  }, {
    message: `Expected caret to land inside block with index ${expectedBlockIndex}`,
  }).toBe(expectedBlockIndex);
};

test.describe('arrow right keydown', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(msg.text()));
    await page.goto(TEST_PAGE_URL);
    await page.waitForFunction(() => typeof window.Blok === 'function');
    await page.addStyleTag({ content: '[data-blok-tool="paragraph"] { white-space: pre-wrap !important; }' });
  });

  test.describe('starting whitespaces handling', () => {
    test('should move caret over visible non-breaking space then to next block', async ({ page }) => {
      await createParagraphBlok(page, ['1&nbsp;', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      // Explicitly set textContent to ensure NBSP is preserved
      await firstParagraph.evaluate((node) => {
        const content = node.querySelector('[data-blok-tool="paragraph"]');

        if (content) {
          content.textContent = '1\\u00A0';
        }
      });

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should ignore invisible space after caret and move to next block', async ({ page }) => {
      await createParagraphBlok(page, ['1 ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should ignore empty tags after caret and move to next block', async ({ page }) => {
      await createParagraphBlok(page, ['1<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      // Explicitly set innerHTML to ensure empty tags are preserved
      await firstParagraph.evaluate((node) => {
        const content = node.querySelector('[data-blok-tool="paragraph"]');

        if (content) {
          content.innerHTML = '1<b></b>';
        }
      });

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should move caret over visible space and then to next block when empty tag follows', async ({ page }) => {
      await createParagraphBlok(page, ['1&nbsp;<b></b>', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      // Explicitly set innerHTML to ensure empty tags and NBSP are preserved
      await firstParagraph.evaluate((node) => {
        const content = node.querySelector('[data-blok-tool="paragraph"]');

        if (content) {
          content.innerHTML = '1&nbsp;<b></b>';;
        }
      });

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should ignore empty tag and move caret over visible space before moving to next block', async ({ page }) => {
      await createParagraphBlok(page, ['1<b></b>&nbsp;', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      // Explicitly set innerHTML to ensure empty tags and NBSP are preserved
      await firstParagraph.evaluate((node) => {
        const content = node.querySelector('[data-blok-tool="paragraph"]');

        if (content) {
          content.innerHTML = '1<b></b>&nbsp;';;
        }
      });

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });

    test('should move caret over visible space and ignore trailing space before moving to next block', async ({ page }) => {
      await createParagraphBlok(page, ['1&nbsp; ', '2']);

      const firstParagraph = getParagraphByIndex(page, 0);
      const secondParagraph = getParagraphByIndex(page, 1);

      await firstParagraph.click();
      await firstParagraph.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');

      await waitForCaretInBlock(page, secondParagraph, 1);

      const caretInfo = await getCaretInfoOrThrow(secondParagraph);

      expect(caretInfo.inside).toBe(true);
    });
  });

  test('should move caret to next block if currently focused block is contentless', async ({ page }) => {
    await createBlokWithContentlessBlock(page);

    const firstParagraph = getParagraphByIndex(page, 0);
    const contentlessBlock = page.locator(BLOCK_SELECTOR, {
      has: page.locator(CONTENTLESS_TOOL_SELECTOR),
    });
    const lastParagraph = getParagraphByIndex(page, 1);

    await firstParagraph.click();
    await firstParagraph.press('End');
    await page.keyboard.press('ArrowRight');

    await expect(contentlessBlock).toHaveAttribute('data-blok-selected', 'true');

    await page.keyboard.press('ArrowRight');

    await expect(contentlessBlock).not.toHaveAttribute('data-blok-selected', 'true');

    await waitForCaretInBlock(page, lastParagraph, 2);

    const caretInfo = await getCaretInfoOrThrow(lastParagraph);

    expect(caretInfo.inside).toBe(true);
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
