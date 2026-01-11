import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isBoldTag, isBoldElement } from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

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
});
