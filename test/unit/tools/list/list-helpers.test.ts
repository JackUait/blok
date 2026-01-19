import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getContentElement,
  updateCheckboxState,
  adjustDepthTo,
  getBulletCharacter,
} from '../../../../src/tools/list/list-helpers';
import type { ListMarkerCalculator } from '../../../../src/tools/list/marker-calculator';

describe('list-helpers', () => {
  describe('getContentElement', () => {
    it('returns null when element is null', () => {
      const result = getContentElement(null, 'unordered');

      expect(result).toBeNull();
    });

    it('returns contenteditable element for checklist style', () => {
      const element = document.createElement('div');
      const contentEl = document.createElement('div');
      // Need to set the attribute since querySelector looks for attributes
      contentEl.setAttribute('contenteditable', 'true');
      element.appendChild(contentEl);

      const result = getContentElement(element, 'checklist');

      expect(result).toBe(contentEl);
    });

    it('returns content container for non-checklist styles', () => {
      const element = document.createElement('div');
      const contentContainer = document.createElement('div');
      contentContainer.setAttribute('data-blok-testid', 'list-content-container');
      element.appendChild(contentContainer);

      const result = getContentElement(element, 'unordered');

      expect(result).toBe(contentContainer);
    });

    it('returns null when contenteditable not found for checklist', () => {
      const element = document.createElement('div');
      const regularDiv = document.createElement('div');
      element.appendChild(regularDiv);

      const result = getContentElement(element, 'checklist');

      expect(result).toBeNull();
    });

    it('returns null when content container not found for non-checklist', () => {
      const element = document.createElement('div');
      const regularDiv = document.createElement('div');
      regularDiv.setAttribute('data-blok-testid', 'some-other-id');
      element.appendChild(regularDiv);

      const result = getContentElement(element, 'unordered');

      expect(result).toBeNull();
    });

    it('handles ordered list style', () => {
      const element = document.createElement('div');
      const contentContainer = document.createElement('div');
      contentContainer.setAttribute('data-blok-testid', 'list-content-container');
      element.appendChild(contentContainer);

      const result = getContentElement(element, 'ordered');

      expect(result).toBe(contentContainer);
    });
  });

  describe('updateCheckboxState', () => {
    it('returns early when element is null', () => {
      updateCheckboxState(null, true);

      // Should not throw
      expect(true).toBe(true);
    });

    it('updates checkbox checked state to true', () => {
      const element = document.createElement('div');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      element.appendChild(checkbox);

      updateCheckboxState(element, true);

      expect(checkbox.checked).toBe(true);
    });

    it('updates checkbox checked state to false', () => {
      const element = document.createElement('div');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      element.appendChild(checkbox);

      updateCheckboxState(element, false);

      expect(checkbox.checked).toBe(false);
    });

    it('does nothing when checkbox not found', () => {
      const element = document.createElement('div');

      // Should not throw
      expect(() => updateCheckboxState(element, true)).not.toThrow();
    });

    it('only targets input[type="checkbox"] elements', () => {
      const element = document.createElement('div');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;

      const textInput = document.createElement('input');
      textInput.type = 'text';

      element.appendChild(checkbox);
      element.appendChild(textInput);

      updateCheckboxState(element, true);

      expect(checkbox.checked).toBe(true);
      expect(textInput.checked).toBe(false); // Text input doesn't have checked property
    });
  });

  describe('adjustDepthTo', () => {
    it('sets data-list-depth attribute on element', () => {
      const element = document.createElement('div');
      const data = { depth: 0 };

      adjustDepthTo(element, data, 2);

      expect(element).toHaveAttribute('data-list-depth', '2');
    });

    it('does not throw when element is null', () => {
      const data = { depth: 0 };

      expect(() => adjustDepthTo(null, data, 1)).not.toThrow();
    });

    it('updates data.depth property', () => {
      const element = document.createElement('div');
      const data = { depth: 0 };

      adjustDepthTo(element, data, 3);

      expect(data.depth).toBe(3);
    });

    it('sets marginLeft on listitem element', () => {
      const element = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      element.appendChild(listItem);
      const data = { depth: 0 };

      adjustDepthTo(element, data, 2);

      expect(listItem.style.marginLeft).toBe('48px');
    });

    it('clears marginLeft when depth is 0', () => {
      const element = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      listItem.style.marginLeft = '48px';
      element.appendChild(listItem);
      const data = { depth: 2 };

      adjustDepthTo(element, data, 0);

      expect(listItem.style.marginLeft).toBe('');
    });

    it('clears marginLeft when newDepth is 0', () => {
      const element = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      listItem.style.marginLeft = '24px';
      element.appendChild(listItem);
      const data = { depth: 1 };

      adjustDepthTo(element, data, 0);

      expect(listItem.style.marginLeft).toBe('');
    });

    it('handles when listitem element is not found', () => {
      const element = document.createElement('div');
      const data = { depth: 0 };

      // Should not throw
      expect(() => adjustDepthTo(element, data, 1)).not.toThrow();
    });

    it('calculates correct marginLeft for various depths', () => {
      const element = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      element.appendChild(listItem);

      for (let depth = 1; depth <= 5; depth++) {
        const data = { depth: 0 };
        adjustDepthTo(element, data, depth);
        const expectedMargin = `${depth * 24}px`;
        expect(listItem.style.marginLeft).toBe(expectedMargin);
      }
    });

    it('handles negative depth values (clears marginLeft since depth is not > 0)', () => {
      const element = document.createElement('div');
      const listItem = document.createElement('div');
      listItem.setAttribute('role', 'listitem');
      element.appendChild(listItem);
      const data = { depth: 0 };

      adjustDepthTo(element, data, -1);

      expect(element).toHaveAttribute('data-list-depth', '-1');
      // marginLeft is cleared (set to empty string) when newDepth <= 0
      expect(listItem.style.marginLeft).toBe('');
    });
  });

  describe('getBulletCharacter', () => {
    let mockMarkerCalculator: ListMarkerCalculator;

    beforeEach(() => {
      mockMarkerCalculator = {
        getBulletCharacter: vi.fn((depth: number) => {
          const bullets = ['•', '◦', '▪'];
          return bullets[depth % 3];
        }),
        getSiblingIndex: vi.fn(),
        getGroupStartValue: vi.fn(),
        formatNumber: vi.fn(),
        findGroupStart: vi.fn(),
        findFirstItemIndex: vi.fn(),
        getBlockStartValue: vi.fn(),
        getBlockStyle: vi.fn(),
      } as unknown as ListMarkerCalculator;
    });

    it('delegates to markerCalculator.getBulletCharacter', () => {
      mockMarkerCalculator.getBulletCharacter = vi.fn((depth: number) => {
        const bullets = ['•', '◦', '▪'];
        return bullets[depth % 3];
      });

      const result = getBulletCharacter(1, mockMarkerCalculator);

      expect(mockMarkerCalculator.getBulletCharacter).toHaveBeenCalledWith(1);
      expect(result).toBe('◦');
    });

    it('returns bullet at depth 0', () => {
      const result = getBulletCharacter(0, mockMarkerCalculator);

      expect(result).toBe('•');
    });

    it('returns white bullet at depth 1', () => {
      const result = getBulletCharacter(1, mockMarkerCalculator);

      expect(result).toBe('◦');
    });

    it('returns square at depth 2', () => {
      const result = getBulletCharacter(2, mockMarkerCalculator);

      expect(result).toBe('▪');
    });

    it('cycles bullets at depth 3', () => {
      const result = getBulletCharacter(3, mockMarkerCalculator);

      expect(result).toBe('•');
    });

    it('handles deeper depths', () => {
      expect(getBulletCharacter(4, mockMarkerCalculator)).toBe('◦');
      expect(getBulletCharacter(5, mockMarkerCalculator)).toBe('▪');
      expect(getBulletCharacter(6, mockMarkerCalculator)).toBe('•');
    });
  });
});
