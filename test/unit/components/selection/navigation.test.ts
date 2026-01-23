import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';
import { SelectionNavigation } from '../../../../src/components/selection/navigation';
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
 * Test helper to create nested HTML structure
 */
const createNestedStructure = (html: string): HTMLElement => {
  const container = document.createElement('div');

  container.innerHTML = html;
  document.body.appendChild(container);

  return container;
};

describe('SelectionNavigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';

    const selection = ensureSelection();
    selection.removeAllRanges();
  });

  describe('findParentTag', () => {
    it('returns null when there is no selection', () => {
      const selection = ensureSelection();

      selection.removeAllRanges();

      expect(SelectionNavigation.findParentTag('STRONG')).toBeNull();
    });

    it('returns null when selection has no anchor node', () => {
      const selection = ensureSelection();

      selection.removeAllRanges();

      // Update selection properties to simulate no selection
      updateSelectionProperties(selection, {
        anchorNode: null,
        focusNode: null,
        anchorOffset: 0,
        focusOffset: 0,
        isCollapsed: true,
      });

      expect(SelectionNavigation.findParentTag('P')).toBeNull();
    });

    it('finds parent tag by name from text node selection', () => {
      const container = createNestedStructure('<p><strong>Nested text</strong></p>');

      const strong = container.querySelector('strong');

      if (!(strong instanceof HTMLElement) || !(strong.firstChild instanceof Text)) {
        throw new Error('Expected strong element with a text node');
      }

      setSelectionRange(strong.firstChild, 0, strong.firstChild.length);

      expect(SelectionNavigation.findParentTag('STRONG')).toBe(strong);
    });

    it('finds parent tag with matching class name', () => {
      const container = createNestedStructure('<p><span class="highlight" data-blok-testid="highlight-span">Text</span></p>');

      const span = container.querySelector('[data-blok-testid="highlight-span"]');

      if (!(span instanceof HTMLElement) || !(span.firstChild instanceof Text)) {
        throw new Error('Expected span with highlight class and text node');
      }

      setSelectionRange(span.firstChild, 0, span.firstChild.length);

      expect(SelectionNavigation.findParentTag('SPAN', 'highlight')).toBe(span);
    });

    it('returns null when class name does not match', () => {
      const container = createNestedStructure('<p><span class="other" data-blok-testid="other-span">Text</span></p>');

      const span = container.querySelector('[data-blok-testid="other-span"]');

      if (!(span instanceof HTMLElement) || !(span.firstChild instanceof Text)) {
        throw new Error('Expected span element with a text node');
      }

      setSelectionRange(span.firstChild, 0, span.firstChild.length);

      expect(SelectionNavigation.findParentTag('SPAN', 'highlight')).toBeNull();
    });

    it('searches from both anchor and focus nodes', () => {
      const container = createNestedStructure('<strong>Start</strong> middle <em>End</em>');

      const strong = container.querySelector('strong');
      const em = container.querySelector('em');

      if (
        !(strong instanceof HTMLElement) ||
        !(strong.firstChild instanceof Text) ||
        !(em instanceof HTMLElement) ||
        !(em.firstChild instanceof Text)
      ) {
        throw new Error('Expected strong and em elements with text nodes');
      }

      // Create a range from strong to em
      const selection = ensureSelection();
      const range = document.createRange();

      range.setStart(strong.firstChild, 0);
      range.setEnd(em.firstChild, em.firstChild.length);
      selection.removeAllRanges();
      selection.addRange(range);

      updateSelectionProperties(selection, {
        anchorNode: strong.firstChild,
        focusNode: em.firstChild,
        anchorOffset: 0,
        focusOffset: em.firstChild.length,
        isCollapsed: false,
      });

      // Should find STRONG from anchor node
      expect(SelectionNavigation.findParentTag('STRONG')).toBe(strong);

      // Should find EM from focus node
      expect(SelectionNavigation.findParentTag('EM')).toBe(em);
    });

    it('respects search depth limit', () => {
      const container = createNestedStructure(
        '<div><div><div><div><p>Deep text</p></div></div></div></div>'
      );

      const paragraph = container.querySelector('p');

      if (!(paragraph instanceof HTMLElement) || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected paragraph element with a text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 4);

      // With depth 1, starting from text node, checks: text node (no match), then parent (paragraph, no match)
      // So it returns null before finding any DIV
      const result = SelectionNavigation.findParentTag('DIV', undefined, 1);

      expect(result).toBeNull();

      // With depth 2, should find the immediate parent DIV of paragraph
      const result2 = SelectionNavigation.findParentTag('DIV', undefined, 2);

      expect(result2).not.toBeNull();
      expect(result2?.tagName).toBe('DIV');

      // With higher depth, should find outer divs too
      const deepResult = SelectionNavigation.findParentTag('DIV', undefined, 10);

      expect(deepResult).not.toBeNull();
    });

    it('finds element when anchor node is an element itself', () => {
      const container = createNestedStructure('<p data-test="true">Text</p>');

      const paragraph = container.querySelector('p');

      if (!(paragraph instanceof HTMLElement)) {
        throw new Error('Expected paragraph element');
      }

      // Select the element itself, not its text content
      const selection = ensureSelection();
      const range = document.createRange();

      range.selectNodeContents(paragraph);
      selection.removeAllRanges();
      selection.addRange(range);

      updateSelectionProperties(selection, {
        anchorNode: paragraph,
        focusNode: paragraph,
        anchorOffset: 0,
        focusOffset: paragraph.childNodes.length,
        isCollapsed: paragraph.childNodes.length === 0,
      });

      expect(SelectionNavigation.findParentTag('P')).toBe(paragraph);
    });

    it('returns null when tag is not found in parent hierarchy', () => {
      const container = createNestedStructure('<p>Just text</p>');

      const paragraph = container.querySelector('p');

      if (!(paragraph instanceof HTMLElement) || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected paragraph element with a text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 4);

      // No STRONG tag in hierarchy
      expect(SelectionNavigation.findParentTag('STRONG')).toBeNull();
    });

    it('stops searching when reaching document boundary', () => {
      const container = createNestedStructure('<p>Text at root level</p>');

      const paragraph = container.querySelector('p');

      if (!(paragraph instanceof HTMLElement) || !(paragraph.firstChild instanceof Text)) {
        throw new Error('Expected paragraph element with a text node');
      }

      setSelectionRange(paragraph.firstChild, 0, 4);

      // BODY tag should be findable
      expect(SelectionNavigation.findParentTag('BODY', undefined, 10)).toBe(document.body);
    });

    it('handles case-sensitive tag matching', () => {
      const container = createNestedStructure('<strong>Text</strong>');

      const strong = container.querySelector('strong');

      if (!(strong instanceof HTMLElement) || !(strong.firstChild instanceof Text)) {
        throw new Error('Expected strong element with a text node');
      }

      setSelectionRange(strong.firstChild, 0, 4);

      expect(SelectionNavigation.findParentTag('strong')).toBeNull(); // lowercase should not match
      expect(SelectionNavigation.findParentTag('STRONG')).toBe(strong);
    });
  });

  describe('expandToTag', () => {
    it('does nothing when there is no selection', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(null as unknown as Selection);

      const element = document.createElement('div');

      document.body.appendChild(element);

      expect(() => SelectionNavigation.expandToTag(element)).not.toThrow();

      vi.restoreAllMocks();
    });

    it('expands selection to cover entire element contents', () => {
      const container = createNestedStructure('<p><em>Expanded text</em></p>');

      const emphasis = container.querySelector('em');

      if (!(emphasis instanceof HTMLElement) || !(emphasis.firstChild instanceof Text)) {
        throw new Error('Expected em element with a text node');
      }

      // Select part of the text
      setSelectionRange(emphasis.firstChild, 0, 4);

      SelectionNavigation.expandToTag(emphasis);

      expect(SelectionCore.getText()).toBe(emphasis.textContent);
    });

    it('removes existing ranges before adding new one', () => {
      const container = createNestedStructure('<p>First</p><p>Second</p>');

      const paragraphs = container.querySelectorAll('p');
      const first = paragraphs[0];
      const second = paragraphs[1];

      if (
        !(first instanceof HTMLElement) ||
        !(second instanceof HTMLElement) ||
        !(first.firstChild instanceof Text)
      ) {
        throw new Error('Expected two paragraph elements');
      }

      // Set initial selection
      setSelectionRange(first.firstChild, 0, 2);

      const selection = ensureSelection();

      expect(selection.rangeCount).toBe(1);

      // Expand to second paragraph
      SelectionNavigation.expandToTag(second);

      expect(selection.rangeCount).toBe(1);
      expect(SelectionCore.getText()).toBe(second.textContent);
    });

    it('selects contents of element with no existing selection', () => {
      const container = createNestedStructure('<div id="target">Content to select</div>');

      const target = container.querySelector('#target');

      if (!(target instanceof HTMLElement)) {
        throw new Error('Expected target element');
      }

      // Clear any existing selection
      const selection = ensureSelection();

      selection.removeAllRanges();

      SelectionNavigation.expandToTag(target);

      expect(SelectionCore.getText()).toBe('Content to select');
    });

    it('handles empty elements', () => {
      const container = createNestedStructure('<div id="empty"></div>');

      const empty = container.querySelector('#empty');

      if (!(empty instanceof HTMLElement)) {
        throw new Error('Expected empty element');
      }

      SelectionNavigation.expandToTag(empty);

      // Should not throw, selection should exist but be empty
      expect(SelectionCore.getRange()).not.toBeNull();
      expect(SelectionCore.getText()).toBe('');
    });

    it('handles elements with nested structure', () => {
      const container = createNestedStructure(
        '<div><p>First paragraph</p><p>Second paragraph</p></div>'
      );

      const target = container.querySelector('div');

      if (!(target instanceof HTMLElement)) {
        throw new Error('Expected div element');
      }

      SelectionNavigation.expandToTag(target);

      const selectedText = SelectionCore.getText();

      expect(selectedText).toContain('First paragraph');
      expect(selectedText).toContain('Second paragraph');
    });

    it('handles elements with mixed content', () => {
      const container = createNestedStructure(
        '<div>Text <strong>bold</strong> more text</div>'
      );

      const target = container.querySelector('div');

      if (!(target instanceof HTMLElement)) {
        throw new Error('Expected div element');
      }

      SelectionNavigation.expandToTag(target);

      const selectedText = SelectionCore.getText();

      expect(selectedText).toBe('Text bold more text');
    });
  });
});
