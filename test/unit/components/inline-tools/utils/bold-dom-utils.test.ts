import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isBoldTag, isBoldElement, isElementEmpty } from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

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
});
