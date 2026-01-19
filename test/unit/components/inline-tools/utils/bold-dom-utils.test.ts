import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isBoldTag,
  isBoldElement,
  isElementEmpty,
  hasBoldParent,
  findBoldElement,
  ensureTextNodeAfter,
  setCaret,
  setCaretAfterNode,
  resolveBoundary,
  isNodeWithin,
} from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

describe('bold-dom-utils', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('isBoldTag', () => {
    it('returns true for STRONG element', () => {
      const strong = document.createElement('strong');

      expect(isBoldTag(strong)).toBe(true);
    });

    it('returns true for B element', () => {
      const b = document.createElement('b');

      expect(isBoldTag(b)).toBe(true);
    });

    it('returns false for other elements', () => {
      const span = document.createElement('span');
      const div = document.createElement('div');

      expect(isBoldTag(span)).toBe(false);
      expect(isBoldTag(div)).toBe(false);
    });
  });

  describe('isBoldElement', () => {
    it('returns true for STRONG element', () => {
      const strong = document.createElement('strong');

      expect(isBoldElement(strong)).toBe(true);
    });

    it('returns true for B element', () => {
      const b = document.createElement('b');

      expect(isBoldElement(b)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isBoldElement(null)).toBe(false);
    });

    it('returns false for text nodes', () => {
      const text = document.createTextNode('hello');

      expect(isBoldElement(text)).toBe(false);
    });

    it('returns false for other elements', () => {
      const span = document.createElement('span');

      expect(isBoldElement(span)).toBe(false);
    });
  });

  describe('isElementEmpty', () => {
    it('returns true for element with no text content', () => {
      const div = document.createElement('div');

      expect(isElementEmpty(div)).toBe(true);
    });

    it('returns true for element with empty text content', () => {
      const div = document.createElement('div');

      div.textContent = '';

      expect(isElementEmpty(div)).toBe(true);
    });

    it('returns false for element with text content', () => {
      const div = document.createElement('div');

      div.textContent = 'hello';

      expect(isElementEmpty(div)).toBe(false);
    });

    it('returns false for element with nested text content', () => {
      const div = document.createElement('div');
      const span = document.createElement('span');

      span.textContent = 'nested';
      div.appendChild(span);

      expect(isElementEmpty(div)).toBe(false);
    });
  });

  describe('hasBoldParent', () => {
    it('returns true when node is inside a strong element', () => {
      const strong = document.createElement('strong');
      const text = document.createTextNode('bold');

      strong.appendChild(text);
      document.body.appendChild(strong);

      expect(hasBoldParent(text)).toBe(true);
    });

    it('returns true when node is the strong element itself', () => {
      const strong = document.createElement('strong');

      document.body.appendChild(strong);

      expect(hasBoldParent(strong)).toBe(true);
    });

    it('returns false when node has no bold ancestor', () => {
      const div = document.createElement('div');
      const text = document.createTextNode('normal');

      div.appendChild(text);
      document.body.appendChild(div);

      expect(hasBoldParent(text)).toBe(false);
    });

    it('returns false for null', () => {
      expect(hasBoldParent(null)).toBe(false);
    });
  });

  describe('findBoldElement', () => {
    it('returns the strong element when node is inside it', () => {
      const strong = document.createElement('strong');
      const text = document.createTextNode('bold');

      strong.appendChild(text);
      document.body.appendChild(strong);

      expect(findBoldElement(text)).toBe(strong);
    });

    it('returns the element itself when it is a strong', () => {
      const strong = document.createElement('strong');

      document.body.appendChild(strong);

      expect(findBoldElement(strong)).toBe(strong);
    });

    it('returns null when no bold ancestor exists', () => {
      const div = document.createElement('div');
      const text = document.createTextNode('normal');

      div.appendChild(text);
      document.body.appendChild(div);

      expect(findBoldElement(text)).toBeNull();
    });

    it('returns null for null input', () => {
      expect(findBoldElement(null)).toBeNull();
    });

    it('converts B to STRONG when found', () => {
      const b = document.createElement('b');
      const text = document.createTextNode('bold');

      b.appendChild(text);
      document.body.appendChild(b);

      const result = findBoldElement(text);

      expect(result?.tagName).toBe('STRONG');
    });
  });

  describe('ensureTextNodeAfter', () => {
    it('returns existing text node if present', () => {
      const strong = document.createElement('strong');
      const text = document.createTextNode('after');

      document.body.appendChild(strong);
      document.body.appendChild(text);

      expect(ensureTextNodeAfter(strong)).toBe(text);
    });

    it('creates new text node if none exists', () => {
      const strong = document.createElement('strong');

      document.body.appendChild(strong);

      const result = ensureTextNodeAfter(strong);

      expect(result).toBeInstanceOf(Text);
      expect(result?.textContent).toBe('');
      expect(strong.nextSibling).toBe(result);
    });

    it('creates text node between bold and element sibling', () => {
      const strong = document.createElement('strong');
      const span = document.createElement('span');

      document.body.appendChild(strong);
      document.body.appendChild(span);

      const result = ensureTextNodeAfter(strong);

      expect(result).toBeInstanceOf(Text);
      expect(strong.nextSibling).toBe(result);
      expect(result?.nextSibling).toBe(span);
    });

    it('returns null if element has no parent', () => {
      const strong = document.createElement('strong');

      expect(ensureTextNodeAfter(strong)).toBeNull();
    });
  });

  describe('setCaret', () => {
    it('places caret at specified offset in text node', () => {
      const div = document.createElement('div');
      const text = document.createTextNode('hello');

      div.appendChild(text);
      div.contentEditable = 'true';
      document.body.appendChild(div);
      div.focus();

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      setCaret(selection, text, 2);

      expect(selection.anchorNode).toBe(text);
      expect(selection.anchorOffset).toBe(2);
      expect(selection.isCollapsed).toBe(true);
    });
  });

  describe('setCaretAfterNode', () => {
    it('places caret after the specified node', () => {
      const div = document.createElement('div');
      const strong = document.createElement('strong');
      const text = document.createTextNode('after');

      strong.textContent = 'bold';
      div.appendChild(strong);
      div.appendChild(text);
      div.contentEditable = 'true';
      document.body.appendChild(div);
      div.focus();

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      setCaretAfterNode(selection, strong);

      expect(selection.anchorNode).toBe(div);
      expect(selection.anchorOffset).toBe(1);
      expect(selection.isCollapsed).toBe(true);
    });

    it('does nothing for null node', () => {
      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }
      const initialRangeCount = selection.rangeCount;

      setCaretAfterNode(selection, null);

      expect(selection.rangeCount).toBe(initialRangeCount);
    });
  });

  describe('resolveBoundary', () => {
    it('returns aligned boundary when still connected', () => {
      const strong = document.createElement('strong');
      const boundary = document.createTextNode('after');

      strong.textContent = 'bold';
      document.body.appendChild(strong);
      document.body.appendChild(boundary);

      const result = resolveBoundary({ boundary, boldElement: strong });

      expect(result?.boundary).toBe(boundary);
      expect(result?.boldElement).toBe(strong);
    });

    it('returns null when bold element is disconnected', () => {
      const strong = document.createElement('strong');
      const boundary = document.createTextNode('after');

      strong.textContent = 'bold';
      // Not connected to document

      const result = resolveBoundary({ boundary, boldElement: strong });

      expect(result).toBeNull();
    });

    it('creates new boundary when original is misaligned', () => {
      const strong = document.createElement('strong');
      const boundary = document.createTextNode('misaligned');

      strong.textContent = 'bold';
      document.body.appendChild(strong);
      document.body.appendChild(document.createElement('span'));
      document.body.appendChild(boundary);

      const result = resolveBoundary({ boundary, boldElement: strong });

      expect(result?.boundary).not.toBe(boundary);
      expect(result?.boundary.previousSibling).toBe(strong);
    });
  });

  describe('isNodeWithin', () => {
    it('returns true when target equals container', () => {
      const div = document.createElement('div');

      expect(isNodeWithin(div, div)).toBe(true);
    });

    it('returns true when target is descendant of container', () => {
      const div = document.createElement('div');
      const span = document.createElement('span');
      const text = document.createTextNode('hello');

      span.appendChild(text);
      div.appendChild(span);

      expect(isNodeWithin(text, div)).toBe(true);
      expect(isNodeWithin(span, div)).toBe(true);
    });

    it('returns false when target is not within container', () => {
      const div1 = document.createElement('div');
      const div2 = document.createElement('div');

      expect(isNodeWithin(div1, div2)).toBe(false);
    });

    it('returns false for null target', () => {
      const div = document.createElement('div');

      expect(isNodeWithin(null, div)).toBe(false);
    });
  });
});
