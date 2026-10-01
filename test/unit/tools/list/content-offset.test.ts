import { describe, it, expect, afterEach } from 'vitest';
import {
  getInlineStartMarginFromElement,
  getOffsetFromDepthAttribute,
  getContentOffset,
} from '../../../../src/tools/list/content-offset';

describe('content-offset', () => {
  describe('getInlineStartMarginFromElement', () => {
    it('returns undefined when element is null', () => {
      const result = getInlineStartMarginFromElement(null);

      expect(result).toBeUndefined();
    });

    it('returns undefined when element has no style attribute', () => {
      const element = document.createElement('div');

      const result = getInlineStartMarginFromElement(element);

      expect(result).toBeUndefined();
    });

    it('returns undefined when style has no inline-start margin', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'color: red; padding: 10px;');

      const result = getInlineStartMarginFromElement(element);

      expect(result).toBeUndefined();
    });

    it('returns the indent when inline-start margin is positive', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-inline-start: 24px;');

      const result = getInlineStartMarginFromElement(element);

      expect(result).toBe(24);
    });

    it('returns the indent for large margin values', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-inline-start: 72px;');

      const result = getInlineStartMarginFromElement(element);

      expect(result).toBe(72);
    });

    it('returns undefined when inline-start margin is zero', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-inline-start: 0px;');

      const result = getInlineStartMarginFromElement(element);

      expect(result).toBeUndefined();
    });

    it('returns undefined when inline-start margin is negative', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-inline-start: -10px;');

      const result = getInlineStartMarginFromElement(element);

      expect(result).toBeUndefined();
    });

    it('extracts inline-start margin from style with multiple properties', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'color: blue; margin-inline-start: 48px; padding: 5px;');

      const result = getInlineStartMarginFromElement(element);

      expect(result).toBe(48);
    });

    it('handles inline-start margin with spaces', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-inline-start:  36px  ;');

      const result = getInlineStartMarginFromElement(element);

      expect(result).toBe(36);
    });

    it('handles inline-start margin with px unit (standard format)', () => {
      const element = document.createElement('div');
      element.setAttribute('style', 'margin-inline-start: 24px;');

      const result = getInlineStartMarginFromElement(element);

      expect(result).toBe(24);
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

    it('returns the indent for depth 1', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', '1');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toBe(27);
    });

    it('returns the indent for depth 2', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', '2');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toBe(54);
    });

    it('returns the indent for depth 3', () => {
      const element = document.createElement('div');
      element.setAttribute('data-list-depth', '3');

      const result = getOffsetFromDepthAttribute(element);

      expect(result).toBe(81);
    });

    it('finds data-list-depth on ancestor element', () => {
      const parent = document.createElement('div');
      parent.setAttribute('data-list-depth', '2');
      const child = document.createElement('span');
      parent.appendChild(child);

      const result = getOffsetFromDepthAttribute(child);

      expect(result).toBe(54);
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
      listItem.style.marginInlineStart = '24px';
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
      listItem.style.marginInlineStart = '48px';
      const content = document.createElement('span');

      wrapper.appendChild(listItem);
      listItem.appendChild(content);

      const result = getContentOffset(wrapper);

      expect(result).toEqual({ left: 48 });
    });

    it('returns undefined when listitem has no inline-start margin', () => {
      const wrapper = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      const content = document.createElement('span');

      wrapper.appendChild(listItem);
      listItem.appendChild(content);

      const result = getContentOffset(content);

      expect(result).toBeUndefined();
    });

    it('falls back to data-list-depth attribute when inline-start margin not found', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-list-depth', '2');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      // No inline-start margin
      const content = document.createElement('span');

      wrapper.appendChild(listItem);
      listItem.appendChild(content);

      const result = getContentOffset(content);

      expect(result).toEqual({ left: 54 });
    });

    it('prioritizes inline-start margin over data-list-depth attribute', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-list-depth', '3');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      listItem.style.marginInlineStart = '24px';
      const content = document.createElement('span');

      wrapper.appendChild(listItem);
      listItem.appendChild(content);

      const result = getContentOffset(content);

      expect(result).toEqual({ left: 24 }); // inline-start margin takes priority
    });

    it('handles deeply nested content structure', () => {
      const wrapper = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      listItem.style.marginInlineStart = '72px';
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
      outerListItem.style.marginInlineStart = '24px';

      const innerListItem = document.createElement('div');
      innerListItem.setAttribute('role', 'listitem');
      innerListItem.style.marginInlineStart = '48px';

      const content = document.createElement('span');

      outerWrapper.appendChild(outerListItem);
      outerListItem.appendChild(innerListItem);
      innerListItem.appendChild(content);

      const result = getContentOffset(content);

      // closest() finds the nearest ancestor, which is innerListItem
      expect(result).toEqual({ left: 48 });
    });

    describe('reports the indent on the physical side it lies on', () => {
      const mount = (itemDir: 'ltr' | 'rtl', withMargin: boolean): HTMLElement => {
        const wrapper = document.createElement('div');
        wrapper.setAttribute('data-list-depth', '2');
        wrapper.setAttribute('dir', itemDir);
        const listItem = document.createElement('div');
        listItem.setAttribute('role', 'listitem');
        if (withMargin) {
          listItem.style.marginInlineStart = '48px';
        }
        const content = document.createElement('span');

        wrapper.appendChild(listItem);
        listItem.appendChild(content);
        document.body.appendChild(wrapper);

        return content;
      };

      afterEach(() => {
        document.body.innerHTML = '';
      });

      it('an RTL item indents from the physical right', () => {
        expect(getContentOffset(mount('rtl', true))).toStrictEqual({ left: 0, right: 48 });
      });

      it('an LTR item indents from the physical left', () => {
        expect(getContentOffset(mount('ltr', true))).toStrictEqual({ left: 48 });
      });

      it('the depth fallback of an RTL item indents from the physical right', () => {
        expect(getContentOffset(mount('rtl', false))).toStrictEqual({ left: 0, right: 54 });
      });

      it('an RTL item inside an LTR editor still indents from the right', () => {
        const editor = document.createElement('div');
        editor.setAttribute('dir', 'ltr');
        const content = mount('rtl', true);
        const item = content.closest('[data-list-depth]');

        if (item === null) {
          throw new Error('list wrapper missing');
        }
        editor.appendChild(item);
        document.body.appendChild(editor);

        expect(getContentOffset(content)).toStrictEqual({ left: 0, right: 48 });
      });
    });
  });
});
