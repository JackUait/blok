/**
 * Tests for src/components/utils/caret/boundaries.ts.
 *
 * jsdom performs no layout, so `getBoundingClientRect()` is all zeros. The
 * module measures a probe div it mounts on the body; tests that care about the
 * measurement stub `Element.prototype.getBoundingClientRect` and read the probe
 * back through `this`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkContenteditableSliceForEmptiness,
  isCaretAtEndOfInput,
  isCaretAtStartOfInput,
} from '../../../../../src/components/utils/caret/boundaries';

const NBSP = ' ';
const ZWSP = '​';

const ZERO_RECT = DOMRect.fromRect({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
});

const WIDE_RECT = DOMRect.fromRect({
  x: 0,
  y: 0,
  width: 42,
  height: 10,
});

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
 * Mounts a contenteditable with the given markup.
 * @param html - inner markup of the editable
 */
const mountEditable = (html: string): HTMLElement => {
  const input = document.createElement('div');

  // jsdom does not reflect the contentEditable IDL property to the attribute.
  input.setAttribute('contenteditable', 'true');
  input.innerHTML = html;
  document.body.appendChild(input);

  return input;
};

/**
 * Returns the first descendant text node of a node, failing loudly if absent.
 * @param root - node to search under
 */
const firstText = (root: Node): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();

  if (node === null || !(node instanceof Text)) {
    throw new Error('No text node found');
  }

  return node;
};

/**
 * Returns the element matching a selector, failing loudly if absent.
 * @param root - element to query under
 * @param selector - CSS selector
 */
const query = (root: ParentNode, selector: string): HTMLElement => {
  const found = root.querySelector(selector);

  if (!(found instanceof HTMLElement)) {
    throw new Error(`No element for ${selector}`);
  }

  return found;
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
 * Makes every element report a non-zero width.
 */
const stubWideRects = (): void => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(WIDE_RECT);
};

/**
 * Builds a native input with an explicit caret offset. `setSelectionRange`
 * clamps to the value length, so the offset is pinned as a property instead.
 * @param tag - input or textarea
 * @param value - field value
 * @param selectionEnd - caret offset to report
 */
const makeNativeInput = (
  tag: 'input' | 'textarea',
  value: string,
  selectionEnd: number
): HTMLElement => {
  const host = document.createElement('div');
  const field = document.createElement(tag);

  field.value = value;
  Object.defineProperty(field, 'selectionEnd', {
    value: selectionEnd,
    configurable: true,
  });
  host.appendChild(field);
  document.body.appendChild(host);

  return host;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  requireSelection().removeAllRanges();
});

