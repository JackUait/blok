import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRangeTextWalker,
  findFormattingAncestor,
  hasFormattingAncestor,
  isRangeFormatted,
  collectFormattingAncestors,
} from '../../../../../src/components/inline-tools/utils/formatting-range-utils';

describe('formatting-range-utils', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('createRangeTextWalker', () => {
    it('returns a TreeWalker that iterates text nodes in range', () => {
      const container = document.createElement('div');
      container.innerHTML = 'Hello <strong>bold</strong> world';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const walker = createRangeTextWalker(range);
      const textNodes: Text[] = [];

      while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text);
      }

      expect(textNodes).toHaveLength(3);
      expect(textNodes[0]).toHaveTextContent('Hello ', {normalizeWhitespace: false});
      expect(textNodes[1]).toHaveTextContent('bold');
      expect(textNodes[2]).toHaveTextContent(' world', {normalizeWhitespace: false});
    });

    it('only includes text nodes intersecting the range', () => {
      const container = document.createElement('div');
      container.innerHTML = 'Before <span>Inside</span> After';
      document.body.appendChild(container);

      const span = container.querySelector('span');
      if (!span) {
        throw new Error('span element not found');
      }
      const range = document.createRange();
      range.selectNodeContents(span);

      const walker = createRangeTextWalker(range);
      const textNodes: Text[] = [];

      while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text);
      }

      expect(textNodes).toHaveLength(1);
      expect(textNodes[0]).toHaveTextContent('Inside');
    });
  });

  describe('findFormattingAncestor', () => {
    it('finds ancestor matching predicate', () => {
      const container = document.createElement('div');
      container.innerHTML = '<strong>bold text</strong>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong');
      if (!strong?.firstChild) {
        throw new Error('strong element or its firstChild not found');
      }
      const textNode = strong.firstChild;
      const isBold = (el: Element) => el.tagName === 'STRONG' || el.tagName === 'B';

      const result = findFormattingAncestor(textNode, isBold);

      expect(result).not.toBeNull();
      expect(result?.tagName).toBe('STRONG');
    });

    it('returns null when no ancestor matches', () => {
      const container = document.createElement('div');
      container.innerHTML = '<span>plain text</span>';
      document.body.appendChild(container);

      const span = container.querySelector('span');
      if (!span?.firstChild) {
        throw new Error('span element or its firstChild not found');
      }
      const textNode = span.firstChild;
      const isBold = (el: Element) => el.tagName === 'STRONG' || el.tagName === 'B';

      const result = findFormattingAncestor(textNode, isBold);

      expect(result).toBeNull();
    });

    it('returns null for null input', () => {
      const isBold = (el: Element) => el.tagName === 'STRONG';

      expect(findFormattingAncestor(null, isBold)).toBeNull();
    });

    it('returns the element itself if it matches predicate', () => {
      const strong = document.createElement('strong');
      document.body.appendChild(strong);

      const isBold = (el: Element) => el.tagName === 'STRONG';

      const result = findFormattingAncestor(strong, isBold);

      expect(result).toBe(strong);
    });
  });

  describe('hasFormattingAncestor', () => {
    it('returns true when ancestor matches predicate', () => {
      const container = document.createElement('div');
      container.innerHTML = '<em>italic text</em>';
      document.body.appendChild(container);

      const em = container.querySelector('em');
      if (!em?.firstChild) {
        throw new Error('em element or its firstChild not found');
      }
      const textNode = em.firstChild;
      const isItalic = (el: Element) => el.tagName === 'EM' || el.tagName === 'I';

      expect(hasFormattingAncestor(textNode, isItalic)).toBe(true);
    });

    it('returns false when no ancestor matches', () => {
      const container = document.createElement('div');
      container.innerHTML = '<span>plain</span>';
      document.body.appendChild(container);

      const span = container.querySelector('span');
      if (!span?.firstChild) {
        throw new Error('span element or its firstChild not found');
      }
      const textNode = span.firstChild;
      const isItalic = (el: Element) => el.tagName === 'EM' || el.tagName === 'I';

      expect(hasFormattingAncestor(textNode, isItalic)).toBe(false);
    });

    it('returns false for null input', () => {
      const isItalic = (el: Element) => el.tagName === 'EM';

      expect(hasFormattingAncestor(null, isItalic)).toBe(false);
    });
  });

  describe('isRangeFormatted', () => {
    const isBold = (el: Element) => el.tagName === 'STRONG' || el.tagName === 'B';

    it('returns true when all text in range is formatted', () => {
      const container = document.createElement('div');
      container.innerHTML = '<strong>all bold</strong>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong');
      if (!strong) {
        throw new Error('strong element not found');
      }
      const range = document.createRange();
      range.selectNodeContents(strong);

      expect(isRangeFormatted(range, isBold)).toBe(true);
    });

    it('returns false when some text is not formatted', () => {
      const container = document.createElement('div');
      container.innerHTML = '<strong>bold</strong> and plain';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      expect(isRangeFormatted(range, isBold)).toBe(false);
    });

    it('returns true for collapsed range inside formatted element', () => {
      const container = document.createElement('div');
      container.innerHTML = '<strong>bold</strong>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong');
      if (!strong?.firstChild) {
        throw new Error('strong element or its firstChild not found');
      }
      const textNode = strong.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.collapse(true);

      expect(isRangeFormatted(range, isBold)).toBe(true);
    });

    it('returns false for collapsed range outside formatted element', () => {
      const container = document.createElement('div');
      container.innerHTML = 'plain <strong>bold</strong>';
      document.body.appendChild(container);

      const textNode = container.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.collapse(true);

      expect(isRangeFormatted(range, isBold)).toBe(false);
    });

    it('ignores whitespace-only nodes when option is set', () => {
      const container = document.createElement('div');
      container.innerHTML = '<strong>bold</strong>   <strong>more bold</strong>';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      expect(isRangeFormatted(range, isBold, { ignoreWhitespace: true })).toBe(true);
      expect(isRangeFormatted(range, isBold, { ignoreWhitespace: false })).toBe(false);
    });

    it('returns true for empty range when start container is formatted', () => {
      const container = document.createElement('div');
      container.innerHTML = '<strong></strong>';
      document.body.appendChild(container);

      const strong = container.querySelector('strong');
      if (!strong) {
        throw new Error('strong element not found');
      }
      const range = document.createRange();
      range.selectNodeContents(strong);

      expect(isRangeFormatted(range, isBold)).toBe(true);
    });
  });

  describe('collectFormattingAncestors', () => {
    const isBold = (el: Element) => el.tagName === 'STRONG' || el.tagName === 'B';

    it('collects all unique formatting ancestors in range', () => {
      const container = document.createElement('div');
      container.innerHTML = '<strong>first</strong> text <strong>second</strong>';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const ancestors = collectFormattingAncestors(range, isBold);

      expect(ancestors).toHaveLength(2);
      expect(ancestors[0]).toHaveTextContent('first');
      expect(ancestors[1]).toHaveTextContent('second');
    });

    it('returns empty array when no formatted elements in range', () => {
      const container = document.createElement('div');
      container.innerHTML = 'plain text only';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const ancestors = collectFormattingAncestors(range, isBold);

      expect(ancestors).toHaveLength(0);
    });

    it('deduplicates ancestors when multiple text nodes share same parent', () => {
      const container = document.createElement('div');
      container.innerHTML = '<strong>part one <em>nested</em> part two</strong>';
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNodeContents(container);

      const ancestors = collectFormattingAncestors(range, isBold);

      expect(ancestors).toHaveLength(1);
      expect(ancestors[0].tagName).toBe('STRONG');
    });
  });
});
