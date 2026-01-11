import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isBoldTag } from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

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
});
