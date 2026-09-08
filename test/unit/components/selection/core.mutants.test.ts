import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionCore } from '../../../../src/components/selection/core';
import * as utils from '../../../../src/components/utils';

/**
 * Mutation-hunting companion to core.test.ts.
 *
 * Two mutants of core.ts are PROVEN EQUIVALENT and have no test here:
 *
 * - core.ts@72:22-72:61 ConditionalExpression: true
 * - core.ts@101:22-101:61 ConditionalExpression: true
 *
 * Both replace `blokZone.nodeType === Node.ELEMENT_NODE` with `true` in
 * `return blokZone ? blokZone.nodeType === Node.ELEMENT_NODE : false;`.
 * `blokZone` is the return value of `Element.prototype.closest`, typed in
 * lib.dom as `closest<E extends Element>(selectors: string): E | null` — the
 * only non-null value it can produce is an Element, and every Element has
 * `nodeType === 1 === Node.ELEMENT_NODE` by definition. So whenever the
 * ternary test is truthy the consequent is already `true`, and no DOM input
 * separates the mutant from the original. The only way to "kill" it would be
 * to plant a fake `closest` on the anchor node that returns a non-element,
 * which asserts a fiction the DOM cannot produce.
 */

const ensureSelection = (): Selection => {
  const selection = window.getSelection();

  if (!selection) {
    throw new Error('jsdom did not provide a Selection object');
  }

  return selection;
};

/**
 * jsdom hands out one Selection instance per window, so shadowing a property
 * on it is what `SelectionCore` reads back through `window.getSelection()`.
 */
const overrideSelectionProperty = (
  selection: Selection,
  key: 'anchorNode' | 'focusNode' | 'rangeCount',
  value: Node | number | null
): void => {
  Object.defineProperty(selection, key, {
    value,
    configurable: true,
  });
};

const clearSelectionOverrides = (): void => {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  for (const key of ['anchorNode', 'focusNode', 'rangeCount'] as const) {
    Reflect.deleteProperty(selection, key);
  }

  selection.removeAllRanges();
};

/**
 * Reads every coordinate of the produced rect. Several getRect mutants return
 * a *different* rect that still matches on one axis, so a single-field
 * assertion would let them through.
 */
const rectFields = (rect: DOMRect): { x: number; y: number; width: number; height: number } => ({
  x: rect.x,
  y: rect.y,
  width: rect.width,
  height: rect.height,
});

/**
 * Builds `<div contenteditable>Hello world</div>` and selects "llo" — an
 * offset in the MIDDLE of the text node, so the temporary span splits it and
 * the `normalize()` call has something to glue back together.
 */
const selectMiddleOfText = (): { element: HTMLDivElement; textNode: Text } => {
  const element = document.createElement('div');

  element.contentEditable = 'true';
  element.textContent = 'Hello world';
  document.body.appendChild(element);

  const textNode = element.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Failed to create the text node');
  }

  const selection = ensureSelection();
  const range = document.createRange();

  range.setStart(textNode, 2);
  range.setEnd(textNode, 5);
  selection.removeAllRanges();
  selection.addRange(range);

  return { element, textNode };
};

/**
 * `<div>` wrapper that is NOT a Blok zone, holding the redactor element and a
 * paragraph. The wrapper is the discriminator: a mutant that walks one node up
 * from the redactor lands outside every Blok zone.
 */
const createBlokZone = (): {
  wrapper: HTMLDivElement;
  zone: HTMLDivElement;
  paragraph: HTMLParagraphElement;
  textNode: Text;
} => {
  const wrapper = document.createElement('div');
  const zone = document.createElement('div');
  const paragraph = document.createElement('p');

  zone.setAttribute('data-blok-redactor', '');
  paragraph.textContent = 'Hello world';

  zone.appendChild(paragraph);
  wrapper.appendChild(zone);
  document.body.appendChild(wrapper);

  const textNode = paragraph.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Failed to create the text node inside the Blok zone');
  }

  return { wrapper, zone, paragraph, textNode };
};

