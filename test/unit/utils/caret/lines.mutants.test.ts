import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import {
  getValidCaretRect,
  isCaretAtFirstLine,
  isCaretAtLastLine,
} from '../../../../src/components/utils/caret/lines';

interface RectSpec {
  top: number;
  height: number;
}

interface RangeStub {
  container: Node;
  offset: number;
  rect: RectSpec;
}

interface ElementStub {
  element: Element;
  rect: RectSpec;
}

const ZERO: RectSpec = { top: 0, height: 0 };

const rectOf = ({ top, height }: RectSpec): DOMRect => new DOMRect(0, top, 100, height);

/**
 * Gives every collapsed range and element a rect of its own.
 *
 * jsdom lays nothing out, so all four geometry branches read (0, 0) and none of
 * them can be told apart. Keying on the boundary point is what makes "which range
 * did it measure" observable — dropping `setStart` leaves the range on `document`
 * and lands on the fallback rect.
 */
const stubGeometry = (ranges: RangeStub[], elements: ElementStub[], fallback: RectSpec = ZERO): void => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function boundingRect(this: Range) {
    const hit = ranges.find((stub) => (
      stub.container === this.startContainer
      && stub.offset === this.startOffset
      && this.endContainer === this.startContainer
      && this.endOffset === this.startOffset
    ));

    return rectOf(hit?.rect ?? fallback);
  });

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function boundingRect(this: Element) {
    const hit = elements.find((stub) => stub.element === this);

    return rectOf(hit?.rect ?? fallback);
  });
};

interface Editable {
  input: HTMLElement;
  firstText: Node;
  lastText: Node;
}

const makeEditable = (): Editable => {
  const input = document.createElement('div');

  input.contentEditable = 'true';
  input.innerHTML = '<div>AAA</div><div>BBB</div>';
  document.body.appendChild(input);

  const firstText = input.children[0].firstChild;
  const lastText = input.children[1].firstChild;

  if (firstText === null || lastText === null) {
    throw new Error('fixture has no text nodes');
  }

  return { input, firstText, lastText };
};

const placeCaret = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

