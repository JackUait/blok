import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  createRangeTextWalker,
  findFormattingAncestor,
  isRangeFormatted,
  extendRangeToTrailingWhitespace,
  collectFormattingAncestors,
} from '../../../../../src/components/inline-tools/utils/formatting-range-utils';

const isBold = (element: Element): boolean => element.tagName === 'B';

const host = (html: string): HTMLElement => {
  const el = document.createElement('div');

  el.contentEditable = 'true';
  el.innerHTML = html;
  document.body.appendChild(el);

  return el;
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

const over = (start: Node, startOffset: number, end: Node, endOffset: number): Range => {
  const range = document.createRange();

  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);

  return range;
};

const walked = (range: Range): string[] => {
  const walker = createRangeTextWalker(range);
  const found: string[] = [];

  while (walker.nextNode()) {
    found.push(walker.currentNode.textContent ?? '');
  }

  return found;
};

/**
 * Forces the Safari fallback: jsdom's `intersectsNode` never throws, so the
 * catch branch is only reachable when the platform call is made to fail.
 */
const throwingIntersects = (range: Range): Range => {
  vi.spyOn(range, 'intersectsNode').mockImplementation(() => {
    throw new Error('node is detached from DOM');
  });

  return range;
};

describe('formatting range utils mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('createRangeTextWalker', () => {
    it('reaches a text node even when the range sits entirely inside it', () => {
      const root = host('hello');
      const text = textHolding(root, 'hello');

      expect(walked(over(text, 1, text, 3))).toStrictEqual(['hello']);
    });

    it('visits every text node the range touches and no others', () => {
      const root = host('<i>a</i><i>b</i><i>c</i>');
      const range = over(textHolding(root, 'a'), 0, textHolding(root, 'b'), 1);

      expect(walked(range)).toStrictEqual(['a', 'b']);
    });

    it('rejects text nodes outside the range when intersectsNode throws', () => {
      const root = host('<i>a</i><i>b</i>');

      // Covers only the second <i>: 'a' ends before the range starts.
      expect(walked(throwingIntersects(over(root, 1, root, 2)))).not.toContain('a');

      // Covers only the first <i>: 'b' starts after the range ends.
      expect(walked(throwingIntersects(over(root, 0, root, 1)))).not.toContain('b');
    });
  });

  describe('findFormattingAncestor', () => {
    it('finds the wrapper above a text node', () => {
      const root = host('<b>bold</b>');

      expect(findFormattingAncestor(textHolding(root, 'bold'), isBold)?.tagName).toBe('B');
    });

    it('returns the node itself when it already matches', () => {
      const root = host('<b>bold</b>');
      const bold = root.children[0];

      expect(findFormattingAncestor(bold, isBold)).toBe(bold);
    });

    it('finds nothing above unformatted text', () => {
      const root = host('plain');

      expect(findFormattingAncestor(textHolding(root, 'plain'), isBold)).toBeNull();
    });

    it('finds nothing from a missing node', () => {
      expect(findFormattingAncestor(null, isBold)).toBeNull();
    });

    it('stops at the boundary rather than walking past it', () => {
      const root = host('<b><i>x</i></b>');
      const italic = root.querySelector('i');

      if (italic === null) {
        throw new Error('fixture has no italic');
      }

      expect(findFormattingAncestor(textHolding(root, 'x'), isBold)?.tagName).toBe('B');
      expect(findFormattingAncestor(textHolding(root, 'x'), isBold, italic)).toBeNull();
    });

    it('stops when the boundary IS the starting node', () => {
      const root = host('<b>bold</b>');
      const bold = root.children[0];

      expect(findFormattingAncestor(bold, isBold, bold)).toBeNull();
    });

    it('returns the matching element, never a non-element the predicate accepts', () => {
      const root = host('<b>bold</b>');
      const text = textHolding(root, 'bold');

      expect(findFormattingAncestor(text, () => true)).toBe(root.children[0]);
    });
  });

  describe('isRangeFormatted', () => {
    it('reads a collapsed caret from its ancestors', () => {
      const root = host('<b>bold</b>');
      const text = textHolding(root, 'bold');

      expect(isRangeFormatted(over(text, 2, text, 2), isBold)).toBe(true);
    });

    it('is true only when every text node in the range is wrapped', () => {
      const wrapped = host('<b>a</b><b>b</b>');
      const partly = host('<b>a</b>b');

      expect(isRangeFormatted(over(textHolding(wrapped, 'a'), 0, textHolding(wrapped, 'b'), 1), isBold)).toBe(true);
      expect(isRangeFormatted(over(textHolding(partly, 'a'), 0, textHolding(partly, 'b'), 1), isBold)).toBe(false);
    });

    it('can be told to overlook whitespace between wrapped runs', () => {
      const root = host('<b>a</b> <b>b</b>');
      const range = over(textHolding(root, 'a'), 0, textHolding(root, 'b'), 1);

      expect(isRangeFormatted(range, isBold, { ignoreWhitespace: true })).toBe(true);
      expect(isRangeFormatted(range, isBold)).toBe(false);
    });

    it('falls back to the ancestors of the start when the range holds no text', () => {
      const root = host('<b><br></b>');
      const bold = root.children[0];

      expect(isRangeFormatted(over(bold, 0, bold, 1), isBold)).toBe(true);
    });

    it('is false when the range holds no text and its start is unformatted', () => {
      const root = host('<br>');

      expect(isRangeFormatted(over(root, 0, root, 1), isBold)).toBe(false);
    });

    it('ignores an empty text node instead of counting it as unformatted', () => {
      const root = host('<b>a</b>');

      root.appendChild(document.createTextNode(''));

      expect(isRangeFormatted(over(root, 0, root, root.childNodes.length), isBold)).toBe(true);
    });
  });

  describe('extendRangeToTrailingWhitespace', () => {
    it('covers trailing spaces a text-node range stopped short of', () => {
      const root = host('hello   ');
      const text = textHolding(root, 'hello   ');
      const range = over(text, 0, text, 5);

      extendRangeToTrailingWhitespace(range);

      expect(range.endOffset).toBe(8);
    });

    it('leaves a range alone when real text follows it', () => {
      const root = host('hello world');
      const text = textHolding(root, 'hello world');
      const range = over(text, 0, text, 5);

      extendRangeToTrailingWhitespace(range);

      expect(range.endOffset).toBe(5);
    });

    it('leaves a mid-text range alone when the text node ends in whitespace', () => {
      const root = host('ab   cd   ');
      const text = textHolding(root, 'ab   cd   ');
      const range = over(text, 0, text, 3);

      extendRangeToTrailingWhitespace(range);

      expect(range.endOffset).toBe(3);
    });

    it('leaves a range already at the end of its text node alone', () => {
      const root = host('hello');
      const text = textHolding(root, 'hello');
      const range = over(text, 0, text, 5);

      extendRangeToTrailingWhitespace(range);

      expect(range.endOffset).toBe(5);
    });

    it('covers trailing spaces for a select-all range ending on the element', () => {
      const root = host('hello   ');
      const range = over(root, 0, root, root.childNodes.length);

      extendRangeToTrailingWhitespace(range);

      expect(range.endContainer).toBe(textHolding(root, 'hello   '));
      expect(range.endOffset).toBe(8);
    });

    it('reaches the deepest last text node of a nested select-all', () => {
      const root = host('a<b><i>bold   </i></b>');
      const range = over(root, 0, root, root.childNodes.length);

      extendRangeToTrailingWhitespace(range);

      expect(range.endContainer).toBe(textHolding(root, 'bold   '));
      expect(range.endOffset).toBe(7);
    });

    it('leaves an element range that stops short of the last child alone', () => {
      const root = host('a<b>bold   </b>');
      const range = over(root, 0, root, 1);

      extendRangeToTrailingWhitespace(range);

      expect(range.endContainer).toBe(root);
      expect(range.endOffset).toBe(1);
    });

    it('leaves an element range alone when its text has no trailing space', () => {
      const root = host('hello');
      const range = over(root, 0, root, root.childNodes.length);

      extendRangeToTrailingWhitespace(range);

      expect(range.endContainer).toBe(root);
    });

    it('leaves an element with no text at all alone', () => {
      const root = host('<br>');
      const range = over(root, 0, root, root.childNodes.length);

      expect(() => extendRangeToTrailingWhitespace(range)).not.toThrow();
      expect(range.endContainer).toBe(root);
    });

    it('leaves the range alone when the deepest last child is not a text node', () => {
      const root = host('a<!--trailing   -->');
      const range = over(root, 0, root, root.childNodes.length);

      extendRangeToTrailingWhitespace(range);

      expect(range.endContainer).toBe(root);
    });
  });

  describe('collectFormattingAncestors', () => {
    it('reports each wrapper once, however many text nodes it holds', () => {
      const root = host('<b>a<i>b</i></b>');
      const range = over(textHolding(root, 'a'), 0, textHolding(root, 'b'), 1);
      const found = collectFormattingAncestors(range, isBold);

      expect(found).toHaveLength(1);
      expect(found[0]).toBe(root.children[0]);
    });

    it('reports every distinct wrapper in the range', () => {
      const root = host('<b>a</b>x<b>c</b>');
      const range = over(textHolding(root, 'a'), 0, textHolding(root, 'c'), 1);

      expect(collectFormattingAncestors(range, isBold)).toHaveLength(2);
    });

    it('reports nothing for an unformatted range', () => {
      const root = host('plain text');
      const text = textHolding(root, 'plain text');

      expect(collectFormattingAncestors(over(text, 0, text, 5), isBold)).toStrictEqual([]);
    });
  });
});