describe('SelectionCore — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSelectionOverrides();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearSelectionOverrides();
    document.body.innerHTML = '';
  });

  describe('when window.getSelection() returns null', () => {
    it('getAnchorElement returns null instead of reading the missing selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(SelectionCore.getAnchorElement()).toBeNull();
    });

    it('getIsSelectionExists returns false instead of reading the missing selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(SelectionCore.getIsSelectionExists()).toBe(false);
    });

    it('getText returns an empty string instead of reading the missing selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(SelectionCore.getText()).toBe('');
    });
  });

  describe('isSelectionAtBlok', () => {
    it('falls back to focusNode when anchorNode is absent', () => {
      const { textNode } = createBlokZone();
      const selection = ensureSelection();

      overrideSelectionProperty(selection, 'anchorNode', null);
      overrideSelectionProperty(selection, 'focusNode', textNode);

      expect(SelectionCore.isSelectionAtBlok(selection)).toBe(true);
    });

    it('accepts the redactor element itself as the anchor, without walking up to its parent', () => {
      const { wrapper, zone } = createBlokZone();
      const selection = ensureSelection();

      overrideSelectionProperty(selection, 'anchorNode', zone);
      overrideSelectionProperty(selection, 'focusNode', zone);

      expect(SelectionCore.isSelectionAtBlok(selection)).toBe(true);
      // The parent of the zone is outside every Blok zone, so a parent walk answers false.
      expect(wrapper.closest('[data-blok-redactor]')).toBeNull();
    });

    it('returns false when neither anchorNode nor focusNode exists', () => {
      const selection = ensureSelection();

      overrideSelectionProperty(selection, 'anchorNode', null);
      overrideSelectionProperty(selection, 'focusNode', null);

      expect(SelectionCore.isSelectionAtBlok(selection)).toBe(false);
    });

    it('returns false when the anchor is neither a text node nor an element', () => {
      const comment = document.createComment('anchor');

      document.body.appendChild(comment);

      const selection = ensureSelection();

      overrideSelectionProperty(selection, 'anchorNode', comment);
      overrideSelectionProperty(selection, 'focusNode', comment);

      // A Comment has no closest(), so anything that calls it here throws.
      expect(comment.nodeType).toBe(Node.COMMENT_NODE);
      expect(SelectionCore.isSelectionAtBlok(selection)).toBe(false);
    });
  });

  describe('isRangeAtBlok', () => {
    it('accepts a range that starts on the redactor element itself', () => {
      const { wrapper, zone } = createBlokZone();
      const range = document.createRange();

      range.setStart(zone, 0);
      range.setEnd(zone, zone.childNodes.length);

      expect(SelectionCore.isRangeAtBlok(range)).toBe(true);
      expect(wrapper.closest('[data-blok-redactor]')).toBeNull();
    });

    it('returns false when the range starts on a node that has no closest()', () => {
      const range = document.createRange();

      range.setStart(document, 0);

      expect(range.startContainer.nodeType).toBe(Node.DOCUMENT_NODE);
      expect(SelectionCore.isRangeAtBlok(range)).toBe(false);
    });
  });

  describe('getRect', () => {
    it('warns and returns a zero rect when window.getSelection() is null', () => {
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(rectFields(SelectionCore.getRect())).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('Method window.getSelection returned null', 'warn');
    });

    it('warns and returns a zero rect when rangeCount is NaN', () => {
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(11, 22, 33, 44));

      selectMiddleOfText();

      const selection = ensureSelection();

      overrideSelectionProperty(selection, 'rangeCount', Number.NaN);

      expect(rectFields(SelectionCore.getRect())).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('Method SelectionUtils.rangeCount is not supported', 'warn');
    });

    it('warns and returns a zero rect when rangeCount is null', () => {
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(11, 22, 33, 44));

      selectMiddleOfText();

      const selection = ensureSelection();

      overrideSelectionProperty(selection, 'rangeCount', null);

      // Number.isNaN(null) is false, so only the `=== null` half of the guard can catch this.
      expect(Number.isNaN(selection.rangeCount)).toBe(false);
      expect(rectFields(SelectionCore.getRect())).toEqual({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('Method SelectionUtils.rangeCount is not supported', 'warn');
    });

    it('returns the range rect untouched when it is away from the origin', () => {
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);
      const insertNodeSpy = vi.spyOn(Range.prototype, 'insertNode');

      vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(11, 22, 33, 44));
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(5, 6, 7, 8));

      selectMiddleOfText();

      expect(rectFields(SelectionCore.getRect())).toEqual({
        x: 11,
        y: 22,
        width: 33,
        height: 44,
      });
      expect(insertNodeSpy).not.toHaveBeenCalled();
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('keeps the range rect when only x sits at the origin', () => {
      const insertNodeSpy = vi.spyOn(Range.prototype, 'insertNode');

      vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 22, 33, 44));
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(5, 6, 7, 8));

      selectMiddleOfText();

      expect(rectFields(SelectionCore.getRect())).toEqual({
        x: 0,
        y: 22,
        width: 33,
        height: 44,
      });
      expect(insertNodeSpy).not.toHaveBeenCalled();
    });

    it('keeps the range rect when only y sits at the origin', () => {
      const insertNodeSpy = vi.spyOn(Range.prototype, 'insertNode');

      vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(11, 0, 33, 44));
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(5, 6, 7, 8));

      selectMiddleOfText();

      expect(rectFields(SelectionCore.getRect())).toEqual({
        x: 11,
        y: 0,
        width: 33,
        height: 44,
      });
      expect(insertNodeSpy).not.toHaveBeenCalled();
    });

    it('measures a zero-width span inserted into the range when the rect sits at the origin', () => {
      const insertNodeSpy = vi.spyOn(Range.prototype, 'insertNode');

      vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(5, 6, 7, 8));

      const { element } = selectMiddleOfText();

      expect(rectFields(SelectionCore.getRect())).toEqual({
        x: 5,
        y: 6,
        width: 7,
        height: 8,
      });

      // Only this spy separates "span was inserted" from "span was measured detached".
      expect(insertNodeSpy).toHaveBeenCalledTimes(1);

      const inserted = insertNodeSpy.mock.calls[0]?.[0];

      expect(inserted).toBeInstanceOf(HTMLSpanElement);
      expect(inserted?.textContent).toBe('\u200b');

      // The span is taken back out and the split text node is glued together again.
      expect(document.body.querySelector('span')).toBeNull();
      expect(element.childNodes.length).toBe(1);
      expect(element.textContent).toBe('Hello world');
    });

    it('measures the span without throwing when it never got a parent', () => {
      const insertNodeSpy = vi.spyOn(Range.prototype, 'insertNode').mockImplementation(() => undefined);

      vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(5, 6, 7, 8));

      const { element } = selectMiddleOfText();

      expect(rectFields(SelectionCore.getRect())).toEqual({
        x: 5,
        y: 6,
        width: 7,
        height: 8,
      });
      expect(insertNodeSpy).toHaveBeenCalledTimes(1);
      expect(element.childNodes.length).toBe(1);
    });
  });
});
