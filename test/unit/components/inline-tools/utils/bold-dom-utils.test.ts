import {
  isBoldElement,
  isNodeWithin,
} from '../../../../../src/components/inline-tools/utils/bold-dom-utils';

describe('bold-dom-utils', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
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
