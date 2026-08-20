import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { dragBetweenCharacters, readTextSelectionState } from '../helpers/text-drag';
import type { TextSelectionState } from '../helpers/text-drag';

const HOLDER_ID = 'blok';
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;

declare global {
  interface Window {
    blokInstance?: Blok;
  }
}

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

    document.body.appendChild(container);
  }, { holder: HOLDER_ID });
};

const createBlokWithBlocks = async (page: Page, blocks: OutputData['blocks']): Promise<void> => {
  await resetBlok(page);
  await page.evaluate(async ({ holder, blocks: blokBlocks }) => {
    const blok = new window.Blok({
      holder,
      data: { blocks: blokBlocks },
    });

    window.blokInstance = blok;
    await blok.isReady;
  }, {
    holder: HOLDER_ID,
    blocks,
  });
};

const createParagraphs = (texts: string[]): OutputData['blocks'] => {
  return texts.map((text) => ({
    type: 'paragraph',
    data: { text },
  }));
};

const editableByIndex = (page: Page, index: number): Locator => {
  return page.locator(`:nth-match(${BLOCK_WRAPPER_SELECTOR} [contenteditable="true"], ${index + 1})`);
};

const readSelectionState = async (page: Page): Promise<TextSelectionState> => {
  return readTextSelectionState(page, BLOCK_WRAPPER_SELECTOR);
};

const saveTexts = async (page: Page): Promise<string[]> => {
  const saved = await page.evaluate<OutputData>(async () => {
    const blok = window.blokInstance;

    if (!blok) {
      throw new Error('Blok instance is not ready');
    }

    return blok.save();
  });

  return saved.blocks.map((block) => (block.data as { text?: string }).text ?? '');
};

const clipboardFromEvent = async (
  locator: Locator,
  eventName: 'copy' | 'cut'
): Promise<Record<string, string>> => {
  return locator.evaluate((element, type) => {
    return new Promise<Record<string, string>>((resolve) => {
      const store: Record<string, string> = {};
      const dataTransfer = new DataTransfer();
      const originalSetData = dataTransfer.setData.bind(dataTransfer);

      dataTransfer.setData = (format: string, data: string): void => {
        store[format] = data;
        originalSetData(format, data);
      };

      const event = new ClipboardEvent(type, {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      });

      if (event.clipboardData !== dataTransfer) {
        Object.defineProperty(event, 'clipboardData', {
          value: dataTransfer,
          writable: false,
          configurable: true,
        });
      }

      element.dispatchEvent(event);

      setTimeout(() => resolve(store), 50);
    });
  }, eventName);
};

const pasteInto = async (locator: Locator, data: Record<string, string>): Promise<void> => {
  await locator.evaluate((element: HTMLElement, pasteData: Record<string, string>) => {
    const pasteEvent = Object.assign(new Event('paste', {
      bubbles: true,
      cancelable: true,
    }), {
      clipboardData: {
        getData: (type: string): string => pasteData[type] ?? '',
        types: Object.keys(pasteData),
      },
    });

    element.dispatchEvent(pasteEvent);
  }, data);
};

test.describe('cross-block text selection', () => {
  test.beforeAll(() => {
    ensureBlokBundleBuilt();
  });

  test.beforeEach(async ({ page }) => {
    await gotoTestPage(page);
  });

  test('dragging across blocks keeps the character range instead of selecting whole blocks', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
    ]));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 2),
        offset: 6 }
    );

    const state = await readSelectionState(page);

    expect(state.selectedBlockCount).toBe(0);
    expect(state.rangeCount).toBe(1);
    expect(state.collapsed).toBe(false);
    expect(state.startBlock).toBe(0);
    expect(state.endBlock).toBe(2);
    expect(state.blockTexts).toStrictEqual(['block text', 'Second block text', 'Third ']);
  });

  test('the multi-block toolbar does not open for a cross-block text selection', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
    ]));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 1),
        offset: 6 }
    );

    await expect(page.locator(`${BLOCK_WRAPPER_SELECTOR}[data-blok-selected="true"]`)).toHaveCount(0);
  });

  test('Escape promotes the text selection to a selection of the same blocks', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
    ]));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 1),
        offset: 6 }
    );

    // One Escape dismisses exactly one layer: the formatting toolbar the
    // selection opened goes first, the selection itself second.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await expect(page.locator(`${BLOCK_WRAPPER_SELECTOR}[data-blok-selected="true"]`)).toHaveCount(2);

    const state = await readSelectionState(page);

    expect(state.blockTexts).toStrictEqual([]);
  });

  test('copy serializes exactly the selected characters', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
    ]));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 2),
        offset: 6 }
    );

    const clipboard = await clipboardFromEvent(page.locator(BLOCK_WRAPPER_SELECTOR).first(), 'copy');

    expect(clipboard['text/plain']).toBe('block text\n\nSecond block text\n\nThird ');
  });

  test('Backspace replaces exactly the selected range and merges the endpoints', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
    ]));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 2),
        offset: 6 }
    );

    await page.keyboard.press('Backspace');

    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
    expect(await saveTexts(page)).toStrictEqual(['First block text']);
  });

  test('inline formatting applies to exactly the selected characters in every block', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
    ]));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 2),
        offset: 6 }
    );

    await page.keyboard.press(`${MODIFIER}+b`);

    const saved = await page.evaluate<OutputData>(async () => {
      const blok = window.blokInstance;

      if (!blok) {
        throw new Error('Blok instance is not ready');
      }

      return blok.save();
    });

    expect(saved.blocks.map((block) => (block.data as { text?: string }).text)).toStrictEqual([
      'First <strong>block text</strong>',
      '<strong>Second block text</strong>',
      '<strong>Third </strong>block text',
    ]);
  });

  /**
   * The replacement is several Yjs writes (two truncations, the middle-block
   * removals, the merge). They must land inside one capture window, or a single
   * Cmd+Z would leave the document half-deleted.
   */
  test('the whole replacement undoes in one step', async ({ page }) => {
    const texts = [ 'First block text', 'Second block text', 'Third block text' ];

    await createBlokWithBlocks(page, createParagraphs(texts));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 2),
        offset: 6 }
    );

    await page.keyboard.press('Backspace');
    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);

    await page.keyboard.press(`${MODIFIER}+z`);

    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(3);
    expect(await saveTexts(page)).toStrictEqual(texts);
  });

  test('cut copies the selected characters and removes them', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
    ]));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 2),
        offset: 6 }
    );

    const clipboard = await clipboardFromEvent(page.locator(BLOCK_WRAPPER_SELECTOR).first(), 'cut');

    expect(clipboard['text/plain']).toBe('block text\n\nSecond block text\n\nThird ');

    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
    expect(await saveTexts(page)).toStrictEqual([ 'First block text' ]);
  });

  test('pasting replaces exactly the selected range', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
    ]));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 2),
        offset: 6 }
    );

    await pasteInto(editableByIndex(page, 0), { 'text/plain': 'PASTED' });

    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
    expect(await saveTexts(page)).toStrictEqual([ 'First PASTEDblock text' ]);
  });

  test('typing replaces exactly the selected range', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
    ]));

    await dragBetweenCharacters(
      page,
      { editable: editableByIndex(page, 0),
        offset: 6 },
      { editable: editableByIndex(page, 2),
        offset: 6 }
    );

    await page.keyboard.type('X');

    await expect(page.locator(BLOCK_WRAPPER_SELECTOR)).toHaveCount(1);
    expect(await saveTexts(page)).toStrictEqual(['First Xblock text']);
  });
});
