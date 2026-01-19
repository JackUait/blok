import { describe, it, expect } from 'vitest';
import {
  getMarginLeftFromElement,
  getOffsetFromDepthAttribute,
  getContentOffset,
} from '../../../../src/tools/list/content-offset';

describe('content-offset', () => {
  describe('getMarginLeftFromElement', () => {
    it('returns undefined when element is null', () => {
      const result = getMarginLeftFromElement(null);

      expect(result).toBeUndefined();
    });

    it('returns undefined when element has no style attribute', () => {
      const element = document.createElement('div');

      const result = getMarginLeftFromElement(element);

      expect(result).toBeUndefined();
    });

    it('returns undefined when style has no margin-left', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'color: red; padding: 10px;');

      const result = getMarginLeftFromElement(element);

      expect(result).toBeUndefined();
    });

    it('returns left offset when margin-left is positive', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-left: 24px;');

      const result = getMarginLeftFromElement(element);

      expect(result).toEqual({ left: 24 });
    });

    it('returns left offset for large margin values', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-left: 72px;');

      const result = getMarginLeftFromElement(element);

      expect(result).toEqual({ left: 72 });
    });

    it('returns undefined when margin-left is zero', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-left: 0px;');

      const result = getMarginLeftFromElement(element);

      expect(result).toBeUndefined();
    });

    it('returns undefined when margin-left is negative', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-left: -10px;');

      const result = getMarginLeftFromElement(element);

      expect(result).toBeUndefined();
    });

    it('extracts margin-left from style with multiple properties', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'color: blue; margin-left: 48px; padding: 5px;');

      const result = getMarginLeftFromElement(element);

      expect(result).toEqual({ left: 48 });
    });

    it('handles margin-left with spaces', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-left:  36px  ;');

      const result = getMarginLeftFromElement(element);

      expect(result).toEqual({ left: 36 });
    });

    it('handles margin-left with px unit (standard format)', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-left: 24px;');

      const result = getMarginLeftFromElement(element);

      expect(result).toEqual({ left: 24 });
    });
  });

  describe('getOffsetFromDepthAttribute', () => {
    it('returns undefined when element has no data-list-depth attribute', () => {
      const element = document.createElement('div');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toBeUndefined();
    });

    it('returns undefined when data-list-depth is null', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', '0');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toBeUndefined();
    });

    it('returns undefined when data-list-depth is 0', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', '0');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toBeUndefined();
    });

    it('returns left offset for depth 1', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', '1');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toEqual({ left: 24 });
    });

    it('returns left offset for depth 2', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', '2');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toEqual({ left: 48 });
    });

    it('returns left offset for depth 3', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', '3');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toEqual({ left: 72 });
    });

    it('finds data-list-depth on ancestor element', () => {
      const parent = document.createElement('div');
      parent.setAttribute('data-list-depth', '2');
      const child = document.createElement('span');
      parent.appendChild(child);

      const result = getOffsetFromDepthAttribute(child);

      expect(result).toEqual({ left: 48 });
    });

    it('handles negative depth values', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', '-1');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toBeUndefined();
    });

    it('handles non-numeric depth values', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', 'abc');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toBeUndefined(); // parseInt returns NaN
    });
  });

  describe('getContentOffset', () => {
    it('returns undefined when element has no listitem in ancestors or descendants', () => {
      const element = document.createElement('div');

      const result = getContentOffset(element);

      expect(result).toBeUndefined();
    });

    it('finds listitem in ancestors (when hovering content)', () => {
      const wrapper = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      listItem.style.marginLeft = '24px';
      const content = document.createElement('span');
      content.textContent = 'Text';

      wrapper.appendChild(listItem);
      listItem.appendChild(content);

      const result = getContentOffset(content);

      expect(result).toEqual({ left: 24 });
    });

    it('finds listitem in descendants (when hovering wrapper)', () => {
      const wrapper = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      listItem.style.marginLeft = '48px';
      const content = document.createElement('span');

      wrapper.appendChild(listItem);
      listItem.appendChild(content);

      const result = getContentOffset(wrapper);

      expect(result).toEqual({ left: 48 });
    });

    it('returns undefined when listitem has no margin-left', () => {
      const wrapper = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      const content = document.createElement('span');

      wrapper.appendChild(listItem);
      listItem.appendChild(content);

      const result = getContentOffset(content);

      expect(result).toBeUndefined();
    });

    it('falls back to data-list-depth attribute when margin-left not found', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-list-depth', '2');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      // No margin-left
      const content = document.createElement('span');

      wrapper.appendChild(listItem);
      listItem.appendChild(content);

      const result = getContentOffset(content);

      expect(result).toEqual({ left: 48 });
    });

    it('prioritizes margin-left over data-list-depth attribute', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-list-depth', '3');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      listItem.style.marginLeft = '24px';
      const content = document.createElement('span');

      wrapper.appendChild(listItem);
      listItem.appendChild(content);

      const result = getContentOffset(content);

      expect(result).toEqual({ left: 24 }); // margin-left takes priority
    });

    it('handles deeply nested content structure', () => {
      const wrapper = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      listItem.style.marginLeft = '72px';
      const innerDiv = document.createElement('div');
      const span = document.createElement('span');
      const text = document.createTextNode('Text');

      wrapper.appendChild(listItem);
      listItem.appendChild(innerDiv);
      innerDiv.appendChild(span);
      span.appendChild(text);

      const result = getContentOffset(text.parentElement as Element);

      expect(result).toEqual({ left: 72 });
    });

    it('returns undefined when hovering element with no relationship to list', () => {
      const unrelated = document.createElement('div');
      const text = document.createTextNode('Unrelated text');
      unrelated.appendChild(text);

      const result = getContentOffset(unrelated);

      expect(result).toBeUndefined();
    });

    it('finds closest listitem when multiple exist in hierarchy', () => {
      const outerWrapper = document.createElement('div');
      const outerListItem = document.createElement('div');
      outerListItem.setAttribute('role', 'listitem');
      outerListItem.style.marginLeft = '24px';

      const innerListItem = document.createElement('div');
      innerListItem.setAttribute('role', 'listitem');
      innerListItem.style.marginLeft = '48px';

      const content = document.createElement('span');

      outerWrapper.appendChild(outerListItem);
      outerListItem.appendChild(innerListItem);
      innerListItem.appendChild(content);

      const result = getContentOffset(content);

      // closest() finds the nearest ancestor, which is innerListItem
      expect(result).toEqual({ left: 48 });
    });
  });
});
