import { describe, it, expect, afterEach } from 'vitest';
import {
  isMarkTag,
  findMarkElement,
  getMarkStyle,
  buildMarkStyleString,
} from '../../../../../src/components/inline-tools/utils/marker-dom-utils';

describe('marker-dom-utils', () => {
  let container: HTMLDivElement;

  afterEach(() => {
    container?.remove();
  });

  describe('isMarkTag', () => {
    it('returns true for MARK element', () => {
      const mark = document.createElement('mark');

      expect(isMarkTag(mark)).toBe(true);
    });

    it('returns false for non-MARK element', () => {
      const span = document.createElement('span');

      expect(isMarkTag(span)).toBe(false);
    });
  });

  describe('findMarkElement', () => {
    it('finds mark ancestor from text node', () => {
      container = document.createElement('div');
      container.innerHTML = '<mark style="color: red">hello</mark>';
      document.body.appendChild(container);

      const textNode = container.querySelector('mark')!.firstChild!;

      expect(findMarkElement(textNode)).toBe(container.querySelector('mark'));
    });

    it('returns null when no mark ancestor', () => {
      container = document.createElement('div');
      container.innerHTML = '<span>hello</span>';
      document.body.appendChild(container);

      const textNode = container.querySelector('span')!.firstChild!;

      expect(findMarkElement(textNode)).toBeNull();
    });
  });

  describe('getMarkStyle', () => {
    it('extracts color from mark style', () => {
      const mark = document.createElement('mark');

      mark.style.color = '#d44c47';

      expect(getMarkStyle(mark, 'color')).toBe('rgb(212, 76, 71)');
    });

    it('extracts background-color from mark style', () => {
      const mark = document.createElement('mark');

      mark.style.backgroundColor = '#fbecdd';

      expect(getMarkStyle(mark, 'background-color')).toBe('rgb(251, 236, 221)');
    });

    it('returns empty string when style property not set', () => {
      const mark = document.createElement('mark');

      expect(getMarkStyle(mark, 'color')).toBe('');
    });
  });

  describe('buildMarkStyleString', () => {
    it('builds style with color only', () => {
      expect(buildMarkStyleString({ color: '#d44c47' })).toBe('color: #d44c47');
    });

    it('builds style with background-color only', () => {
      expect(buildMarkStyleString({ backgroundColor: '#fbecdd' })).toBe('background-color: #fbecdd');
    });

    it('builds style with both color and background-color', () => {
      const result = buildMarkStyleString({ color: '#d44c47', backgroundColor: '#fbecdd' });

      expect(result).toBe('color: #d44c47; background-color: #fbecdd');
    });

    it('returns empty string when no properties', () => {
      expect(buildMarkStyleString({})).toBe('');
    });
  });
});
