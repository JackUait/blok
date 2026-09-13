/**
 * Tests for src/components/utils/caret/lines.ts.
 *
 * jsdom performs no layout: `Range.prototype.getBoundingClientRect` and
 * `Element.prototype.getBoundingClientRect` both return all-zero rects. Every
 * test here therefore stubs the geometry explicitly and asserts exact
 * coordinates. Range rects are keyed by (startContainer, startOffset) so the
 * ranges the module builds internally get their own measurements.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dom } from '../../../../../src/components/dom';
import {
  getValidCaretRect,
  isCaretAtFirstLine,
  isCaretAtLastLine,
} from '../../../../../src/components/utils/caret/lines';

const ZERO_RECT = DOMRect.fromRect({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
});

const rangeRects = new Map<Node, Map<number, DOMRect>>();

/**
 * Builds a rect with the given vertical geometry.
 * @param top - rect top coordinate
 * @param height - rect height, so bottom is top + height
 */
const rect = (top: number, height: number): DOMRect => DOMRect.fromRect({
  x: 0,
  y: top,
  width: 200,
  height,
});

/**
 * Pins the rect a collapsed range at (node, offset) will report.
 * @param node - range start container
 * @param offset - range start offset
 * @param value - rect to report
 */
const setRangeRect = (node: Node, offset: number, value: DOMRect): void => {
  const byOffset = rangeRects.get(node) ?? new Map<number, DOMRect>();

  byOffset.set(offset, value);
  rangeRects.set(node, byOffset);
};

/**
 * Pins the rect an element will report.
 * @param element - element to stub
 * @param value - rect to report
 */
const setElementRect = (element: Element, value: DOMRect): void => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(value);
};

/**
 * Returns the document selection, failing loudly when there is none.
 */
const requireSelection = (): Selection => {
  const selection = window.getSelection();

  if (selection === null) {
    throw new Error('Environment has no selection');
  }

  return selection;
};

/**
 * Returns the text node of an element, failing loudly when it has none.
 * @param element - element holding a single text node
 */
const textOf = (element: Element): Text => {
  const node = element.firstChild;

  if (node === null || !(node instanceof Text)) {
    throw new Error('Element has no text node');
  }

  return node;
};

interface Editable {
  input: HTMLElement;
  first: Text;
  last: Text;
}

/**
 * Mounts a contenteditable holding two single-line children.
 */
const makeEditable = (): Editable => {
  const input = document.createElement('div');

  // jsdom does not reflect the contentEditable IDL attribute, so set the
  // attribute itself.
  input.setAttribute('contenteditable', 'true');

  const firstLine = document.createElement('div');
  const lastLine = document.createElement('div');

  firstLine.textContent = 'line1';
  lastLine.textContent = 'line2';
  input.append(firstLine, lastLine);
  document.body.appendChild(input);

  return {
    input,
    first: textOf(firstLine),
    last: textOf(lastLine),
  };
};

/**
 * Collapses the document selection at (node, offset).
 * @param node - container to place the caret in
 * @param offset - offset inside the container
 */
const placeCaret = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  const selection = requireSelection();

  selection.removeAllRanges();
  selection.addRange(range);
};

/**
 * Builds a collapsed range at (node, offset) without touching the selection.
 * @param node - container to place the range in
 * @param offset - offset inside the container
 */
const rangeAt = (node: Node, offset: number): Range => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  return range;
};

/**
 * Builds a hidden input, the one input type whose value keeps newlines in
 * jsdom, with an explicit selection offset.
 * @param selection - property name and value to pin
 */
const makeNewlineInput = (selection: 'selectionStart' | 'selectionEnd', value: number): HTMLInputElement => {
  const input = document.createElement('input');

  input.type = 'hidden';
  input.value = 'a\nb';
  Object.defineProperty(input, selection, {
    value,
    configurable: true,
  });
  document.body.appendChild(input);

  return input;
};

