import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isElementVisuallyEmpty,
  ensureInlineRemovalObserver,
  findNbspAfterEmptyInline,
  whitespaceFollowingRemovedEmptyInline
} from '../../../../src/components/utils/caret/inline-removal';

/**
 * Helper function to set up selection in jsdom
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

describe('caret/inline-removal', () => {
  const containerState = { element: null as HTMLElement | null };

  beforeEach(() => {
    containerState.element = document.createElement('div');
    document.body.appendChild(containerState.element);
    // Note: WeakSet doesn't have a clear() method, entries will be garbage collected
    // when the text nodes are no longer referenced
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

  describe('isElementVisuallyEmpty', () => {
    it('should return true for an element with no children', () => {
      const span = document.createElement('span');

      getContainer().appendChild(span);

      expect(isElementVisuallyEmpty(span)).toBe(true);
    });

    it('should return false for single tag elements like img', () => {
      const img = document.createElement('img');

      getContainer().appendChild(img);

      expect(isElementVisuallyEmpty(img)).toBe(false);
    });

    it('should return false for native input elements', () => {
      const input = document.createElement('input');

      getContainer().appendChild(input);

      expect(isElementVisuallyEmpty(input)).toBe(false);
    });

    it('should return false for element with NBSP character', () => {
      const span = document.createElement('span');
      const textNode = document.createTextNode('\u00A0'); // NBSP

      span.appendChild(textNode);
      getContainer().appendChild(span);

      expect(isElementVisuallyEmpty(span)).toBe(false);
    });

    it('should return false for element with visible text', () => {
      const span = document.createElement('span');
      const textNode = document.createTextNode('Hello');

      span.appendChild(textNode);
      getContainer().appendChild(span);

      expect(isElementVisuallyEmpty(span)).toBe(false);
    });

    it('should return true for element with only whitespace', () => {
      const span = document.createElement('span');
      const textNode = document.createTextNode('   \t\n');

      span.appendChild(textNode);
      getContainer().appendChild(span);

      expect(isElementVisuallyEmpty(span)).toBe(true);
    });

    it('should return true for nested empty elements', () => {
      const outer = document.createElement('span');
      const inner = document.createElement('b');

      outer.appendChild(inner);
      getContainer().appendChild(outer);

      expect(isElementVisuallyEmpty(outer)).toBe(true);
    });

    it('should return false if nested element has visible content', () => {
      const outer = document.createElement('span');
      const inner = document.createElement('b');
      const textNode = document.createTextNode('Text');

      inner.appendChild(textNode);
      outer.appendChild(inner);
      getContainer().appendChild(outer);

      expect(isElementVisuallyEmpty(outer)).toBe(false);
    });

    it('should return false for BR elements', () => {
      const div = document.createElement('div');
      const br = document.createElement('br');

      div.appendChild(br);
      getContainer().appendChild(div);

      // BR is a single tag but isLineBreakTag returns true, which means it's not empty
      expect(isElementVisuallyEmpty(div)).toBe(false);
    });
  });

  describe('ensureInlineRemovalObserver', () => {
    it('should not throw when called with a document', () => {
      expect(() => {
        ensureInlineRemovalObserver(document);
      }).not.toThrow();
    });

    it('should not start observing if already observing the document', () => {
      ensureInlineRemovalObserver(document);
      // Second call should be a no-op
      expect(() => {
        ensureInlineRemovalObserver(document);
      }).not.toThrow();
    });

    it('should handle document with null body during loading', () => {
      const doc = document.implementation.createHTMLDocument('test');

      // Mock readyState as loading
      Object.defineProperty(doc, 'readyState', {
        value: 'loading',
        writable: true,
        configurable: true,
      });

      expect(() => {
        ensureInlineRemovalObserver(doc);
      }).not.toThrow();
    });
  });

  describe('findNbspAfterEmptyInline', () => {
    it('should return null when caret node is null', () => {
      window.getSelection()?.removeAllRanges();

      const div = document.createElement('div');

      getContainer().appendChild(div);

      const result = findNbspAfterEmptyInline(div);

      expect(result).toBe(null);
    });

    it('should return null when caret is not within root', () => {
      const textNode = document.createTextNode('Hello');

      getContainer().appendChild(textNode);
      setupSelection(textNode, 2);

      const outsideDiv = document.createElement('div');

      document.body.appendChild(outsideDiv);

      const result = findNbspAfterEmptyInline(outsideDiv);

      expect(result).toBe(null);

      outsideDiv.remove();
    });

    it('should return null when caret is not at end of text node', () => {
      const div = document.createElement('div');
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);
      setupSelection(textNode, 2); // Not at end

      const result = findNbspAfterEmptyInline(div);

      expect(result).toBe(null);
    });

    it('should return null when next text node does not start with whitespace', () => {
      const div = document.createElement('div');
      const textNode1 = document.createTextNode('Hello');
      const textNode2 = document.createTextNode('World');

      div.appendChild(textNode1);
      div.appendChild(textNode2);
      getContainer().appendChild(div);
      setupSelection(textNode1, textNode1.length);

      const result = findNbspAfterEmptyInline(div);

      expect(result).toBe(null);
    });

    it('should find NBSP after empty inline was removed', () => {
      const div = document.createElement('div');
      const textNode1 = document.createTextNode('Hello');
      const nbspTextNode = document.createTextNode('\u00A0World');

      div.appendChild(textNode1);
      div.appendChild(nbspTextNode);
      getContainer().appendChild(div);

      // Manually add to WeakSet to simulate empty inline removal
      whitespaceFollowingRemovedEmptyInline.add(nbspTextNode);

      setupSelection(textNode1, textNode1.length);

      const result = findNbspAfterEmptyInline(div);

      expect(result).not.toBeNull();
      expect(result?.node).toBe(nbspTextNode);
      expect(result?.offset).toBe(0);
    });

    it('should find regular space after empty inline was removed', () => {
      const div = document.createElement('div');
      const textNode1 = document.createTextNode('Hello');
      const spaceTextNode = document.createTextNode(' World');

      div.appendChild(textNode1);
      div.appendChild(spaceTextNode);
      getContainer().appendChild(div);

      // Manually add to WeakSet to simulate empty inline removal
      whitespaceFollowingRemovedEmptyInline.add(spaceTextNode);

      setupSelection(textNode1, textNode1.length);

      const result = findNbspAfterEmptyInline(div);

      expect(result).not.toBeNull();
      expect(result?.node).toBe(spaceTextNode);
      expect(result?.offset).toBe(0);
    });

    it('should remove entry from WeakSet after finding NBSP', () => {
      const div = document.createElement('div');
      const textNode1 = document.createTextNode('Hello');
      const nbspTextNode = document.createTextNode('\u00A0World');

      div.appendChild(textNode1);
      div.appendChild(nbspTextNode);
      getContainer().appendChild(div);

      // Add to WeakSet
      whitespaceFollowingRemovedEmptyInline.add(nbspTextNode);

      setupSelection(textNode1, textNode1.length);

      const result1 = findNbspAfterEmptyInline(div);

      expect(result1).not.toBeNull();

      // Should not find it again since WeakSet entry was removed
      const result2 = findNbspAfterEmptyInline(div);

      expect(result2).toBeNull();
    });

    it('should skip empty text nodes', () => {
      const div = document.createElement('div');
      const textNode1 = document.createTextNode('Hello');
      const emptyTextNode = document.createTextNode('');
      const nbspTextNode = document.createTextNode('\u00A0World');

      div.appendChild(textNode1);
      div.appendChild(emptyTextNode);
      div.appendChild(nbspTextNode);
      getContainer().appendChild(div);

      // Add to WeakSet
      whitespaceFollowingRemovedEmptyInline.add(nbspTextNode);

      setupSelection(textNode1, textNode1.length);

      const result = findNbspAfterEmptyInline(div);

      expect(result).not.toBeNull();
      expect(result?.node).toBe(nbspTextNode);
    });
  });

  describe('whitespaceFollowingRemovedEmptyInline WeakSet', () => {
    it('should be a WeakSet', () => {
      expect(whitespaceFollowingRemovedEmptyInline).toBeInstanceOf(WeakSet);
    });

    it('should allow adding and removing text nodes', () => {
      const textNode = document.createTextNode('test');

      whitespaceFollowingRemovedEmptyInline.add(textNode);
      expect(whitespaceFollowingRemovedEmptyInline.has(textNode)).toBe(true);

      whitespaceFollowingRemovedEmptyInline.delete(textNode);
      expect(whitespaceFollowingRemovedEmptyInline.has(textNode)).toBe(false);
    });
  });
});
