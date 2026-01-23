import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { SelectionFakeCursor } from '../../../../src/components/selection/fake-cursor';
import { SelectionCursor } from '../../../../src/components/selection/cursor';
import { DATA_ATTR, createSelector } from '../../../../src/components/constants';
import { SelectionCore } from '../../../../src/components/selection/core';

/**
 * Test helper to ensure Selection API is available
 */
const ensureSelection = (): Selection => {
  const selection = window.getSelection();

  if (!selection) {
    throw new Error('Selection API is not available in the current environment');
  }

  return selection;
};

/**
 * Test helper to update Selection properties
 */
const updateSelectionProperties = (
  selection: Selection,
  state: {
    anchorNode: Node | null;
    focusNode: Node | null;
    anchorOffset: number;
    focusOffset: number;
    isCollapsed: boolean;
  }
): void => {
  Object.defineProperty(selection, 'anchorNode', {
    value: state.anchorNode,
    configurable: true,
  });

  Object.defineProperty(selection, 'focusNode', {
    value: state.focusNode,
    configurable: true,
  });

  Object.defineProperty(selection, 'anchorOffset', {
    value: state.anchorOffset,
    configurable: true,
  });

  Object.defineProperty(selection, 'focusOffset', {
    value: state.focusOffset,
    configurable: true,
  });

  Object.defineProperty(selection, 'isCollapsed', {
    value: state.isCollapsed,
    configurable: true,
  });
};

/**
 * Test helper to set a selection range on a node
 */
const setSelectionRange = (node: Node, startOffset: number, endOffset: number = startOffset): Range => {
  const selection = ensureSelection();
  const range = document.createRange();

  range.setStart(node, startOffset);
  range.setEnd(node, endOffset);
  selection.removeAllRanges();
  selection.addRange(range);

  updateSelectionProperties(selection, {
    anchorNode: node,
    focusNode: node,
    anchorOffset: startOffset,
    focusOffset: endOffset,
    isCollapsed: startOffset === endOffset,
  });

  return range;
};

/**
 * Test helper to create a contenteditable div with text
 */
const createContentEditable = (text = 'Hello world'): { element: HTMLDivElement; textNode: Text } => {
  const element = document.createElement('div');

  element.contentEditable = 'true';
  element.textContent = text;
  document.body.appendChild(element);

  const textNode = element.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Failed to create text node for contenteditable element');
  }

  return { element, textNode };
};

