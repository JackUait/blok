import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  checkContenteditableSliceForEmptiness,
  isCaretAtStartOfInput,
  isCaretAtEndOfInput,
} from '../../../../src/components/utils/caret/boundaries';

const NBSP = '\u00A0';

const editable = (html: string): HTMLElement => {
  const host = document.createElement('div');

  host.contentEditable = 'true';
  host.innerHTML = html;
  document.body.appendChild(host);

  return host;
};

const firstText = (root: Node): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const node = walker.nextNode();

  if (node === null) {
    throw new Error('fixture has no text node');
  }

  return node as Text;
};

const textHolding = (root: Node, value: string): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent === value) {
      return node as Text;
    }
  }

  throw new Error(`no text node holding ${JSON.stringify(value)}`);
};

const putCaret = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

describe('caret boundary mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  describe('checkContenteditableSliceForEmptiness', () => {
    it('calls the left of the very start empty', () => {
      const host = editable('abc');

      expect(checkContenteditableSliceForEmptiness(host, firstText(host), 0, 'left')).toBe(true);
    });

    it('calls the left of a later offset not empty', () => {
      const host = editable('abc');

      expect(checkContenteditableSliceForEmptiness(host, firstText(host), 1, 'left')).toBe(false);
    });

    it('calls the right of the very end empty', () => {
      const host = editable('abc');

      expect(checkContenteditableSliceForEmptiness(host, firstText(host), 3, 'right')).toBe(true);
    });

    it('calls the right of an earlier offset not empty', () => {
      const host = editable('abc');

      expect(checkContenteditableSliceForEmptiness(host, firstText(host), 2, 'right')).toBe(false);
    });

    it('treats plain whitespace as empty', () => {
      const host = editable('  a');

      expect(checkContenteditableSliceForEmptiness(host, firstText(host), 2, 'left')).toBe(true);
    });

    it('treats a non-breaking space as visible content', () => {
      const host = editable('&nbsp;a');

      expect(host.textContent?.includes(NBSP)).toBe(true);
      expect(checkContenteditableSliceForEmptiness(host, firstText(host), 1, 'left')).toBe(false);
    });

    it('treats an image on the left as visible content', () => {
      const host = editable('<img alt="">a');

      expect(checkContenteditableSliceForEmptiness(host, textHolding(host, 'a'), 0, 'left')).toBe(false);
    });

    it('treats a lone trailing break on the right as empty', () => {
      const host = editable('a<br>');

      expect(checkContenteditableSliceForEmptiness(host, textHolding(host, 'a'), 1, 'right')).toBe(true);
    });

    it('treats a break on the LEFT as visible content, unlike a trailing one', () => {
      const host = editable('<br>a');

      expect(checkContenteditableSliceForEmptiness(host, textHolding(host, 'a'), 0, 'left')).toBe(false);
    });

    it('treats a trailing break with text after it as visible content', () => {
      const host = editable('a<br>b');

      expect(checkContenteditableSliceForEmptiness(host, textHolding(host, 'a'), 1, 'right')).toBe(false);
    });

    it('treats a trailing image beside a break as visible content', () => {
      const host = editable('a<br><img alt="">');

      expect(checkContenteditableSliceForEmptiness(host, textHolding(host, 'a'), 1, 'right')).toBe(false);
    });

    it('keeps whitespace significant in a pre-formatted host', () => {
      const host = editable('  a');

      host.style.whiteSpace = 'pre-wrap';

      expect(checkContenteditableSliceForEmptiness(host, firstText(host), 2, 'left')).toBe(false);
    });
  });

  describe('isCaretAtStartOfInput', () => {
    it('is true for an empty host, selection or not', () => {
      expect(isCaretAtStartOfInput(editable(''))).toBe(true);
    });

    it('reads the offset of a native input', () => {
      const host = document.createElement('div');
      const input = document.createElement('input');

      input.value = 'abc';
      host.appendChild(input);
      document.body.appendChild(host);

      input.setSelectionRange(0, 0);
      expect(isCaretAtStartOfInput(host)).toBe(true);

      input.setSelectionRange(2, 2);
      expect(isCaretAtStartOfInput(host)).toBe(false);
    });

    it('is true with the caret before the first character', () => {
      const host = editable('abc');

      putCaret(firstText(host), 0);

      expect(isCaretAtStartOfInput(host)).toBe(true);
    });

    it('is false with the caret after a character', () => {
      const host = editable('abc');

      putCaret(firstText(host), 1);

      expect(isCaretAtStartOfInput(host)).toBe(false);
    });

    it('is false with no selection at all', () => {
      const host = editable('abc');

      window.getSelection()?.removeAllRanges();

      expect(isCaretAtStartOfInput(host)).toBe(false);
    });

    it('is false inside a nested tag, so the browser can step out of it first', () => {
      const host = editable('<b>abc</b>');

      putCaret(textHolding(host, 'abc'), 0);

      expect(isCaretAtStartOfInput(host)).toBe(false);
    });
  });

  describe('isCaretAtEndOfInput', () => {
    it('is true with the caret in an empty host', () => {
      const host = editable('');

      putCaret(host, 0);

      expect(isCaretAtEndOfInput(host)).toBe(true);
    });

    it('is false for an empty host with no selection, unlike the start check', () => {
      const host = editable('');

      window.getSelection()?.removeAllRanges();

      expect(isCaretAtEndOfInput(host)).toBe(false);
      expect(isCaretAtStartOfInput(host)).toBe(true);
    });

    it('reads the offset of a native input against its length', () => {
      const host = document.createElement('div');
      const input = document.createElement('input');

      input.value = 'abc';
      host.appendChild(input);
      document.body.appendChild(host);

      input.setSelectionRange(3, 3);
      expect(isCaretAtEndOfInput(host)).toBe(true);

      input.setSelectionRange(2, 2);
      expect(isCaretAtEndOfInput(host)).toBe(false);
    });

    it('is true with the caret after the last character', () => {
      const host = editable('abc');

      putCaret(firstText(host), 3);

      expect(isCaretAtEndOfInput(host)).toBe(true);
    });

    it('is false with the caret before the last character', () => {
      const host = editable('abc');

      putCaret(firstText(host), 2);

      expect(isCaretAtEndOfInput(host)).toBe(false);
    });

    it('is true with only a trailing break after the caret', () => {
      const host = editable('abc<br>');

      putCaret(textHolding(host, 'abc'), 3);

      expect(isCaretAtEndOfInput(host)).toBe(true);
    });

    it('is false with no selection at all', () => {
      const host = editable('abc');

      window.getSelection()?.removeAllRanges();

      expect(isCaretAtEndOfInput(host)).toBe(false);
    });
  });
});