describe('caret/lines mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  describe('getValidCaretRect', () => {
    const setup = (caret: RectSpec, container: RectSpec, inputRect: RectSpec) => {
      const input = document.createElement('div');
      const holder = document.createElement('span');

      holder.textContent = 'AAA';
      input.appendChild(holder);
      document.body.appendChild(input);

      const text = holder.firstChild;

      if (text === null) {
        throw new Error('fixture has no text node');
      }

      const range = document.createRange();

      range.setStart(text, 1);
      range.collapse(true);

      stubGeometry(
        [{ container: text, offset: 1, rect: caret }],
        [{ element: holder, rect: container }, { element: input, rect: inputRect }],
      );

      return { range, input, holder };
    };

    it('keeps a caret rect that has height', () => {
      const { range, input } = setup({ top: 0, height: 12 }, { top: 40, height: 20 }, { top: 90, height: 20 });

      expect(getValidCaretRect(range, input).height).toBe(12);
    });

    it('keeps a caret rect that has a top even with no height', () => {
      const { range, input } = setup({ top: 7, height: 0 }, { top: 40, height: 20 }, { top: 90, height: 20 });

      expect(getValidCaretRect(range, input).top).toBe(7);
    });

    it('falls back to the containing element when the caret rect is empty', () => {
      const { range, input } = setup(ZERO, { top: 40, height: 20 }, { top: 90, height: 20 });

      expect(getValidCaretRect(range, input).top).toBe(40);
    });

    it('accepts a container rect that has height but no top', () => {
      const { range, input } = setup(ZERO, { top: 0, height: 20 }, { top: 90, height: 20 });

      expect(getValidCaretRect(range, input).height).toBe(20);
    });

    it('accepts a container rect that has a top but no height', () => {
      const { range, input } = setup(ZERO, { top: 40, height: 0 }, { top: 90, height: 20 });

      expect(getValidCaretRect(range, input).top).toBe(40);
    });

    it('falls back to the input when the containing element is empty too', () => {
      const { range, input } = setup(ZERO, ZERO, { top: 90, height: 20 });

      expect(getValidCaretRect(range, input).top).toBe(90);
    });

    it('measures the element itself when the range starts on an element', () => {
      const input = document.createElement('div');
      const holder = document.createElement('span');

      holder.textContent = 'AAA';
      input.appendChild(holder);
      document.body.appendChild(input);

      const range = document.createRange();

      range.setStart(holder, 0);
      range.collapse(true);

      stubGeometry(
        [],
        [{ element: holder, rect: { top: 40, height: 20 } }, { element: input, rect: { top: 90, height: 20 } }],
      );

      expect(getValidCaretRect(range, input).top).toBe(40);
    });

    it('falls back to the input for a detached text node', () => {
      const input = document.createElement('div');

      document.body.appendChild(input);

      const orphan = document.createTextNode('AAA');
      const range = document.createRange();

      range.setStart(orphan, 1);
      range.collapse(true);

      stubGeometry([], [{ element: input, rect: { top: 90, height: 20 } }]);

      expect(orphan.parentElement).toBeNull();
      expect(getValidCaretRect(range, input).top).toBe(90);
    });
  });

  describe('isCaretAtFirstLine', () => {
    it('answers for a single-line input without reading its value', () => {
      const input = document.createElement('input');
      const readValue = vi.fn(() => 'a\nb');

      Object.defineProperty(input, 'value', { get: readValue, configurable: true });
      Object.defineProperty(input, 'selectionStart', { get: () => 3, configurable: true });

      const atFirst = isCaretAtFirstLine(input);

      expect(readValue).not.toHaveBeenCalled();
      expect(atFirst).toBe(true);
    });

    it('is false when the caret sits well below the first line', () => {
      const { input, firstText, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [
          { container: lastText, offset: 1, rect: { top: 40, height: 20 } },
          { container: firstText, offset: 0, rect: { top: 0, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtFirstLine(input)).toBe(false);
    });

    it('is true when the caret sits on the first line', () => {
      const { input, firstText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [
          { container: firstText, offset: 1, rect: { top: 0, height: 20 } },
          { container: firstText, offset: 0, rect: { top: 0, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtFirstLine(input)).toBe(true);
    });

    it('is true when the caret and the first line share a non-zero top', () => {
      const { input, firstText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [
          { container: firstText, offset: 1, rect: { top: 40, height: 20 } },
          { container: firstText, offset: 0, rect: { top: 40, height: 20 } },
        ],
        [{ element: input, rect: { top: 40, height: 60 } }],
      );

      expect(isCaretAtFirstLine(input)).toBe(true);
    });

    it('is false when the gap is exactly the tolerance', () => {
      const { input, firstText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [
          { container: firstText, offset: 1, rect: { top: 5, height: 20 } },
          { container: firstText, offset: 0, rect: { top: 0, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtFirstLine(input)).toBe(false);
    });

    it('measures the first deepest node, not the last', () => {
      const { input, firstText, lastText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [
          { container: firstText, offset: 1, rect: { top: 0, height: 20 } },
          { container: firstText, offset: 0, rect: { top: 0, height: 20 } },
          { container: lastText, offset: 0, rect: { top: 40, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtFirstLine(input)).toBe(true);
    });

    it('falls back to a line height from the input top when the first line has no rect', () => {
      const { input, firstText, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [{ container: lastText, offset: 1, rect: { top: 10, height: 20 } }],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(firstText).toBeDefined();
      expect(isCaretAtFirstLine(input)).toBe(true);
    });

    it('compares against the first line when it has height at the top of the screen', () => {
      const { input, firstText, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [
          { container: lastText, offset: 1, rect: { top: 10, height: 20 } },
          { container: firstText, offset: 0, rect: { top: 0, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtFirstLine(input)).toBe(false);
    });

    it('compares against the first line when it has a top but no height', () => {
      const { input, firstText, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [
          { container: lastText, offset: 1, rect: { top: 10, height: 20 } },
          { container: firstText, offset: 0, rect: { top: 30, height: 0 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtFirstLine(input)).toBe(false);
    });

    it('treats a caret exactly one line below the input top as past the first line', () => {
      const { input, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [{ container: lastText, offset: 1, rect: { top: 20, height: 20 } }],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtFirstLine(input)).toBe(false);
    });

    it('measures the fallback band down from the input top', () => {
      const { input, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [{ container: lastText, offset: 1, rect: { top: 105, height: 20 } }],
        [{ element: input, rect: { top: 100, height: 60 } }],
      );

      expect(isCaretAtFirstLine(input)).toBe(true);
    });

    it('reports the first line when the boundary range cannot be built', () => {
      const { input, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [{ container: lastText, offset: 1, rect: { top: 100, height: 20 } }],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      const broken = document.createRange();

      vi.spyOn(broken, 'setStart').mockImplementation(() => {
        throw new Error('cannot set start');
      });
      vi.spyOn(document, 'createRange').mockReturnValueOnce(broken);

      expect(isCaretAtFirstLine(input)).toBe(true);
    });
  });

  describe('isCaretAtLastLine', () => {
    it('answers for a single-line input without reading its value', () => {
      const input = document.createElement('input');
      const readValue = vi.fn(() => 'a\nb');

      Object.defineProperty(input, 'value', { get: readValue, configurable: true });
      Object.defineProperty(input, 'selectionEnd', { get: () => 0, configurable: true });

      const atLast = isCaretAtLastLine(input);

      expect(readValue).not.toHaveBeenCalled();
      expect(atLast).toBe(true);
    });

    it('is false when the caret sits well above the last line', () => {
      const { input, firstText, lastText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [
          { container: firstText, offset: 1, rect: { top: 0, height: 20 } },
          { container: lastText, offset: 3, rect: { top: 40, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtLastLine(input)).toBe(false);
    });

    it('is true when the caret sits on the last line', () => {
      const { input, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [
          { container: lastText, offset: 1, rect: { top: 40, height: 20 } },
          { container: lastText, offset: 3, rect: { top: 40, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtLastLine(input)).toBe(true);
    });

    it('is false when the gap is exactly the tolerance', () => {
      const { input, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [
          { container: lastText, offset: 1, rect: { top: 35, height: 20 } },
          { container: lastText, offset: 3, rect: { top: 40, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtLastLine(input)).toBe(false);
    });

    it('measures the last deepest node, not the first', () => {
      const { input, firstText, lastText } = makeEditable();

      placeCaret(lastText, 1);
      stubGeometry(
        [
          { container: lastText, offset: 1, rect: { top: 40, height: 20 } },
          { container: lastText, offset: 3, rect: { top: 40, height: 20 } },
          { container: firstText, offset: 3, rect: { top: 0, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtLastLine(input)).toBe(true);
    });

    it('falls back to a line height from the input bottom when the last line has no rect', () => {
      const { input, firstText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [{ container: firstText, offset: 1, rect: { top: 45, height: 20 } }],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtLastLine(input)).toBe(true);
    });

    it('compares against the last line when it has height at the origin', () => {
      const { input, firstText, lastText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [
          { container: firstText, offset: 1, rect: { top: 45, height: 20 } },
          { container: lastText, offset: 3, rect: { top: 0, height: 20 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtLastLine(input)).toBe(false);
    });

    it('compares against the last line when it has a bottom but no height', () => {
      const { input, firstText, lastText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [
          { container: firstText, offset: 1, rect: { top: 45, height: 20 } },
          { container: lastText, offset: 3, rect: { top: 30, height: 0 } },
        ],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtLastLine(input)).toBe(false);
    });

    it('treats a caret exactly one line above the input bottom as before the last line', () => {
      const { input, firstText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [{ container: firstText, offset: 1, rect: { top: 20, height: 20 } }],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      expect(isCaretAtLastLine(input)).toBe(false);
    });

    it('measures the fallback band up from the input bottom', () => {
      const { input, firstText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [{ container: firstText, offset: 1, rect: { top: 25, height: 20 } }],
        [{ element: input, rect: { top: 0, height: 50 } }],
      );

      expect(isCaretAtLastLine(input)).toBe(true);
    });

    it('reports the last line when the boundary range cannot be built', () => {
      const { input, firstText } = makeEditable();

      placeCaret(firstText, 1);
      stubGeometry(
        [{ container: firstText, offset: 1, rect: { top: 0, height: 20 } }],
        [{ element: input, rect: { top: 0, height: 60 } }],
      );

      const broken = document.createRange();

      vi.spyOn(broken, 'setStart').mockImplementation(() => {
        throw new Error('cannot set start');
      });
      vi.spyOn(document, 'createRange').mockReturnValueOnce(broken);

      expect(isCaretAtLastLine(input)).toBe(true);
    });
  });
});
