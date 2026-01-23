import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getCaretNodeAndOffset, getCaretOffset } from '../../../../src/components/utils/caret/selection';

/**
 * Helper function to set up selection in jsdom
 * jsdom has limited Selection API support, so we need to manually set focusNode and focusOffset
 * @param node - The node where the selection should be set
 * @param offset - The offset within the node where the selection should be set
 */
const setupSelection = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.setEnd(node, offset);

  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  selection.removeAllRanges();
  selection.addRange(range);

  // jsdom doesn't properly set focusNode/focusOffset, so we need to set them manually
  Object.defineProperty(selection, 'focusNode', {
    value: node,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(selection, 'focusOffset', {
    value: offset,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(selection, 'anchorNode', {
    value: node,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(selection, 'anchorOffset', {
    value: offset,
    writable: true,
    configurable: true,
  });

  // Focus the element if it's an HTMLElement
  if (node.nodeType === Node.ELEMENT_NODE) {
    (node as HTMLElement).focus?.();
  } else if (node.parentElement) {
    node.parentElement.focus?.();
  }
};

describe('caret/selection', () => {
  const containerState = { element: null as HTMLElement | null };

  beforeEach(() => {
    containerState.element = document.createElement('div');
    document.body.appendChild(containerState.element);
  });

  afterEach(() => {
    // Clear selection
    window.getSelection()?.removeAllRanges();
    if (containerState.element) {
      containerState.element.remove();
      containerState.element = null;
    }
  });

  const getContainer = (): HTMLElement => {
    if (!containerState.element) {
      throw new Error('Container not initialized');
    }

    return containerState.element;
  };

  describe('getCaretNodeAndOffset', () => {
    it('should return [null, 0] when selection is null', () => {
      // Mock window.getSelection to return null
      const originalGetSelection = window.getSelection;

      window.getSelection = () => null;

      const result = getCaretNodeAndOffset();

      expect(result).toEqual([null, 0]);

      window.getSelection = originalGetSelection;
    });

    it('should return [null, 0] when focusNode is null', () => {
      const selection = window.getSelection();

      if (!selection) {
        return;
      }

      // Create a mock selection with null focusNode
      const range = document.createRange();
      const textNode = document.createTextNode('test');

      getContainer().appendChild(textNode);
      range.setStart(textNode, 0);
      range.setEnd(textNode, 0);
      selection.removeAllRanges();
      selection.addRange(range);

      // Manually set focusNode to null (simulating edge case)
      Object.defineProperty(selection, 'focusNode', {
        value: null,
        writable: true,
        configurable: true,
      });

      const result = getCaretNodeAndOffset();

      expect(result).toEqual([null, 0]);
    });

    it('should return text node and offset when focusNode is a text node', () => {
      const textNode = document.createTextNode('Hello world');

      const CARET_OFFSET = 5;

      getContainer().appendChild(textNode);
      getContainer().focus();

      setupSelection(textNode, CARET_OFFSET);

      const [node, offset] = getCaretNodeAndOffset();

      expect(node).toBe(textNode);
      expect(offset).toBe(CARET_OFFSET);
    });

    it('should return child node when focusNode is an element with children', () => {
      const div = document.createElement('div');
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);
      div.focus();

      setupSelection(div, 0);

      const [node, offset] = getCaretNodeAndOffset();

      expect(node).toBe(textNode);
      expect(offset).toBe(0);
    });

    it('should handle Firefox edge case when focusOffset is 1 with single child', () => {
      const div = document.createElement('div');
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);
      div.focus();

      setupSelection(div, 1);

      const [node, offset] = getCaretNodeAndOffset();

      expect(node).toBe(textNode);
      expect(offset).toBe(textNode.textContent?.length ?? 0);
    });

    it('should return element and offset when element has no children', () => {
      const div = document.createElement('div');

      getContainer().appendChild(div);
      div.focus();

      setupSelection(div, 0);

      const [node, offset] = getCaretNodeAndOffset();

      expect(node).toBe(div);
      expect(offset).toBe(0);
    });
  });

  describe('getCaretOffset', () => {
    it('should return 0 when no selection exists', () => {
      window.getSelection()?.removeAllRanges();

      const result = getCaretOffset();

      expect(result).toBe(0);
    });

    it('should return character offset within contenteditable', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      div.innerHTML = 'Hello World';
      getContainer().appendChild(div);

      const textNode = div.firstChild;

      if (!(textNode instanceof Text)) {
        throw new Error('Expected text node');
      }

      // Set caret after "Hello" (offset 5)
      const range = document.createRange();

      range.setStart(textNode, 5);
      range.collapse(true);

      const selection = window.getSelection();

      if (selection === null) {
        throw new Error('Expected selection');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      const result = getCaretOffset(div);

      expect(result).toBe(5);
    });

    it('should return 0 when container is not provided and cannot be found', () => {
      // Create a selection outside of any contenteditable
      const div = document.createElement('div');

      div.textContent = 'Test';
      getContainer().appendChild(div);

      const textNode = div.firstChild;

      if (!(textNode instanceof Text)) {
        throw new Error('Expected text node');
      }

      const range = document.createRange();

      range.setStart(textNode, 2);
      range.collapse(true);

      const selection = window.getSelection();

      if (selection === null) {
        throw new Error('Expected selection');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      // Don't pass a container - should return 0 since no contenteditable found
      const result = getCaretOffset();

      expect(result).toBe(0);
    });
  });
});
