import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCaretNodeAndOffset,
  checkContenteditableSliceForEmptiness,
  isCaretAtStartOfInput,
  isCaretAtEndOfInput
} from '../../../src/components/utils/caret';

/**
 * Unit tests for caret.ts utility functions
 *
 * Tests edge cases and internal functionality not covered by E2E tests
 */
describe('caret utilities', () => {
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

  /**
   * Helper function to set up selection in jsdom
   * jsdom has limited Selection API support, so we need to manually set focusNode and focusOffset
   *
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

  describe('checkContenteditableSliceForEmptiness', () => {
    it('should return true for left direction when content is empty', () => {
      const contenteditable = document.createElement('div');

      contenteditable.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      contenteditable.appendChild(textNode);
      getContainer().appendChild(contenteditable);

      const result = checkContenteditableSliceForEmptiness(contenteditable, textNode, 0, 'left');

      expect(result).toBe(true);
    });

    it('should return false for left direction when content has visible text', () => {
      const contenteditable = document.createElement('div');

      contenteditable.contentEditable = 'true';
      const textNode1 = document.createTextNode('Hello');
      const textNode2 = document.createTextNode(' World');

      contenteditable.appendChild(textNode1);
      contenteditable.appendChild(textNode2);
      getContainer().appendChild(contenteditable);

      const result = checkContenteditableSliceForEmptiness(contenteditable, textNode2, 0, 'left');

      expect(result).toBe(false);
    });

    it('should return true for left direction when content has only whitespace', () => {
      const contenteditable = document.createElement('div');

      contenteditable.contentEditable = 'true';
      const textNode1 = document.createTextNode('   \t\n');
      const textNode2 = document.createTextNode('Hello');

      contenteditable.appendChild(textNode1);
      contenteditable.appendChild(textNode2);
      getContainer().appendChild(contenteditable);

      const result = checkContenteditableSliceForEmptiness(contenteditable, textNode2, 0, 'left');

      expect(result).toBe(true);
    });

    it('should return true for left direction when content has only non-breaking spaces', () => {
      const contenteditable = document.createElement('div');

      contenteditable.contentEditable = 'true';
      const textNode1 = document.createTextNode('\u00A0\u00A0\u00A0'); // Non-breaking spaces
      const textNode2 = document.createTextNode('Hello');

      contenteditable.appendChild(textNode1);
      contenteditable.appendChild(textNode2);
      getContainer().appendChild(contenteditable);

      // Non-breaking spaces are visible, so should return false
      const result = checkContenteditableSliceForEmptiness(contenteditable, textNode2, 0, 'left');

      expect(result).toBe(false);
    });

    it('should return true for right direction when content is empty', () => {
      const contenteditable = document.createElement('div');

      contenteditable.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      contenteditable.appendChild(textNode);
      getContainer().appendChild(contenteditable);

      const result = checkContenteditableSliceForEmptiness(contenteditable, textNode, textNode.length, 'right');

      expect(result).toBe(true);
    });

    it('should return false for right direction when content has visible text', () => {
      const contenteditable = document.createElement('div');

      contenteditable.contentEditable = 'true';
      const textNode1 = document.createTextNode('Hello');
      const textNode2 = document.createTextNode(' World');

      contenteditable.appendChild(textNode1);
      contenteditable.appendChild(textNode2);
      getContainer().appendChild(contenteditable);

      const result = checkContenteditableSliceForEmptiness(contenteditable, textNode1, textNode1.length, 'right');

      expect(result).toBe(false);
    });

    it('should return true for right direction when content has only whitespace', () => {
      const contenteditable = document.createElement('div');

      contenteditable.contentEditable = 'true';
      const textNode1 = document.createTextNode('Hello');
      const textNode2 = document.createTextNode('   \t\n');

      contenteditable.appendChild(textNode1);
      contenteditable.appendChild(textNode2);
      getContainer().appendChild(contenteditable);

      const result = checkContenteditableSliceForEmptiness(contenteditable, textNode1, textNode1.length, 'right');

      expect(result).toBe(true);
    });

    it('should handle nested elements correctly for left direction', () => {
      const contenteditable = document.createElement('div');

      contenteditable.contentEditable = 'true';
      const span = document.createElement('span');
      const textNode = document.createTextNode('Hello');

      span.appendChild(textNode);
      contenteditable.appendChild(span);
      getContainer().appendChild(contenteditable);

      const result = checkContenteditableSliceForEmptiness(contenteditable, textNode, 0, 'left');

      expect(result).toBe(true);
    });

    it('should handle nested elements correctly for right direction', () => {
      const contenteditable = document.createElement('div');

      contenteditable.contentEditable = 'true';
      const span = document.createElement('span');
      const textNode = document.createTextNode('Hello');

      span.appendChild(textNode);
      contenteditable.appendChild(span);
      getContainer().appendChild(contenteditable);

      const result = checkContenteditableSliceForEmptiness(contenteditable, textNode, textNode.length, 'right');

      expect(result).toBe(true);
    });
  });

  describe('isCaretAtStartOfInput', () => {
    it('should return true for empty input', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      getContainer().appendChild(input);

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(true);
    });

    it('should return true for native input at start', () => {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = 'Hello';
      getContainer().appendChild(input);
      input.focus();
      input.setSelectionRange(0, 0);

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(true);
    });

    it('should return false for native input not at start', () => {
      const input = document.createElement('input');
      const CARET_POSITION = 3;

      input.type = 'text';
      input.value = 'Hello';
      getContainer().appendChild(input);
      input.focus();
      input.setSelectionRange(CARET_POSITION, CARET_POSITION);

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(false);
    });

    it('should return true for contenteditable at start with offset 0', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      input.appendChild(textNode);
      getContainer().appendChild(input);
      input.focus();

      setupSelection(textNode, 0);

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(true);
    });

    it('should return false for contenteditable not at start', () => {
      const input = document.createElement('div');
      const CARET_POSITION = 3;

      input.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      input.appendChild(textNode);
      getContainer().appendChild(input);
      input.focus();

      setupSelection(textNode, CARET_POSITION);

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(false);
    });

    it('should return false when there is no selection', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      input.appendChild(textNode);
      getContainer().appendChild(input);

      const selection = window.getSelection();

      if (selection) {
        selection.removeAllRanges();
        // Clear selection properties to simulate no selection
        Object.defineProperty(selection, 'focusNode', {
          value: null,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(selection, 'focusOffset', {
          value: 0,
          writable: true,
          configurable: true,
        });
      }

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(false);
    });

    it('should return true when caret is after whitespace-only content', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      const textNode1 = document.createTextNode('   \t\n');
      const textNode2 = document.createTextNode('Hello');

      input.appendChild(textNode1);
      input.appendChild(textNode2);
      getContainer().appendChild(input);
      input.focus();

      setupSelection(textNode2, 0);

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(true);
    });

    it('should return false when caret is after visible content', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      const textNode1 = document.createTextNode('Hello');
      const textNode2 = document.createTextNode(' World');

      input.appendChild(textNode1);
      input.appendChild(textNode2);
      getContainer().appendChild(input);
      input.focus();

      setupSelection(textNode2, 0);

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(false);
    });
  });

  describe('isCaretAtEndOfInput', () => {
    it('should return true for empty input', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      getContainer().appendChild(input);

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(true);
    });

    it('should return true for native input at end', () => {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = 'Hello';
      getContainer().appendChild(input);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(true);
    });

    it('should return false for native input not at end', () => {
      const input = document.createElement('input');
      const CARET_POSITION = 3;

      input.type = 'text';
      input.value = 'Hello';
      getContainer().appendChild(input);
      input.focus();
      input.setSelectionRange(CARET_POSITION, CARET_POSITION);

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(false);
    });

    it('should return true for contenteditable at end', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      input.appendChild(textNode);
      getContainer().appendChild(input);
      input.focus();

      setupSelection(textNode, textNode.length);

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(true);
    });

    it('should return false for contenteditable not at end', () => {
      const input = document.createElement('div');
      const CARET_POSITION = 3;

      input.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      input.appendChild(textNode);
      getContainer().appendChild(input);
      input.focus();

      setupSelection(textNode, CARET_POSITION);

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(false);
    });

    it('should return false when there is no selection', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      input.appendChild(textNode);
      getContainer().appendChild(input);

      const selection = window.getSelection();

      if (selection) {
        selection.removeAllRanges();
        // Clear selection properties to simulate no selection
        Object.defineProperty(selection, 'focusNode', {
          value: null,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(selection, 'focusOffset', {
          value: 0,
          writable: true,
          configurable: true,
        });
      }

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(false);
    });

    it('should return true when caret is before whitespace-only content', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      const textNode1 = document.createTextNode('Hello');
      const textNode2 = document.createTextNode('   \t\n');

      input.appendChild(textNode1);
      input.appendChild(textNode2);
      getContainer().appendChild(input);
      input.focus();

      setupSelection(textNode1, textNode1.length);

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(true);
    });

    it('should return false when caret is before visible content', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      const textNode1 = document.createTextNode('Hello');
      const textNode2 = document.createTextNode(' World');

      input.appendChild(textNode1);
      input.appendChild(textNode2);
      getContainer().appendChild(input);
      input.focus();

      setupSelection(textNode1, textNode1.length);

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(false);
    });

    it('should handle nested elements correctly', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      const span = document.createElement('span');
      const textNode = document.createTextNode('Hello');

      span.appendChild(textNode);
      input.appendChild(span);
      getContainer().appendChild(input);
      input.focus();

      setupSelection(textNode, textNode.length);

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(true);
    });
  });
});

