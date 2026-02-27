import { describe, it, expect, afterEach } from 'vitest';
import {
  isMarkTag,
  findMarkElement,
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
});