describe('checkContenteditableSliceForEmptiness', () => {
  it('reports an empty slice at offset 0 and a non-empty one at offset 1', () => {
    const input = mountEditable('abc');
    const text = firstText(input);

    expect(checkContenteditableSliceForEmptiness(input, text, 0, 'left')).toBe(true);
    expect(checkContenteditableSliceForEmptiness(input, text, 1, 'left')).toBe(false);
  });

  it('reports an empty right slice only at the very end of the text', () => {
    const input = mountEditable('abc');
    const text = firstText(input);

    expect(checkContenteditableSliceForEmptiness(input, text, 3, 'right')).toBe(true);
    expect(checkContenteditableSliceForEmptiness(input, text, 2, 'right')).toBe(false);
  });

  it('treats a trailing br with no text as an empty right slice', () => {
    const input = mountEditable('a<br>');
    const text = firstText(input);

    expect(checkContenteditableSliceForEmptiness(input, text, 1, 'right')).toBe(true);
  });

  it('treats a br in the left slice as non-empty', () => {
    const input = mountEditable('<br>x');
    const text = firstText(input);

    expect(checkContenteditableSliceForEmptiness(input, text, 0, 'left')).toBe(false);
  });

  it('treats an img in the right slice as non-empty even with no text', () => {
    const input = mountEditable('a<img>');
    const text = firstText(input);

    expect(checkContenteditableSliceForEmptiness(input, text, 1, 'right')).toBe(false);
  });

  it('treats a br next to a zero-width space as non-empty', () => {
    const input = mountEditable(`a<br>${ZWSP}`);
    const text = firstText(input);

    expect(checkContenteditableSliceForEmptiness(input, text, 1, 'right')).toBe(false);
  });

  it('treats a br next to a collapsible space as empty', () => {
    const input = mountEditable('a<br> ');
    const text = firstText(input);

    expect(checkContenteditableSliceForEmptiness(input, text, 1, 'right')).toBe(true);
  });

  it('treats a nbsp carried only by markup as non-empty', () => {
    const input = mountEditable(`<span title="${NBSP}"></span>x`);
    const text = firstText(input);

    expect(checkContenteditableSliceForEmptiness(input, text, 0, 'left')).toBe(false);
  });

  it('treats a nbsp in the left part of the start node as non-empty', () => {
    const input = mountEditable('');
    const detached = document.createTextNode(NBSP);

    expect(checkContenteditableSliceForEmptiness(input, detached, 1, 'left')).toBe(false);
  });

  it('ignores a nbsp held by a non-text start node', () => {
    const input = mountEditable('');
    const detached = document.createElement('span');

    detached.textContent = NBSP;

    expect(checkContenteditableSliceForEmptiness(input, detached, 1, 'left')).toBe(true);
  });

  it('looks only left of the offset for the left direction', () => {
    const input = mountEditable('');
    const detached = document.createTextNode(`x${NBSP}`);

    expect(checkContenteditableSliceForEmptiness(input, detached, 1, 'left')).toBe(true);
  });

  it('looks only right of the offset for the right direction', () => {
    const input = mountEditable('');
    const detached = document.createTextNode(`${NBSP}x`);

    expect(checkContenteditableSliceForEmptiness(input, detached, 1, 'right')).toBe(true);
  });

  it('measures the probe off-screen with auto sizing', () => {
    const input = mountEditable('abc');
    const text = firstText(input);

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element): DOMRect {
      const measuredOffScreen =
        this instanceof HTMLElement &&
        this.style.position === 'absolute' &&
        this.style.visibility === 'hidden' &&
        this.style.height === 'auto' &&
        this.style.width === 'auto';

      return measuredOffScreen ? ZERO_RECT : WIDE_RECT;
    });

    expect(checkContenteditableSliceForEmptiness(input, text, 0, 'left')).toBe(true);
  });

  it('treats a slice with a rendered width as non-empty', () => {
    const input = mountEditable(' ');
    const text = firstText(input);

    stubWideRects();

    expect(checkContenteditableSliceForEmptiness(input, text, 1, 'left')).toBe(false);
  });

  it('leaves no probe element behind on the body', () => {
    const input = mountEditable('abc');
    const text = firstText(input);

    checkContenteditableSliceForEmptiness(input, text, 1, 'left');

    expect(document.body.childElementCount).toBe(1);
    expect(document.body.firstElementChild).toBe(input);
  });

  it('treats a space as non-empty inside a pre-wrap editable', () => {
    const input = mountEditable(' ');

    input.style.whiteSpace = 'pre-wrap';

    expect(checkContenteditableSliceForEmptiness(input, firstText(input), 1, 'left')).toBe(false);
  });

  it('treats an empty slice as empty inside a pre editable', () => {
    const input = mountEditable(' ');

    input.style.whiteSpace = 'pre';

    expect(checkContenteditableSliceForEmptiness(input, firstText(input), 0, 'left')).toBe(true);
  });

  it('treats a space as empty outside a pre editable', () => {
    const input = mountEditable(' ');

    input.style.whiteSpace = 'normal';

    expect(checkContenteditableSliceForEmptiness(input, firstText(input), 1, 'left')).toBe(true);
  });
});

