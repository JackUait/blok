import type { Locator, Page } from '@playwright/test';

/**
 * Helpers for driving and reading CHARACTER-level drag selections.
 *
 * Element centres are not usable for these gestures: the centre of a glyph is
 * equidistant from the caret boundaries on either side of it, so which offset a
 * press resolves to varies by engine and the resulting assertions drift. Every
 * point here is taken a hair inside a character's LEFT edge, which pins the
 * boundary to that character's offset on all three engines.
 */

/** A point resolving to the caret boundary before a given character. */
export const pointAtCharacter = async (
  editable: Locator,
  charOffset: number
): Promise<{ x: number; y: number }> => {
  return editable.evaluate((input, offset) => {
    const walker = input.ownerDocument.createTreeWalker(input, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let remaining = offset;

    while (node !== null && remaining > (node.textContent?.length ?? 0)) {
      remaining -= node.textContent?.length ?? 0;
      node = walker.nextNode();
    }

    if (node === null) {
      throw new Error(`No text node at offset ${offset}`);
    }

    const range = input.ownerDocument.createRange();

    range.setStart(node, remaining);
    range.setEnd(node, Math.min(remaining + 1, node.textContent?.length ?? 0));

    const box = range.getBoundingClientRect();

    return {
      x: box.x + 1,
      y: box.y + box.height / 2,
    };
  }, charOffset);
};

/** Drag from one character boundary to another, across blocks if need be. */
export const dragBetweenCharacters = async (
  page: Page,
  from: { editable: Locator; offset: number },
  to: { editable: Locator; offset: number }
): Promise<void> => {
  const start = await pointAtCharacter(from.editable, from.offset);
  const end = await pointAtCharacter(to.editable, to.offset);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 12, start.y, { steps: 2 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
};

/** What the document selection covers, per block, plus the block-selection count. */
export type TextSelectionState = {
  rangeCount: number;
  collapsed: boolean;
  startBlock: number;
  endBlock: number;
  blockTexts: string[];
  selectedBlockCount: number;
};

/**
 * Read the selection as per-block slices.
 *
 * Deliberately built from the RANGE, never from `Selection.anchorNode` /
 * `focusNode`: WebKit clamps those getters to the anchor's editing host, so a
 * cross-block selection would read as single-block there.
 * @param page - the page to read from
 * @param blockSelector - selector matching every block wrapper
 */
export const readTextSelectionState = async (
  page: Page,
  blockSelector: string
): Promise<TextSelectionState> => {
  return page.evaluate((selector) => {
    const wrappers = Array.from(document.querySelectorAll(selector));
    const selection = document.getSelection();
    const selectedBlockCount = wrappers.filter(
      (wrapper) => wrapper.getAttribute('data-blok-selected') === 'true'
    ).length;

    if (!selection || selection.rangeCount === 0) {
      return {
        rangeCount: 0,
        collapsed: true,
        startBlock: -1,
        endBlock: -1,
        blockTexts: [],
        selectedBlockCount,
      };
    }

    const range = selection.getRangeAt(0);
    const blockIndexOf = (node: Node): number => {
      const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
      const wrapper = element?.closest(selector);

      return wrapper ? wrappers.indexOf(wrapper) : -1;
    };

    /**
     * Driven from the editing HOSTS, not from wrapper → first editable: a
     * container block's wrapper contains its children's editables, so that
     * direction reports a child's text once for the child and again for every
     * container above it.
     */
    const hosts = Array.from(document.querySelectorAll('[contenteditable="true"]'));

    const blockTexts = hosts.reduce<string[]>((accumulator, input) => {
      if (!range.intersectsNode(input)) {
        return accumulator;
      }

      const sub = document.createRange();

      sub.selectNodeContents(input);

      if (range.compareBoundaryPoints(Range.START_TO_START, sub) > 0) {
        sub.setStart(range.startContainer, range.startOffset);
      }
      if (range.compareBoundaryPoints(Range.END_TO_END, sub) < 0) {
        sub.setEnd(range.endContainer, range.endOffset);
      }

      const text = sub.toString();

      return text.length > 0 ? [...accumulator, text] : accumulator;
    }, []);

    return {
      rangeCount: selection.rangeCount,
      collapsed: range.collapsed,
      startBlock: blockIndexOf(range.startContainer),
      endBlock: blockIndexOf(range.endContainer),
      blockTexts,
      selectedBlockCount,
    };
  }, blockSelector);
};

/**
 * The band of y values straddling the boundary between two stacked editing
 * hosts, padded on both sides.
 *
 * Neither host owns every pixel of that boundary: sub-pixel layout leaves a
 * sliver where the caret hit test finds no character, and the drag has to
 * resolve a focus from geometry alone. Fuzzing across the whole band is the
 * only way to catch a focus that jumps to the wrong edge, because which
 * fractional y lands in the sliver depends on the layout.
 * @param above - the editing host on top
 * @param below - the editing host underneath
 */
export const seamBetweenInputs = async (
  above: Locator,
  below: Locator
): Promise<{ from: number; to: number }> => {
  const from = await above.evaluate((element) => element.getBoundingClientRect().bottom);
  const to = await below.evaluate((element) => element.getBoundingClientRect().top);

  return { from: from - 2,
    to: to + 2 };
};
