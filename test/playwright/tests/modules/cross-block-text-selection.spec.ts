import type { Locator, Page } from '@playwright/test';

import type { Blok, OutputData } from '@/types';
import { BLOK_INTERFACE_SELECTOR, DATA_ATTR } from '../../../../src/components/constants';
import { ensureBlokBundleBuilt } from '../helpers/ensure-build';
import { expect, gotoTestPage, test } from '../helpers/shared-page';
import { dragBetweenCharacters, pointAtCharacter, readTextSelectionState, seamBetweenInputs } from '../helpers/text-drag';
import type { TextSelectionState } from '../helpers/text-drag';

const HOLDER_ID = 'blok';
const MODIFIER = process.platform === 'darwin' ? 'Meta' : 'Control';
const BLOCK_WRAPPER_SELECTOR = `${BLOK_INTERFACE_SELECTOR} [data-blok-testid="block-wrapper"]`;

type EnginePaintProbe = {
  samples: { spans: boolean }[];
  reset: () => void;
  hostOf: (node: Node | null) => Element | null;
};

declare global {
  interface Window {
    blokInstance?: Blok;
    enginePaintProbe?: EnginePaintProbe;
  }
}

/**
 * Records the document selection as the ENGINE leaves it, from a listener
 * registered before the editor's own so it sees the raw state rather than the
 * one the module has already put back. Deliberately built from nothing but DOM
 * APIs: it is the oracle the editor's paint decision is checked against, so
 * sharing production code would make the assertion circular.
 * @param page - the page to install the probe on
 */
const installEnginePaintProbe = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    if (window.enginePaintProbe !== undefined) {
      window.enginePaintProbe.reset();

      return;
    }

    const hostOf = (node: Node | null): Element | null => {
      if (node === null) {
        return null;
      }

      const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;

      return element?.closest('[contenteditable="true"]') ?? null;
    };

    const probe: EnginePaintProbe = {
      samples: [],
      reset: (): void => {
        probe.samples = [];
      },
      hostOf,
    };

    document.addEventListener('selectionchange', () => {
      const selection = document.getSelection();

      if (selection === null || selection.rangeCount === 0) {
        return;
      }

      const range = selection.getRangeAt(0);

      probe.samples.push({ spans: hostOf(range.startContainer) !== hostOf(range.endContainer) });
    });

    window.enginePaintProbe = probe;
  });
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

  test('crossing the seam between two blocks never flashes a whole-block share', async ({ page }) => {
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
      'Fourth block text',
    ]));

    /**
     * Pins every block boundary to a whole pixel. `MouseEvent.clientY` is an
     * integer, so the dead sliver between two hosts is only reachable by the
     * caret hit test when the boundary itself sits on one — on a fractionally
     * offset page the truncated y always lands inside a host and the sliver is
     * unreachable, which is what makes this bug look intermittent in the wild.
     */
    await page.evaluate((holder) => {
      const container = document.getElementById(holder);

      if (container !== null) {
        container.style.position = 'absolute';
        container.style.top = '100px';
        container.style.left = '40px';
        container.style.width = '600px';
      }
    }, HOLDER_ID);

    const start = await pointAtCharacter(editableByIndex(page, 0), 6);
    const overThird = await pointAtCharacter(editableByIndex(page, 2), 6);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(overThird.x, overThird.y, { steps: 8 });

    const seam = await seamBetweenInputs(editableByIndex(page, 2), editableByIndex(page, 3));
    const leaked: { y: number; blockTexts: string[] }[] = [];

    for (let y = seam.from; y <= seam.to; y += 0.25) {
      await page.mouse.move(overThird.x, y);

      const state = await readSelectionState(page);

      if (state.blockTexts.length > 3) {
        leaked.push({ y,
          blockTexts: state.blockTexts });
      }
    }

    await page.mouse.up();

    expect(leaked).toStrictEqual([]);
  });

  test('the selection paint is only taken over from engines that cannot paint the range', async ({ page }) => {
    await installEnginePaintProbe(page);
    await createBlokWithBlocks(page, createParagraphs([
      'First block text',
      'Second block text',
      'Third block text',
    ]));

    await page.evaluate(() => window.enginePaintProbe?.reset());

    const start = await pointAtCharacter(editableByIndex(page, 0), 6);
    const end = await pointAtCharacter(editableByIndex(page, 2), 6);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();

    const verdict = await page.evaluate((attribute) => {
      const selection = document.getSelection();
      const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const hostOf = window.enginePaintProbe?.hostOf ?? ((): Element | null => null);
      const samples = window.enginePaintProbe?.samples ?? [];
      const firstSpanning = samples.findIndex((sample) => sample.spans);

      return {
        spans: range !== null && hostOf(range.startContainer) !== hostOf(range.endContainer),
        /** WebKit reports both ends in the anchor host — and paints what it reports. */
        reportsOneHost: selection !== null && hostOf(selection.anchorNode) === hostOf(selection.focusNode),
        /** Firefox rewrites the range back to one host on every move of the drag. */
        engineRewrote: firstSpanning >= 0 && samples.slice(firstSpanning).some((sample) => !sample.spans),
        substituted: document.querySelector(`[${attribute}]`) !== null,
      };
    }, DATA_ATTR.crossSelection);

    expect(verdict.spans).toBe(true);

    /**
     * Substituting our own paint for the engine's is not free: an engine may
     * draw ::selection over the whole line box and a custom highlight over the
     * text box alone (Chromium does), so taking over where it was not needed
     * changes the height of the band the moment a drag leaves its first block.
     */
    expect(verdict.substituted).toBe(verdict.reportsOneHost || verdict.engineRewrote);
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