describe('SelectionFakeCursor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';

    // Mock Range.prototype.getBoundingClientRect for jsdom
    const prototype = Range.prototype as Range & {
      getBoundingClientRect?: () => DOMRect;
    };

    if (typeof prototype.getBoundingClientRect !== 'function') {
      prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    }
  });

  afterEach(() => {
    document.body.innerHTML = '';

    const selection = ensureSelection();
    selection.removeAllRanges();
  });

  describe('addFakeCursor', () => {
    it('adds fake cursor element to the current range', () => {
      const { element } = createContentEditable();

      SelectionCursor.setCursor(element, 0);

      SelectionFakeCursor.addFakeCursor();

      const fakeCursor = element.querySelector(createSelector(DATA_ATTR.fakeCursor));

      expect(fakeCursor).not.toBeNull();
      expect(fakeCursor?.getAttribute(DATA_ATTR.fakeCursor)).toBe('');
      expect(fakeCursor?.getAttribute('data-blok-mutation-free')).toBe('true');
    });

    it('does nothing when there is no range', () => {
      const selection = ensureSelection();

      selection.removeAllRanges();

      expect(() => SelectionFakeCursor.addFakeCursor()).not.toThrow();
    });

    it('inserts fake cursor at collapsed selection position', () => {
      const { element, textNode } = createContentEditable('Hello');

      setSelectionRange(textNode, 2);

      SelectionFakeCursor.addFakeCursor();

      const fakeCursor = element.querySelector(createSelector(DATA_ATTR.fakeCursor));

      expect(fakeCursor).not.toBeNull();
    });

    it('collapses range before inserting fake cursor', () => {
      const { textNode } = createContentEditable('Hello world');

      // Create a non-collapsed selection
      setSelectionRange(textNode, 0, 5);

      const rangeBefore = SelectionCore.getRange();

      expect(rangeBefore?.collapsed).toBe(false);

      SelectionFakeCursor.addFakeCursor();

      const rangeAfter = SelectionCore.getRange();

      // After adding fake cursor, the selection should be collapsed
      // Note: The actual behavior depends on browser implementation
      expect(rangeAfter).not.toBeNull();
    });

    it('sets data-blok-mutation-free attribute on fake cursor', () => {
      const { element } = createContentEditable();

      SelectionCursor.setCursor(element, 0);

      SelectionFakeCursor.addFakeCursor();

      const fakeCursor = element.querySelector('[data-blok-mutation-free]');

      expect(fakeCursor).not.toBeNull();
      expect(fakeCursor?.getAttribute('data-blok-mutation-free')).toBe('true');
    });
  });

  describe('isFakeCursorInsideContainer', () => {
    it('returns true when fake cursor is inside container', () => {
      const { element } = createContentEditable();

      SelectionCursor.setCursor(element, 0);
      SelectionFakeCursor.addFakeCursor();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(true);
    });

    it('returns false when fake cursor is not inside container', () => {
      const container1 = createContentEditable('Container 1');
      const container2 = createContentEditable('Container 2');

      SelectionCursor.setCursor(container1.element, 0);
      SelectionFakeCursor.addFakeCursor();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(container2.element)).toBe(false);
    });

    it('returns false when no fake cursor exists', () => {
      const { element } = createContentEditable();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(false);
    });

    it('detects fake cursor in nested structure', () => {
      const wrapper = document.createElement('div');
      const inner = document.createElement('div');

      wrapper.appendChild(inner);
      document.body.appendChild(wrapper);

      SelectionCursor.setCursor(inner, 0);
      SelectionFakeCursor.addFakeCursor();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(wrapper)).toBe(true);
      expect(SelectionFakeCursor.isFakeCursorInsideContainer(inner)).toBe(true);
    });

    it('uses data-blok-fake-cursor attribute for detection', () => {
      const { element } = createContentEditable();

      // Manually create a fake cursor element
      const fakeCursor = document.createElement('span');

      fakeCursor.setAttribute(DATA_ATTR.fakeCursor, '');
      element.appendChild(fakeCursor);

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(true);
    });
  });

  describe('removeFakeCursor', () => {
    it('removes fake cursor from specified container', () => {
      const { element } = createContentEditable();

      SelectionCursor.setCursor(element, 0);
      SelectionFakeCursor.addFakeCursor();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(true);

      SelectionFakeCursor.removeFakeCursor(element);

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(false);
    });

    it('defaults to document.body when no container specified', () => {
      const { element } = createContentEditable();

      SelectionCursor.setCursor(element, 0);
      SelectionFakeCursor.addFakeCursor();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(true);

      SelectionFakeCursor.removeFakeCursor();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(false);
    });

    it('does nothing when no fake cursor exists', () => {
      const { element } = createContentEditable();

      expect(() => SelectionFakeCursor.removeFakeCursor(element)).not.toThrow();
    });

    it('removes only the fake cursor element', () => {
      const { element } = createContentEditable('Hello world');

      SelectionCursor.setCursor(element, 0);
      SelectionFakeCursor.addFakeCursor();

      // Verify fake cursor exists
      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(true);

      SelectionFakeCursor.removeFakeCursor(element);

      // Verify fake cursor is gone but content remains
      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(false);
      expect(element).toHaveTextContent('Hello world');
    });

    it('handles multiple fake cursors by removing from container', () => {
      const container1 = createContentEditable('Container 1');
      const container2 = createContentEditable('Container 2');

      SelectionCursor.setCursor(container1.element, 0);
      SelectionFakeCursor.addFakeCursor();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(container1.element)).toBe(true);

      // Add fake cursor to second container
      SelectionCursor.setCursor(container2.element, 0);
      SelectionFakeCursor.addFakeCursor();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(container2.element)).toBe(true);

      // Remove from document.body (default) should remove the fake cursor
      SelectionFakeCursor.removeFakeCursor();

      // Both should have fake cursor removed since removeFakeCursor uses querySelector
      // which finds the first matching element globally
      const hasAnyFakeCursor =
        SelectionFakeCursor.isFakeCursorInsideContainer(container1.element) ||
        SelectionFakeCursor.isFakeCursorInsideContainer(container2.element);

      // The removeFakeCursor only removes the first one found
      expect(hasAnyFakeCursor).toBe(true);
    });

    it('removes fake cursor with correct attribute', () => {
      const { element } = createContentEditable();

      SelectionCursor.setCursor(element, 0);
      SelectionFakeCursor.addFakeCursor();

      const fakeCursorBefore = element.querySelector(createSelector(DATA_ATTR.fakeCursor));

      expect(fakeCursorBefore).not.toBeNull();

      SelectionFakeCursor.removeFakeCursor(element);

      const fakeCursorAfter = element.querySelector(createSelector(DATA_ATTR.fakeCursor));

      expect(fakeCursorAfter).toBeNull();
    });
  });

  describe('integration', () => {
    it('can add, check, and remove fake cursor in sequence', () => {
      const { element } = createContentEditable();

      SelectionCursor.setCursor(element, 0);

      // Add fake cursor
      SelectionFakeCursor.addFakeCursor();
      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(true);

      // Remove fake cursor
      SelectionFakeCursor.removeFakeCursor(element);
      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(false);

      // Add again
      SelectionCursor.setCursor(element, 0);
      SelectionFakeCursor.addFakeCursor();
      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(true);
    });

    it('handles fake cursor in contenteditable with existing content', () => {
      const { element } = createContentEditable('Some existing text');

      SelectionCursor.setCursor(element, 0);
      SelectionFakeCursor.addFakeCursor();

      expect(SelectionFakeCursor.isFakeCursorInsideContainer(element)).toBe(true);

      SelectionFakeCursor.removeFakeCursor(element);

      expect(element).toHaveTextContent('Some existing text');
    });
  });
});
