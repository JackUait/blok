import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { FakeBackgroundManager } from '../../../../../src/components/selection/fake-background/index';
import type { SelectionUtilsState } from '../../../../../src/components/selection/fake-background/index';

/**
 * Test helper to create nested HTML structure
 */
const createNestedStructure = (html: string): HTMLElement => {
  const container = document.createElement('div');

  container.innerHTML = html;
  document.body.appendChild(container);

  return container;
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
  const selection = window.getSelection();

  if (!selection) {
    throw new Error('Selection API is not available');
  }

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
 * Test helper to create a mock SelectionUtilsState
 */
const createMockState = (): SelectionUtilsState => {
  return {
    savedSelectionRange: null,
    isFakeBackgroundEnabled: false,
  };
};

describe('FakeBackgroundManager', () => {
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

    const selection = window.getSelection();

    selection?.removeAllRanges();
  });

  describe('constructor', () => {
    it('stores reference to SelectionUtilsState', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      // The manager should have access to the state
      expect(manager).toBeDefined();
    });

    it('works with null initial state', () => {
      const mockState: SelectionUtilsState = {
        savedSelectionRange: null,
        isFakeBackgroundEnabled: false,
      };
      const manager = new FakeBackgroundManager(mockState);

      expect(manager).toBeDefined();
      expect(mockState.isFakeBackgroundEnabled).toBe(false);
    });
  });

  describe('setFakeBackground', () => {
    it('does nothing when selection API is unavailable', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      vi.spyOn(window, 'getSelection').mockReturnValue(null as unknown as Selection);

      manager.setFakeBackground();

      expect(mockState.isFakeBackgroundEnabled).toBe(false);
    });

    it('does nothing when selection has no ranges', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);
      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Selection API is not available');
      }

      selection.removeAllRanges();

      manager.setFakeBackground();

      expect(mockState.isFakeBackgroundEnabled).toBe(false);
    });

    it('does nothing for collapsed selection', () => {
      const container = createNestedStructure('<p>Test content</p>');

      const paragraph = container.querySelector('p');

      if (!paragraph?.firstChild || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected text node');
      }

      setSelectionRange(paragraph.firstChild, 2); // Collapsed at position 2

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();

      expect(mockState.isFakeBackgroundEnabled).toBe(false);
    });

    it('removes existing fake background before setting new one', () => {
      // Use two separate paragraphs to avoid text node manipulation complexity
      const container = createNestedStructure('<p>First text here</p><p>Second text here</p>');

      const paragraphs = container.querySelectorAll('p');

      if (
        !paragraphs[0]?.firstChild ||
        !paragraphs[1]?.firstChild ||
        !(paragraphs[0].firstChild instanceof Text) ||
        !(paragraphs[1].firstChild instanceof Text)
      ) {
        throw new Error('Expected text nodes');
      }

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      // First call on first paragraph
      setSelectionRange(paragraphs[0].firstChild, 0, 5);
      manager.setFakeBackground();

      const firstWrappers = document.querySelectorAll('[data-blok-fake-background]');
      expect(firstWrappers.length).toBeGreaterThan(0);

      // Second call on second paragraph
      setSelectionRange(paragraphs[1].firstChild, 0, 6);
      manager.setFakeBackground();

      // Should have wrappers from both calls (or cleaned up and replaced)
      const allWrappers = document.querySelectorAll('[data-blok-fake-background]');
      expect(allWrappers.length).toBeGreaterThan(0);
    });

    it('sets isFakeBackgroundEnabled to true when successful', () => {
      const container = createNestedStructure('<p>Selected text</p>');

      const paragraph = container.querySelector('p');

      if (!paragraph?.firstChild || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 8);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();

      expect(mockState.isFakeBackgroundEnabled).toBe(true);
    });

    it('creates wrapper spans with correct attributes', () => {
      const container = createNestedStructure('<p>Highlight this</p>');

      const paragraph = container.querySelector('p');

      if (!paragraph?.firstChild || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 9);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();

      const wrappers = document.querySelectorAll('[data-blok-fake-background]');
      expect(wrappers.length).toBeGreaterThan(0);

      wrappers.forEach((wrapper) => {
        expect(wrapper).toHaveAttribute('data-blok-fake-background', 'true');
        expect(wrapper).toHaveAttribute('data-blok-mutation-free', 'true');
      });
    });

    it('saves visual range to savedSelectionRange', () => {
      const container = createNestedStructure('<p>Text to select</p>');

      const paragraph = container.querySelector('p');

      if (!paragraph?.firstChild || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 4);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();

      expect(mockState.savedSelectionRange).not.toBeNull();
    });

    it('does not enable fake background when no text nodes are collected', () => {
      // Create a scenario where text node collection returns empty
      const container = createNestedStructure('<p></p>');

      const paragraph = container.querySelector('p');

      if (!paragraph) {
        throw new Error('Expected paragraph');
      }

      // Select the empty paragraph
      const range = document.createRange();

      range.selectNodeContents(paragraph);

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Selection API is not available');
      }

      selection.removeAllRanges();
      selection.addRange(range);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();

      // Should not enable when there's no content
      expect(mockState.isFakeBackgroundEnabled).toBe(false);
    });

    it('handles selection across multiple elements', () => {
      const container = createNestedStructure('<p>First</p><p>Second</p>');

      const paragraphs = container.querySelectorAll('p');

      if (
        !paragraphs[0]?.firstChild ||
        !paragraphs[1]?.firstChild ||
        !(paragraphs[0].firstChild instanceof Text) ||
        !(paragraphs[1].firstChild instanceof Text)
      ) {
        throw new Error('Expected text nodes');
      }

      const selection = window.getSelection();

      if (!selection) {
        throw new Error('Selection API is not available');
      }

      const range = document.createRange();

      range.setStart(paragraphs[0].firstChild, 0);
      range.setEnd(paragraphs[1].firstChild, 6);
      selection.removeAllRanges();
      selection.addRange(range);

      updateSelectionProperties(selection, {
        anchorNode: paragraphs[0].firstChild,
        focusNode: paragraphs[1].firstChild,
        anchorOffset: 0,
        focusOffset: 6,
        isCollapsed: false,
      });

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();

      // Should create wrappers for text in both paragraphs
      const wrappers = document.querySelectorAll('[data-blok-fake-background]');
      expect(wrappers.length).toBeGreaterThan(0);
    });
  });

  describe('removeFakeBackground', () => {
    it('removes all fake background elements from DOM', () => {
      const container = createNestedStructure('<p>Text to highlight</p>');

      const paragraph = container.querySelector('p');

      if (!paragraph?.firstChild || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 4);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      // Set fake background first
      mockState.isFakeBackgroundEnabled = true;
      manager.setFakeBackground();

      expect(document.querySelector('[data-blok-fake-background]')).not.toBeNull();

      // Now remove it
      manager.removeFakeBackground();

      expect(document.querySelector('[data-blok-fake-background]')).toBeNull();
    });

    it('sets isFakeBackgroundEnabled to false', () => {
      const container = createNestedStructure('<p>Text</p>');

      const paragraph = container.querySelector('p');

      if (!paragraph?.firstChild || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 4);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();
      expect(mockState.isFakeBackgroundEnabled).toBe(true);

      manager.removeFakeBackground();
      expect(mockState.isFakeBackgroundEnabled).toBe(false);
    });

    it('calls removeOrphanedFakeBackgroundElements', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      const spy = vi.spyOn(manager, 'removeOrphanedFakeBackgroundElements');

      manager.removeFakeBackground();

      expect(spy).toHaveBeenCalled();
    });

    it('does nothing when isFakeBackgroundEnabled is false', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      // Initially false
      expect(mockState.isFakeBackgroundEnabled).toBe(false);

      // Should not throw
      expect(() => manager.removeFakeBackground()).not.toThrow();
    });

    it('preserves text content when removing wrappers', () => {
      const container = createNestedStructure('<p>Important text here</p>');

      const paragraph = container.querySelector('p');

      if (!paragraph?.firstChild || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 14);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();
      manager.removeFakeBackground();

      expect(paragraph).toHaveTextContent('Important text here');
    });
  });

  describe('removeOrphanedFakeBackgroundElements', () => {
    it('removes orphaned fake background elements', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      // Manually create an orphaned element
      const orphan = document.createElement('span');

      orphan.setAttribute('data-blok-fake-background', 'true');
      orphan.textContent = 'orphaned';
      document.body.appendChild(orphan);

      expect(document.querySelector('[data-blok-fake-background="true"]')).not.toBeNull();

      manager.removeOrphanedFakeBackgroundElements();

      expect(document.querySelector('[data-blok-fake-background="true"]')).toBeNull();
      // Content should be preserved
      expect(document.body).toHaveTextContent('orphaned');
    });

    it('handles multiple orphaned elements', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      // Create multiple orphaned elements
      const orphan1 = document.createElement('span');
      const orphan2 = document.createElement('span');

      orphan1.setAttribute('data-blok-fake-background', 'true');
      orphan1.textContent = 'first';
      orphan2.setAttribute('data-blok-fake-background', 'true');
      orphan2.textContent = 'second';

      document.body.appendChild(orphan1);
      document.body.appendChild(orphan2);

      manager.removeOrphanedFakeBackgroundElements();

      expect(document.querySelectorAll('[data-blok-fake-background="true"]').length).toBe(0);
      expect(document.body).toHaveTextContent('firstsecond');
    });

    it('does nothing when no orphaned elements exist', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      expect(() => manager.removeOrphanedFakeBackgroundElements()).not.toThrow();
    });

    it('only removes elements with data-blok-fake-background="true"', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      // Create elements with similar but not matching attributes
      const elem1 = document.createElement('span');
      const elem2 = document.createElement('span');

      elem1.setAttribute('data-blok-fake-background', 'false');
      elem1.textContent = 'keep1';
      elem2.setAttribute('data-blok-something-else', 'true');
      elem2.textContent = 'keep2';

      document.body.appendChild(elem1);
      document.body.appendChild(elem2);

      manager.removeOrphanedFakeBackgroundElements();

      // These should not be removed
      expect(document.querySelector('[data-blok-fake-background="false"]')).not.toBeNull();
      expect(document.querySelector('[data-blok-something-else="true"]')).not.toBeNull();
    });
  });

  describe('clearFakeBackground', () => {
    it('removes all fake background elements', () => {
      const container = createNestedStructure('<p>Text</p>');

      const paragraph = container.querySelector('p');

      if (!paragraph?.firstChild || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 4);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();

      expect(document.querySelector('[data-blok-fake-background]')).not.toBeNull();

      manager.clearFakeBackground();

      expect(document.querySelector('[data-blok-fake-background]')).toBeNull();
    });

    it('sets isFakeBackgroundEnabled to false', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      mockState.isFakeBackgroundEnabled = true;

      manager.clearFakeBackground();

      expect(mockState.isFakeBackgroundEnabled).toBe(false);
    });

    it('works even when isFakeBackgroundEnabled is already false', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      expect(() => manager.clearFakeBackground()).not.toThrow();
      expect(mockState.isFakeBackgroundEnabled).toBe(false);
    });

    it('removes orphaned elements even when state is false', () => {
      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      // Create orphaned element
      const orphan = document.createElement('span');

      orphan.setAttribute('data-blok-fake-background', 'true');
      orphan.textContent = 'orphan';
      document.body.appendChild(orphan);

      expect(document.querySelector('[data-blok-fake-background="true"]')).not.toBeNull();

      manager.clearFakeBackground();

      expect(document.querySelector('[data-blok-fake-background="true"]')).toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('handles set-remove-set cycle', () => {
      // Use two separate elements to avoid text node manipulation complexity
      const container = createNestedStructure('<p>First paragraph</p><p>Second paragraph</p>');

      const paragraphs = container.querySelectorAll('p');

      if (
        !paragraphs[0]?.firstChild ||
        !paragraphs[1]?.firstChild ||
        !(paragraphs[0].firstChild instanceof Text) ||
        !(paragraphs[1].firstChild instanceof Text)
      ) {
        throw new Error('Expected text nodes');
      }

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      // First set
      setSelectionRange(paragraphs[0].firstChild, 0, 5);
      manager.setFakeBackground();
      expect(mockState.isFakeBackgroundEnabled).toBe(true);

      // Remove
      manager.removeFakeBackground();
      expect(mockState.isFakeBackgroundEnabled).toBe(false);

      // Second set on different element
      setSelectionRange(paragraphs[1].firstChild, 0, 6);
      manager.setFakeBackground();
      expect(mockState.isFakeBackgroundEnabled).toBe(true);
    });

    it('handles selection in nested structure', () => {
      const container = createNestedStructure(
        '<div><p>Text <strong>bold</strong> more</p></div>'
      );

      const paragraph = container.querySelector('p');
      const strong = container.querySelector('strong');

      if (!paragraph || !strong?.firstChild) {
        throw new Error('Expected elements');
      }

      if (!(strong.firstChild instanceof Text)) {
        throw new Error('Expected text node in strong');
      }

      setSelectionRange(strong.firstChild, 0, 4);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();

      expect(mockState.isFakeBackgroundEnabled).toBe(true);

      // Verify wrapper is created
      const wrappers = document.querySelectorAll('[data-blok-fake-background]');
      expect(wrappers.length).toBeGreaterThan(0);
    });

    it('clears state and DOM on clearFakeBackground', () => {
      const container = createNestedStructure('<p>Test content</p>');

      const paragraph = container.querySelector('p');

      if (!paragraph?.firstChild || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 4);

      const mockState = createMockState();
      const manager = new FakeBackgroundManager(mockState);

      manager.setFakeBackground();

      expect(mockState.isFakeBackgroundEnabled).toBe(true);
      expect(document.querySelector('[data-blok-fake-background]')).not.toBeNull();

      manager.clearFakeBackground();

      expect(mockState.isFakeBackgroundEnabled).toBe(false);
      expect(document.querySelector('[data-blok-fake-background]')).toBeNull();
    });
  });
});