beforeEach(() => {
  vi.clearAllMocks();
  rangeRects.clear();
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function getRect(this: Range): DOMRect {
    return rangeRects.get(this.startContainer)?.get(this.startOffset) ?? ZERO_RECT;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  requireSelection().removeAllRanges();
});

describe('getValidCaretRect', () => {
  /**
   * Mounts a paragraph with one text node and stubs its element rect.
   * @param elementRect - rect the paragraph reports
   */
  const mountHost = (elementRect: DOMRect): { host: HTMLElement; text: Text; input: HTMLElement } => {
    const input = document.createElement('div');
    const host = document.createElement('p');

    host.textContent = 'hello';
    input.appendChild(host);
    document.body.appendChild(input);
    setElementRect(host, elementRect);
    setElementRect(input, rect(4, 99));

    return {
      host,
      text: textOf(host),
      input,
    };
  };

  it('returns the caret rect when it has a height', () => {
    const { text, input } = mountHost(rect(0, 200));
    const range = rangeAt(text, 2);

    setRangeRect(text, 2, rect(100, 20));

    const result = getValidCaretRect(range, input);

    expect(result.top).toBe(100);
    expect(result.height).toBe(20);
  });

  it('returns the caret rect when it has no height but a non-zero top', () => {
    const { text, input } = mountHost(rect(0, 200));
    const range = rangeAt(text, 2);

    setRangeRect(text, 2, rect(7, 0));

    expect(getValidCaretRect(range, input).top).toBe(7);
  });

  it('returns the caret rect when it has a height but a zero top', () => {
    const { text, input } = mountHost(rect(0, 200));
    const range = rangeAt(text, 2);

    setRangeRect(text, 2, rect(0, 12));

    expect(getValidCaretRect(range, input).height).toBe(12);
  });

  it('falls back to the parent element rect for a zero caret rect in a text node', () => {
    const { text, input } = mountHost(rect(10, 50));
    const range = rangeAt(text, 2);

    const result = getValidCaretRect(range, input);

    expect(result.top).toBe(10);
    expect(result.height).toBe(50);
  });

  it('uses the start container itself when the range starts on an element', () => {
    const { host, input } = mountHost(rect(10, 50));
    const parent = host.parentElement;

    if (parent === null) {
      throw new Error('Host has no parent');
    }
    setElementRect(parent, rect(3, 80));

    // The range starts on the element, so the element's own rect wins over
    // its parent's.
    expect(getValidCaretRect(rangeAt(host, 0), input).top).toBe(10);
  });

  it('falls back to the element rect when it has no height but a non-zero top', () => {
    const { text, input } = mountHost(rect(7, 0));

    expect(getValidCaretRect(rangeAt(text, 2), input).top).toBe(7);
  });

  it('falls back to the element rect when it has a height but a zero top', () => {
    const { text, input } = mountHost(rect(0, 12));

    expect(getValidCaretRect(rangeAt(text, 2), input).height).toBe(12);
  });

  it('falls back to the input rect when both the caret and the element measure zero', () => {
    const { text, input } = mountHost(ZERO_RECT);

    const result = getValidCaretRect(rangeAt(text, 2), input);

    expect(result.top).toBe(4);
    expect(result.height).toBe(99);
  });

  it('falls back to the input rect when the start container has no parent element', () => {
    const input = document.createElement('div');

    document.body.appendChild(input);
    setElementRect(input, rect(4, 99));

    const detached = document.createTextNode('x');

    expect(detached.parentElement).toBeNull();

    const result = getValidCaretRect(rangeAt(detached, 0), input);

    expect(result.top).toBe(4);
    expect(result.height).toBe(99);
  });
});

describe('isCaretAtFirstLine', () => {
  it('is always true for a single-line native input, whatever its value holds', () => {
    const input = makeNewlineInput('selectionStart', 3);

    expect(input.value).toBe('a\nb');
    expect(isCaretAtFirstLine(input)).toBe(true);
  });

  it('is true for a textarea caret before the first newline', () => {
    const textarea = document.createElement('textarea');

    textarea.value = 'one\ntwo';
    document.body.appendChild(textarea);
    textarea.setSelectionRange(2, 2);

    expect(isCaretAtFirstLine(textarea)).toBe(true);
  });

  it('is false for a textarea caret after a newline', () => {
    const textarea = document.createElement('textarea');

    textarea.value = 'one\ntwo';
    document.body.appendChild(textarea);
    textarea.setSelectionRange(5, 5);

    expect(isCaretAtFirstLine(textarea)).toBe(false);
  });

  it('is true when there is no selection range', () => {
    const { input } = makeEditable();

    requireSelection().removeAllRanges();

    expect(isCaretAtFirstLine(input)).toBe(true);
  });

  it('is true when the caret shares the top of the first line', () => {
    const { input, first } = makeEditable();

    setRangeRect(first, 0, rect(100, 20));
    setRangeRect(first, 2, rect(100, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(first, 2);

    expect(isCaretAtFirstLine(input)).toBe(true);
  });

  it('is false when the caret sits on a lower line', () => {
    const { input, first, last } = makeEditable();

    setRangeRect(first, 0, rect(100, 20));
    setRangeRect(last, 0, rect(140, 20));
    setRangeRect(last, 1, rect(140, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(last, 1);

    expect(isCaretAtFirstLine(input)).toBe(false);
  });

  it('is false when the caret is exactly the threshold below the first line', () => {
    const { input, first } = makeEditable();

    setRangeRect(first, 0, rect(100, 20));
    setRangeRect(first, 2, rect(105, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(first, 2);

    // 5px is the tolerance, and the comparison is strict.
    expect(isCaretAtFirstLine(input)).toBe(false);
  });

  it('falls back to the input top plus a line height when the first line does not measure', () => {
    const { input, first } = makeEditable();

    setRangeRect(first, 2, rect(25, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(first, 2);

    expect(window.getComputedStyle(input).lineHeight).toBe('30px');
    expect(isCaretAtFirstLine(input)).toBe(true);
  });

  it('is false when the caret sits exactly one line height below the input top', () => {
    const { input, first } = makeEditable();

    setRangeRect(first, 2, rect(30, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(first, 2);

    expect(isCaretAtFirstLine(input)).toBe(false);
  });

  it('uses a 20px line height when the computed line height is not a number', () => {
    const { input, first } = makeEditable();

    setRangeRect(first, 2, rect(19, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(first, 2);

    expect(window.getComputedStyle(input).lineHeight).toBe('normal');
    expect(isCaretAtFirstLine(input)).toBe(true);
  });

  it('is true when the input has no deepest node', () => {
    const { input, first } = makeEditable();

    setRangeRect(first, 2, rect(500, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(first, 2);
    vi.spyOn(Dom, 'getDeepestNode').mockReturnValue(null);

    expect(isCaretAtFirstLine(input)).toBe(true);
  });

  it('compares tops when the first line rect has a top but no height', () => {
    const { input, first } = makeEditable();

    setRangeRect(first, 0, rect(100, 0));
    setRangeRect(first, 2, rect(100, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(first, 2);

    // Only a rect that is zero in BOTH height and top is treated as unmeasured.
    expect(isCaretAtFirstLine(input)).toBe(true);
  });

  it('compares tops when the first line rect has a height but a zero top', () => {
    const { input, first } = makeEditable();

    setRangeRect(first, 0, rect(0, 20));
    setRangeRect(first, 2, rect(10, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(first, 2);

    expect(isCaretAtFirstLine(input)).toBe(false);
  });

  it('leaves the first line range collapsed at the start boundary', () => {
    const { first } = makeEditable();
    const range = document.createRange();

    // setStart alone already moves the end, which is why the module's
    // following setEnd is a no-op.
    range.setStart(first, 0);

    expect(range.endContainer).toBe(first);
    expect(range.endOffset).toBe(0);
  });

  it('rejects a range start on a null node', () => {
    const range = document.createRange();

    // This is why dropping the null-node guard changes nothing: the throw is
    // caught and the function returns true either way. Reflect.apply keeps the
    // out-of-contract null argument off setStart's declared signature.
    expect(() => {
      Reflect.apply(range.setStart, range, [null, 0]);
    }).toThrow(/not of type 'Node'/);
  });

  it('is true when the first line range cannot be positioned', () => {
    const { input, first } = makeEditable();

    setRangeRect(first, 2, rect(500, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(first, 2);

    const doctype = document.implementation.createDocumentType('html', '', '');

    vi.spyOn(Dom, 'getDeepestNode').mockReturnValue(doctype);

    expect(isCaretAtFirstLine(input)).toBe(true);
  });
});

describe('isCaretAtLastLine', () => {
  it('is always true for a single-line native input, whatever its value holds', () => {
    const input = makeNewlineInput('selectionEnd', 0);

    expect(input.value).toBe('a\nb');
    expect(isCaretAtLastLine(input)).toBe(true);
  });

  it('is true for a textarea caret after the last newline', () => {
    const textarea = document.createElement('textarea');

    textarea.value = 'one\ntwo';
    document.body.appendChild(textarea);
    textarea.setSelectionRange(5, 5);

    expect(isCaretAtLastLine(textarea)).toBe(true);
  });

  it('is false for a textarea caret before a newline', () => {
    const textarea = document.createElement('textarea');

    textarea.value = 'one\ntwo';
    document.body.appendChild(textarea);
    textarea.setSelectionRange(2, 2);

    expect(isCaretAtLastLine(textarea)).toBe(false);
  });

  it('is true when there is no selection range', () => {
    const { input } = makeEditable();

    requireSelection().removeAllRanges();

    expect(isCaretAtLastLine(input)).toBe(true);
  });

  it('is true when the caret shares the bottom of the last line', () => {
    const { input, last } = makeEditable();

    setRangeRect(last, 5, rect(140, 20));
    setRangeRect(last, 1, rect(140, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(last, 1);

    expect(isCaretAtLastLine(input)).toBe(true);
  });

  it('is false when the caret sits on a higher line', () => {
    const { input, first, last } = makeEditable();

    setRangeRect(last, 5, rect(140, 20));
    setRangeRect(first, 5, rect(100, 20));
    setRangeRect(first, 2, rect(100, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(first, 2);

    expect(isCaretAtLastLine(input)).toBe(false);
  });

  it('is false when the caret is exactly the threshold above the last line', () => {
    const { input, last } = makeEditable();

    setRangeRect(last, 5, rect(140, 20));
    setRangeRect(last, 1, rect(135, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(last, 1);

    // 5px is the tolerance, and the comparison is strict.
    expect(isCaretAtLastLine(input)).toBe(false);
  });

  it('falls back to the input bottom minus a line height when the last line does not measure', () => {
    const { input, last } = makeEditable();

    setRangeRect(last, 1, rect(155, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(last, 1);

    expect(window.getComputedStyle(input).lineHeight).toBe('30px');
    expect(isCaretAtLastLine(input)).toBe(true);
  });

  it('is false when the caret bottom sits exactly one line height above the input bottom', () => {
    const { input, last } = makeEditable();

    setRangeRect(last, 1, rect(150, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(last, 1);

    expect(isCaretAtLastLine(input)).toBe(false);
  });

  it('uses a 20px line height when the computed line height is not a number', () => {
    const { input, last } = makeEditable();

    setRangeRect(last, 1, rect(161, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(last, 1);

    expect(window.getComputedStyle(input).lineHeight).toBe('normal');
    expect(isCaretAtLastLine(input)).toBe(true);
  });

  it('is true when the input has no deepest node', () => {
    const { input, last } = makeEditable();

    setRangeRect(last, 1, rect(0, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(last, 1);
    vi.spyOn(Dom, 'getDeepestNode').mockReturnValue(null);

    expect(isCaretAtLastLine(input)).toBe(true);
  });

  it('compares bottoms when the last line rect has a bottom but no height', () => {
    const { input, last } = makeEditable();

    setRangeRect(last, 5, rect(140, 0));
    setRangeRect(last, 1, rect(120, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(last, 1);

    // Only a rect that is zero in BOTH height and bottom is treated as unmeasured.
    expect(isCaretAtLastLine(input)).toBe(true);
  });

  it('compares bottoms when the last line rect has a height but a zero bottom', () => {
    const { input, last } = makeEditable();

    setRangeRect(last, 5, rect(-20, 20));
    setRangeRect(last, 1, rect(175, 20));
    setElementRect(input, rect(0, 200));
    input.style.lineHeight = '30px';
    placeCaret(last, 1);

    expect(isCaretAtLastLine(input)).toBe(false);
  });

  it('is true when the last line range cannot be positioned', () => {
    const { input, last } = makeEditable();

    setRangeRect(last, 1, rect(0, 20));
    setElementRect(input, rect(0, 200));
    placeCaret(last, 1);

    const doctype = document.implementation.createDocumentType('html', '', '');

    vi.spyOn(Dom, 'getDeepestNode').mockReturnValue(doctype);

    expect(isCaretAtLastLine(input)).toBe(true);
  });
});