describe('isCaretAtStartOfInput', () => {
  it('reports the start for an empty editable', () => {
    expect(isCaretAtStartOfInput(mountEditable(''))).toBe(true);
  });

  it('reports the start of a native input by its offset', () => {
    expect(isCaretAtStartOfInput(makeNativeInput('input', 'abc', 0))).toBe(true);
    expect(isCaretAtStartOfInput(makeNativeInput('input', 'abc', 1))).toBe(false);
  });

  it('trusts the offset of an empty native input over the emptiness check', () => {
    expect(isCaretAtStartOfInput(makeNativeInput('input', '', 5))).toBe(false);
    expect(isCaretAtStartOfInput(makeNativeInput('input', '', 0))).toBe(true);
  });

  it('reports the start of an empty textarea whatever its offset', () => {
    expect(isCaretAtStartOfInput(makeNativeInput('textarea', '', 5))).toBe(true);
  });

  it('reports the start of a filled textarea by its offset', () => {
    expect(isCaretAtStartOfInput(makeNativeInput('textarea', 'ab', 0))).toBe(true);
    expect(isCaretAtStartOfInput(makeNativeInput('textarea', 'ab', 1))).toBe(false);
  });

  it('is not at the start when there is no selection', () => {
    const input = mountEditable('abc');

    requireSelection().removeAllRanges();

    expect(isCaretAtStartOfInput(input)).toBe(false);
  });

  it('is at the start when the caret sits at offset 0 inside a leading tag', () => {
    const input = mountEditable('<b>abc</b> tail');

    placeCaret(firstText(input), 0);

    expect(isCaretAtStartOfInput(input)).toBe(true);
  });

  it('is at the start at offset 0 inside tags nested two deep', () => {
    const input = mountEditable('<b><i>abc</i></b> tail');

    placeCaret(firstText(input), 0);

    expect(isCaretAtStartOfInput(input)).toBe(true);
  });

  it('is not at the start inside a tag that has text before it', () => {
    const input = mountEditable('x<b>abc</b>');

    placeCaret(firstText(query(input, 'b')), 0);

    expect(isCaretAtStartOfInput(input)).toBe(false);
  });

  it('is not at the start inside a leading tag past its first character', () => {
    const input = mountEditable('<b>abc</b>');

    placeCaret(firstText(input), 1);

    expect(isCaretAtStartOfInput(input)).toBe(false);
  });

  it('is not at the start when the caret is outside the input', () => {
    const outside = mountEditable('zzz');
    const input = mountEditable('abc');

    placeCaret(firstText(outside), 0);

    expect(isCaretAtStartOfInput(input)).toBe(false);
  });

  it('is at the start when the selection focuses the editable itself', () => {
    const input = mountEditable('abc');

    placeCaret(input, 0);

    expect(isCaretAtStartOfInput(input)).toBe(true);
  });

  it('is at the start when the selection focuses a leading child element node', () => {
    const input = mountEditable('<b>abc</b>');

    placeCaret(query(input, 'b'), 0);

    expect(isCaretAtStartOfInput(input)).toBe(true);
  });

  it('distinguishes offset 0 from offset 1 in a direct text child', () => {
    const input = mountEditable('abc');

    placeCaret(firstText(input), 0);
    expect(isCaretAtStartOfInput(input)).toBe(true);

    placeCaret(firstText(input), 1);
    expect(isCaretAtStartOfInput(input)).toBe(false);
  });
});

describe('isCaretAtEndOfInput', () => {
  it('reports the end of a native input by its offset', () => {
    expect(isCaretAtEndOfInput(makeNativeInput('input', 'abc', 3))).toBe(true);
    expect(isCaretAtEndOfInput(makeNativeInput('input', 'abc', 2))).toBe(false);
  });

  it('reports the end of a textarea by its offset', () => {
    expect(isCaretAtEndOfInput(makeNativeInput('textarea', 'a\nb', 3))).toBe(true);
    expect(isCaretAtEndOfInput(makeNativeInput('textarea', 'a\nb', 2))).toBe(false);
  });

  it('is not at the end when there is no selection', () => {
    const input = mountEditable('abc');

    requireSelection().removeAllRanges();

    expect(isCaretAtEndOfInput(input)).toBe(false);
  });

  it('distinguishes the last offset from the one before it', () => {
    const input = mountEditable('abc');

    placeCaret(firstText(input), 3);
    expect(isCaretAtEndOfInput(input)).toBe(true);

    placeCaret(firstText(input), 2);
    expect(isCaretAtEndOfInput(input)).toBe(false);
  });

  it('is at the end when the caret sits inside a nested tag at its end', () => {
    const input = mountEditable('<b>abc</b>');

    placeCaret(firstText(input), 3);

    expect(isCaretAtEndOfInput(input)).toBe(true);
  });
});
