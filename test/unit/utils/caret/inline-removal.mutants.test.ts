import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  isElementVisuallyEmpty,
  findNbspAfterEmptyInline,
  ensureInlineRemovalObserver,
  whitespaceFollowingRemovedEmptyInline,
} from '../../../../src/components/utils/caret/inline-removal';

const NBSP = '\u00A0';

const editable = (html: string): HTMLElement => {
  const host = document.createElement('div');

  host.contentEditable = 'true';
  host.innerHTML = html;
  document.body.appendChild(host);

  return host;
};

const textNodes = (root: Node): Text[] => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found: Text[] = [];

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    found.push(node as Text);
  }

  return found;
};

const putCaret = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

describe('inline removal mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  describe('isElementVisuallyEmpty', () => {
    it('calls an element with no children empty', () => {
      expect(isElementVisuallyEmpty(document.createElement('span'))).toBe(true);
    });

    it('calls an element holding only collapsed whitespace empty', () => {
      const host = editable('<span>   </span>');

      expect(isElementVisuallyEmpty(host.children[0])).toBe(true);
    });

    it('calls an element holding text not empty', () => {
      const host = editable('<span>x</span>');

      expect(isElementVisuallyEmpty(host.children[0])).toBe(false);
    });

    it('calls an element holding a non-breaking space not empty', () => {
      const host = editable(`<span>${NBSP}</span>`);

      expect(isElementVisuallyEmpty(host.children[0])).toBe(false);
    });

    it('refuses a self-closing tag, which renders even with no content', () => {
      const host = editable('<br><img alt="">');

      expect(isElementVisuallyEmpty(host.children[0])).toBe(false);
      expect(isElementVisuallyEmpty(host.children[1])).toBe(false);
    });

    it('refuses a native input, which renders even when empty', () => {
      const host = editable('<input><textarea></textarea>');

      expect(isElementVisuallyEmpty(host.children[0])).toBe(false);
      expect(isElementVisuallyEmpty(host.children[1])).toBe(false);
    });

    it('refuses an element with no style property at all', () => {
      // A foreign-namespace element is a plain Element: no HTMLElement or
      // SVGElement mixin, so no `style`, which is what the guard reads.
      const foreign = document.createElementNS('urn:test:ns', 'thing');

      expect('style' in foreign).toBe(false);
      expect(isElementVisuallyEmpty(foreign)).toBe(false);
    });

    it('recurses into children, so nested empty wrappers are still empty', () => {
      const host = editable('<span><i><b></b></i></span>');

      expect(isElementVisuallyEmpty(host.children[0])).toBe(true);
    });

    it('recurses into children, so one rendering descendant is enough', () => {
      const host = editable('<span><i><br></i></span>');

      expect(isElementVisuallyEmpty(host.children[0])).toBe(false);
    });
  });

  describe('ensureInlineRemovalObserver', () => {
    it('waits for DOMContentLoaded on a document still loading', () => {
      const frame = document.createElement('iframe');

      document.body.appendChild(frame);

      const doc = frame.contentDocument;

      expect(doc).not.toBeNull();

      if (doc === null) {
        return;
      }

      vi.spyOn(doc, 'readyState', 'get').mockReturnValue('loading');

      const listen = vi.spyOn(doc, 'addEventListener');

      ensureInlineRemovalObserver(doc);

      expect(listen).toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function), { once: true });
    });

    it('does not wait when the document is already parsed', () => {
      const frame = document.createElement('iframe');

      document.body.appendChild(frame);

      const doc = frame.contentDocument;

      if (doc === null) {
        return;
      }

      const listen = vi.spyOn(doc, 'addEventListener');

      ensureInlineRemovalObserver(doc);

      expect(listen).not.toHaveBeenCalledWith('DOMContentLoaded', expect.any(Function), { once: true });
    });
  });

  describe('findNbspAfterEmptyInline', () => {
    it('finds the space that an empty wrapper is hiding in front of', () => {
      const host = editable(`a<span></span>${NBSP}b`);
      const [first, space] = textNodes(host);

      putCaret(first, 1);
      whitespaceFollowingRemovedEmptyInline.add(space);

      expect(findNbspAfterEmptyInline(host)).toStrictEqual({ node: space, offset: 0 });
    });

    it('forgets the node once reported, so the next search does not repeat it', () => {
      const host = editable(`a<span></span>${NBSP}b`);
      const [first, space] = textNodes(host);

      putCaret(first, 1);
      whitespaceFollowingRemovedEmptyInline.add(space);

      findNbspAfterEmptyInline(host);

      expect(whitespaceFollowingRemovedEmptyInline.has(space)).toBe(false);
    });

    it('finds a plain space, not only a non-breaking one', () => {
      const host = editable('a<span></span> b');
      const [first, space] = textNodes(host);

      putCaret(first, 1);

      expect(findNbspAfterEmptyInline(host)).toStrictEqual({ node: space, offset: 0 });
    });

    it('finds nothing when the next text does not start with whitespace', () => {
      const host = editable('a<span></span>b');
      const [first] = textNodes(host);

      putCaret(first, 1);

      expect(findNbspAfterEmptyInline(host)).toBeNull();
    });

    it('finds nothing when the caret is mid-text rather than at its end', () => {
      const host = editable(`ab<span></span>${NBSP}c`);
      const [first, space] = textNodes(host);

      putCaret(first, 1);
      whitespaceFollowingRemovedEmptyInline.add(space);

      expect(findNbspAfterEmptyInline(host)).toBeNull();
    });

    it('finds nothing when the caret sits outside the searched root', () => {
      const host = editable(`a<span></span>${NBSP}b`);
      const other = editable('elsewhere');
      const [outside] = textNodes(other);

      putCaret(outside, 9);

      expect(findNbspAfterEmptyInline(host)).toBeNull();
    });

    it('finds nothing with no caret at all', () => {
      const host = editable(`a<span></span>${NBSP}b`);

      window.getSelection()?.removeAllRanges();

      expect(findNbspAfterEmptyInline(host)).toBeNull();
    });

    it('finds nothing when nothing empty stands between the caret and the space', () => {
      const host = editable(`a<b>x</b>${NBSP}c`);
      const [first] = textNodes(host);

      putCaret(first, 1);

      expect(findNbspAfterEmptyInline(host)).toBeNull();
    });
  });
});
