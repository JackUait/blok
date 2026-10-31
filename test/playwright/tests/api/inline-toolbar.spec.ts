import type { Locator, Page } from '@playwright/test';
import type { Blok } from '@/types';
import type { OutputData } from '@/types';
import {
  BLOK_INTERFACE_SELECTOR,
  INLINE_TOOLBAR_INTERFACE_SELECTOR,
  selectionChangeDebounceTimeout
} from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';

const HOLDER_ID = 'blok';
const PARAGRAPH_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"][data-blok-component="paragraph"]`;
const INLINE_TOOLBAR_CONTAINER_SELECTOR = `${INLINE_TOOLBAR_INTERFACE_SELECTOR} [data-blok-testid="popover-container"]`;

const INITIAL_DATA: OutputData = {
  blocks: [
    {
      type: 'paragraph',
      data: {
        text: 'Inline toolbar API end-to-end coverage text.',
      },
    },
  ],
};

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

const createBlok = async (page: Page, data: OutputData): Promise<void> => {
  await resetBlok(page);

  await page.evaluate(
    async ({ holder, blokData }) => {
      const blok = new window.Blok({
        holder: holder,
        data: blokData,
      });

      window.blokInstance = blok;
      await blok.isReady;
    },
    {
      holder: HOLDER_ID,
      blokData: data,
    }
  );
};

const setSelectionRange = async (locator: Locator, start: number, end: number): Promise<void> => {
  if (start < 0 || end < start) {
    throw new Error(`Invalid selection offsets: start (${start}) must be >= 0 and end (${end}) must be >= start.`);
  }

  await locator.scrollIntoViewIfNeeded();
  await locator.focus();

  await locator.evaluate(
    (element, { start: selectionStart, end: selectionEnd }) => {
      const ownerDocument = element.ownerDocument;

      if (!ownerDocument) {
        return;
      }

      const selection = ownerDocument.getSelection();

      if (!selection) {
        return;
      }

      const textNodes: Text[] = [];
      const walker = ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);

      let currentNode = walker.nextNode();

      while (currentNode) {
        textNodes.push(currentNode as Text);
        currentNode = walker.nextNode();
      }

      if (textNodes.length === 0) {
        return;
      }

      const findPosition = (offset: number): { node: Text; nodeOffset: number } | null => {
        let accumulated = 0;

        for (const node of textNodes) {
          const length = node.textContent?.length ?? 0;
          const nodeStart = accumulated;
          const nodeEnd = accumulated + length;

          if (offset >= nodeStart && offset <= nodeEnd) {
            return {
              node,
              nodeOffset: Math.min(length, offset - nodeStart),
            };
          }

          accumulated = nodeEnd;
        }

        if (offset === 0) {
          const firstNode = textNodes[0];

          return {
            node: firstNode,
            nodeOffset: 0,
          };
        }

        return null;
      };

      const startPosition = findPosition(selectionStart);
      const endPosition = findPosition(selectionEnd);

      if (!startPosition || !endPosition) {
        return;
      }

      const range = ownerDocument.createRange();

      range.setStart(startPosition.node, startPosition.nodeOffset);
      range.setEnd(endPosition.node, endPosition.nodeOffset);

      selection.removeAllRanges();
      selection.addRange(range);
      ownerDocument.dispatchEvent(new Event('selectionchange'));
    },
    { start,
      end }
  );
};

const selectText = async (locator: Locator, text: string): Promise<void> => {
  const fullText = await locator.textContent();

  if (!fullText || !fullText.includes(text)) {
    throw new Error(`Text "${text}" was not found in element`);
  }

  const startIndex = fullText.indexOf(text);
  const endIndex = startIndex + text.length;

  await setSelectionRange(locator, startIndex, endIndex);
};

test.describe('api.inlineToolbar', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('inlineToolbar.open() shows the inline toolbar when selection exists', async ({ page }) => {
    await createBlok(page, INITIAL_DATA);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);

    await selectText(paragraph, 'Inline toolbar');

    await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      window.blokInstance.inlineToolbar.open();
    });

    await expect(page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR)).toBeVisible();
  });

  test('inlineToolbar.close() hides the inline toolbar', async ({ page }) => {
    await createBlok(page, INITIAL_DATA);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);
    const toolbarContainer = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await selectText(paragraph, 'Inline toolbar');

    await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      window.blokInstance.inlineToolbar.open();
    });

    await expect(toolbarContainer).toBeVisible();

    await page.evaluate(() => {
      if (!window.blokInstance) {
        throw new Error('Blok instance not found');
      }

      window.blokInstance.inlineToolbar.close();
    });

    await expect(toolbarContainer).toHaveCount(0);
  });

  test('inlineToolbar.close() keeps the toolbar closed after the selectionchange debounce fires', async ({ page }) => {
    await createBlok(page, INITIAL_DATA);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);
    await selectText(paragraph, 'Inline toolbar');

    // One page task, so close() lands before the debounce of the selection above.
    const shown = await page.evaluate(async ({ selector, debounce }) => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      blok.inlineToolbar.open();

      for (let i = 0; i < 100 && document.querySelector(selector) === null; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const beforeClose = document.querySelector(selector) !== null;

      blok.inlineToolbar.close();
      await new Promise((resolve) => setTimeout(resolve, debounce * 2));

      return { beforeClose, afterDebounce: document.querySelector(selector) !== null };
    }, { selector: INLINE_TOOLBAR_CONTAINER_SELECTOR, debounce: selectionChangeDebounceTimeout });

    expect(shown).toEqual({ beforeClose: true, afterDebounce: false });
  });

  test('inlineToolbar.close() wins over an open() still in flight', async ({ page }) => {
    await createBlok(page, INITIAL_DATA);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);

    await expect(paragraph).toHaveCount(1);
    await selectText(paragraph, 'Inline toolbar');

    const shownAfterDebounce = await page.evaluate(async ({ selector, debounce }) => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance not found');
      }

      blok.inlineToolbar.open();
      blok.inlineToolbar.close();
      await new Promise((resolve) => setTimeout(resolve, debounce * 2));

      return document.querySelector(selector) !== null;
    }, { selector: INLINE_TOOLBAR_CONTAINER_SELECTOR, debounce: selectionChangeDebounceTimeout });

    expect(shownAfterDebounce).toBe(false);
  });

  test('inlineToolbar.open() shows the toolbar again after close() on the same selection', async ({ page }) => {
    await createBlok(page, INITIAL_DATA);

    const paragraph = page.locator(PARAGRAPH_SELECTOR);
    const toolbarContainer = page.locator(INLINE_TOOLBAR_CONTAINER_SELECTOR);

    await expect(paragraph).toHaveCount(1);
    await selectText(paragraph, 'Inline toolbar');

    await page.evaluate(() => window.blokInstance?.inlineToolbar.open());
    await expect(toolbarContainer).toBeVisible();

    await page.evaluate(() => window.blokInstance?.inlineToolbar.close());
    await expect(toolbarContainer).toHaveCount(0);

    await page.evaluate(() => window.blokInstance?.inlineToolbar.open());
    await expect(toolbarContainer).toBeVisible();
  });
});

declare global {
  interface Window {
    blokInstance?: Blok;
    Blok: new (...args: unknown[]) => Blok;
  }
}
