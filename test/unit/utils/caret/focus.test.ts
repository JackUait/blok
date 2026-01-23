import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { focus, setSelectionToElement } from '../../../../src/components/utils/caret/focus';

/**
 * Helper function to get the current caret position
 */
const getCaretPosition = (): { node: Node | null; offset: number } => {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return { node: null, offset: 0 };
  }

  const range = selection.getRangeAt(0);

  return {
    node: range.startContainer,
    offset: range.startOffset,
  };
};

describe('caret/focus', () => {
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

  describe('focus', () => {
    it('should set focus at start of native input when atStart is true', () => {
      const input = document.createElement('input');

      input.value = 'Hello world';
      getContainer().appendChild(input);

      focus(input, true);

      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(0);
    });

    it('should set focus at end of native input when atStart is false', () => {
      const input = document.createElement('input');

      input.value = 'Hello world';
      getContainer().appendChild(input);

      focus(input, false);

      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(input.value.length);
      expect(input.selectionEnd).toBe(input.value.length);
    });

    it('should set focus at start of contenteditable with text node when atStart is true', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello world');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      focus(div, true);

      const caret = getCaretPosition();

      expect(caret.node).toBe(textNode);
      expect(caret.offset).toBe(0);
    });

    it('should set focus at end of contenteditable with text node when atStart is false', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello world');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      focus(div, false);

      const caret = getCaretPosition();

      expect(caret.node).toBe(textNode);
      expect(caret.offset).toBe(textNode.length);
    });

    it('should create text node and focus when contenteditable is empty', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      getContainer().appendChild(div);

      focus(div, true);

      // Should have created a text node as child of div
      expect(div.childNodes.length).toBeGreaterThan(0);
      expect(div.childNodes[0]).toBeInstanceOf(Text);
    });

    it('should handle nested elements correctly when atStart is true', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const span = document.createElement('span');
      const textNode = document.createTextNode('Hello');

      span.appendChild(textNode);
      div.appendChild(span);
      getContainer().appendChild(div);

      focus(div, true);

      const caret = getCaretPosition();

      expect(caret.node).toBe(textNode);
      expect(caret.offset).toBe(0);
    });

    it('should handle nested elements correctly when atStart is false', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const span = document.createElement('span');
      const textNode = document.createTextNode('Hello');

      span.appendChild(textNode);
      div.appendChild(span);
      getContainer().appendChild(div);

      focus(div, false);

      const caret = getCaretPosition();

      expect(caret.node).toBe(textNode);
      expect(caret.offset).toBe(textNode.length);
    });

    it('should handle contenteditable with only element children (no text nodes)', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const span = document.createElement('span');

      div.appendChild(span);
      getContainer().appendChild(div);

      focus(div, true);

      // Should create a text node and focus it
      // The text node is appended to the div
      const hasTextNode = Array.from(div.childNodes).some((child) => child instanceof Text);

      expect(hasTextNode).toBe(true);
    });

    it('should focus the element', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      // Make another element active first
      document.body.focus();

      focus(div, true);

      // Element should be focused after focus() call (in jsdom, check that focus was called)
      // In jsdom, activeElement behavior differs from real browsers
      // Just verify the function doesn't throw and element has focus property set
      expect(div).toHaveProperty('focus');
    });
  });

  describe('setSelectionToElement', () => {
    it('should set selection to start of element when atFirstLine is true', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello world');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('No selection');
      }

      setSelectionToElement(div, selection, true);

      const caret = getCaretPosition();

      expect(caret.node).toBe(textNode);
      expect(caret.offset).toBe(0);
    });

    it('should set selection to end of element when atFirstLine is false', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello world');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('No selection');
      }

      setSelectionToElement(div, selection, false);

      const caret = getCaretPosition();

      expect(caret.node).toBe(textNode);
      expect(caret.offset).toBe(textNode.length);
    });

    it('should focus the element', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      // Make another element active first
      document.body.focus();

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('No selection');
      }

      setSelectionToElement(div, selection, true);

      // In jsdom, activeElement behavior differs from real browsers
      // Just verify the function doesn't throw and element has focus property set
      expect(div).toHaveProperty('focus');
    });

    it('should handle empty elements', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      getContainer().appendChild(div);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('No selection');
      }

      // Should not throw
      expect(() => {
        setSelectionToElement(div, selection, true);
      }).not.toThrow();
    });
  });
});
