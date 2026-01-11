import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRangeTextWalker } from '../../../../../src/components/inline-tools/utils/formatting-range-utils';

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
      expect(textNodes[0].textContent).toBe('Hello ');
      expect(textNodes[1].textContent).toBe('bold');
      expect(textNodes[2].textContent).toBe(' world');
    });

    it('only includes text nodes intersecting the range', () => {
      const container = document.createElement('div');
      container.innerHTML = 'Before <span>Inside</span> After';
      document.body.appendChild(container);

      const span = container.querySelector('span')!;
      const range = document.createRange();
      range.selectNodeContents(span);

      const walker = createRangeTextWalker(range);
      const textNodes: Text[] = [];

      while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text);
      }

      expect(textNodes).toHaveLength(1);
      expect(textNodes[0].textContent).toBe('Inside');
    });
  });
});
