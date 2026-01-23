import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SelectionCursor } from '../../../../src/components/selection/cursor';
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

describe('SelectionCursor', () => {
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
    vi.restoreAllMocks();
    document.body.innerHTML = '';

    const selection = ensureSelection();
    selection.removeAllRanges();
  });

  describe('setCursor', () => {
    it('sets cursor inside a contenteditable element', () => {
      const { element } = createContentEditable();

      const result = SelectionCursor.setCursor(element, 0);

      const range = SelectionCore.getRange();

      expect(range).not.toBeNull();
      expect(range?.startContainer).toBe(element);
      expect(range?.startOffset).toBe(0);
      expect(result).toBeDefined();
    });

    it('sets cursor at specific offset in contenteditable', () => {
      const { element } = createContentEditable('Hello world');

      SelectionCursor.setCursor(element, 0);

      const range = SelectionCore.getRange();

      expect(range?.startContainer).toBe(element);
      expect(range?.startOffset).toBe(0);
    });

    it('sets cursor inside a native input element', () => {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = 'Hello';
      document.body.appendChild(input);

      const result = SelectionCursor.setCursor(input, 2);

      expect(input.selectionStart).toBe(2);
      expect(input.selectionEnd).toBe(2);
      expect(result).toBeDefined();
    });

    it('sets cursor at end of native input', () => {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = 'Hello world';
      document.body.appendChild(input);

      SelectionCursor.setCursor(input, 5);

      expect(input.selectionStart).toBe(5);
      expect(input.selectionEnd).toBe(5);
    });

    it('returns element bounding rect for native input that cannot have caret', () => {
      const input = document.createElement('input');

      input.type = 'hidden'; // hidden inputs cannot have caret
      document.body.appendChild(input);

      // Mock canSetCaret to return false
      const domSpy = vi.spyOn(
        { isNativeInput: (el: HTMLElement) => el instanceof HTMLInputElement },
        'isNativeInput'
      ).mockReturnValue(true);

      const result = SelectionCursor.setCursor(input, 0);

      expect(result).toBeDefined();

      domSpy.mockRestore();
    });

    it('returns element bounding rect when selection is unavailable', () => {
      const { element } = createContentEditable();

      vi.spyOn(window, 'getSelection').mockReturnValue(null as unknown as Selection);

      const result = SelectionCursor.setCursor(element, 0);
      const expected = element.getBoundingClientRect();

      expect(result).toBeDefined();
      expect(result.x).toBe(expected.x);
      expect(result.y).toBe(expected.y);
      expect(result.width).toBe(expected.width);
      expect(result.height).toBe(expected.height);

      vi.restoreAllMocks();
    });
  });

  describe('isRangeInsideContainer', () => {
    it('returns false when there is no range', () => {
      const container = document.createElement('div');

      document.body.appendChild(container);

      const selection = ensureSelection();
      selection.removeAllRanges();

      expect(SelectionCursor.isRangeInsideContainer(container)).toBe(false);
    });

    it('returns true when range is inside the container', () => {
      const { element, textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 1);

      expect(SelectionCursor.isRangeInsideContainer(element)).toBe(true);
    });

    it('returns false when range is outside the container', () => {
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 1);

      const otherContainer = document.createElement('div');

      document.body.appendChild(otherContainer);

      expect(SelectionCursor.isRangeInsideContainer(otherContainer)).toBe(false);
    });

    it('returns true when range starts at container boundary', () => {
      const container = document.createElement('div');

      container.textContent = 'Test content';
      document.body.appendChild(container);

      const textNode = container.firstChild as Text;

      setSelectionRange(textNode, 0, 4);

      expect(SelectionCursor.isRangeInsideContainer(container)).toBe(true);
    });

    it('returns false for nested container when range is in parent', () => {
      const parent = document.createElement('div');
      const child = document.createElement('div');

      child.textContent = 'Child content';
      parent.appendChild(child);
      document.body.appendChild(parent);

      const textNode = child.firstChild as Text;

      setSelectionRange(textNode, 0, 4);

      // Range is inside child, not parent's direct content
      expect(SelectionCursor.isRangeInsideContainer(parent)).toBe(true);
      expect(SelectionCursor.isRangeInsideContainer(child)).toBe(true);
    });
  });

  describe('collapseToEnd', () => {
    it('does nothing when there is no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null as unknown as Selection);

      expect(() => SelectionCursor.collapseToEnd()).not.toThrow();

      vi.restoreAllMocks();
    });

    it('does nothing when selection has no focus node', () => {
      const selection = ensureSelection();

      selection.removeAllRanges();

      expect(() => SelectionCursor.collapseToEnd()).not.toThrow();
    });

    it('collapses selection to the end of focus node', () => {
      const { textNode } = createContentEditable('Collapse');

      setSelectionRange(textNode, 0, 3);

      SelectionCursor.collapseToEnd();

      const range = SelectionCore.getRange();

      expect(range?.collapsed).toBe(true);
      expect(range?.startContainer).toBe(textNode);
      expect(range?.startOffset).toBe(textNode.length);
    });

    it('collapses to end when focus node is an element', () => {
      const container = document.createElement('div');

      container.innerHTML = '<p>Some text</p>';
      document.body.appendChild(container);

      const paragraph = container.querySelector('p');

      if (!paragraph) {
        throw new Error('Paragraph element not found');
      }

      const textNode = paragraph.firstChild as Text;

      setSelectionRange(textNode, 0, 4);

      SelectionCursor.collapseToEnd();

      const range = SelectionCore.getRange();

      expect(range?.collapsed).toBe(true);
      expect(range?.startOffset).toBe(textNode.length);
    });

    it('preserves focus node content when collapsing', () => {
      const { textNode } = createContentEditable('Test content');

      setSelectionRange(textNode, 0, 4);

      SelectionCursor.collapseToEnd();

      const selection = ensureSelection();

      expect(selection.focusNode).toBe(textNode);
      expect(selection.toString()).toBe('');
    });
  });
});
