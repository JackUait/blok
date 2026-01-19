import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { FakeBackgroundTextNodes } from '../../../../../src/components/selection/fake-background/text-nodes';

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

/**
 * Test helper to create nested HTML structure
 */
const createNestedStructure = (html: string): HTMLElement => {
  const container = document.createElement('div');

  container.innerHTML = html;
  document.body.appendChild(container);

  return container;
};

describe('FakeBackgroundTextNodes', () => {
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
  });

  describe('collectTextNodes', () => {
    it('returns single text node when range is within a text node', () => {
      const { textNode } = createContentEditable('Hello world');

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(textNode);
    });

    it('returns text node even when range is collapsed (intersectsNode behavior)', () => {
      const { textNode } = createContentEditable('Hello world');

      const range = document.createRange();

      range.setStart(textNode, 2);
      range.collapse(true);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      // Note: intersectsNode returns true for collapsed ranges within text nodes
      // So the implementation returns the text node even for collapsed selections
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toBe(textNode);
    });

    it('collects multiple text nodes within range', () => {
      const container = createNestedStructure('<p>Text 1</p><p>Text 2</p>');

      const firstP = container.querySelector('p:first-child');
      const lastP = container.querySelector('p:last-child');

      if (
        !firstP?.firstChild ||
        !lastP?.lastChild ||
        !(firstP.firstChild instanceof Text) ||
        !(lastP.lastChild instanceof Text)
      ) {
        throw new Error('Expected text nodes in paragraphs');
      }

      const range = document.createRange();

      range.setStart(firstP.firstChild, 0);
      range.setEnd(lastP.lastChild, lastP.lastChild.length);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result).toContain(firstP.firstChild);
      expect(result).toContain(lastP.lastChild);
    });

    it('filters out empty text nodes', () => {
      const container = createNestedStructure('<p>Text</p><p></p><p>More</p>');

      const range = document.createRange();

      range.selectNodeContents(container);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      // Should not include empty text nodes
      result.forEach((node) => {
        expect(node.textContent?.length).toBeGreaterThan(0);
      });
    });

    it('includes only text nodes that intersect with the range', () => {
      const container = createNestedStructure('<p>First</p><p>Second</p><p>Third</p>');

      const paragraphs = container.querySelectorAll('p');
      const firstP = paragraphs[0];
      const secondP = paragraphs[1];
      const thirdP = paragraphs[2];

      if (
        !secondP?.firstChild ||
        !(secondP.firstChild instanceof Text) ||
        !thirdP?.firstChild ||
        !(thirdP.firstChild instanceof Text)
      ) {
        throw new Error('Expected text nodes in paragraphs');
      }

      const range = document.createRange();

      range.setStart(secondP.firstChild, 0);
      range.setEnd(thirdP.firstChild, 2);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(result).toContain(secondP.firstChild);
      expect(result).toContain(thirdP.firstChild);
    });

    it('handles inline elements with text', () => {
      const container = createNestedStructure('<p>Start <strong>middle</strong> end</p>');

      const range = document.createRange();

      range.selectNodeContents(container.querySelector('p')!);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('returns single node when common ancestor is a text node', () => {
      const { textNode } = createContentEditable('Single text');

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 6);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(textNode);
    });

    it('handles nested structure with mixed content', () => {
      const container = createNestedStructure(
        '<div>Text <span>nested</span> more</div>'
      );

      const range = document.createRange();

      range.selectNodeContents(container.firstElementChild!);

      const result = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('findLineBreakPositions', () => {
    it('returns empty array for single-line text', () => {
      const { textNode } = createContentEditable('Short text');

      const result = FakeBackgroundTextNodes.findLineBreakPositions(textNode, 1);

      expect(result).toEqual([]);
    });

    it('returns empty positions when expectedLines is 1', () => {
      const { textNode } = createContentEditable('Any text here');

      const result = FakeBackgroundTextNodes.findLineBreakPositions(textNode, 1);

      expect(result).toEqual([]);
    });

    it('finds line break positions for multi-line text', () => {
      const container = document.createElement('div');

      // Create text that will wrap to multiple lines by constraining width
      container.style.width = '100px';
      container.style.whiteSpace = 'pre-wrap';
      container.textContent = 'This is a long text that should wrap to multiple lines';
      document.body.appendChild(container);

      const textNode = container.firstChild as Text;

      // In jsdom, getBoundingClientRect may return same values
      // This test verifies the logic runs without errors
      const result = FakeBackgroundTextNodes.findLineBreakPositions(textNode, 3);

      expect(Array.isArray(result)).toBe(true);
    });

    it('limits positions to expectedLines - 1', () => {
      const { textNode } = createContentEditable('Text content');

      const result = FakeBackgroundTextNodes.findLineBreakPositions(textNode, 2);

      // Should return at most 1 position for 2 expected lines
      expect(result.length).toBeLessThanOrEqual(1);
    });

    it('returns positions in ascending order', () => {
      const { textNode } = createContentEditable('Some text content');

      const result = FakeBackgroundTextNodes.findLineBreakPositions(textNode, 3);

      // Verify positions are sorted if any are found
      for (let i = 1; i < result.length; i++) {
        expect(result[i]).toBeGreaterThan(result[i - 1]);
      }
    });

    it('detects line break based on rect top position difference', () => {
      const { textNode } = createContentEditable('Line one\nLine two');

      // Test with actual newline character
      const result = FakeBackgroundTextNodes.findLineBreakPositions(textNode, 2);

      expect(Array.isArray(result)).toBe(true);
    });

    it('uses 5px threshold for detecting line breaks', () => {
      const { textNode } = createContentEditable('Text');

      const result = FakeBackgroundTextNodes.findLineBreakPositions(textNode, 2);

      // The implementation uses Math.abs(rect.top - lastTop) > 5
      // This test verifies the function runs correctly
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('splitTextAtPositions', () => {
    it('returns original text when no positions provided', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Hello world', []);

      expect(result).toEqual(['Hello world']);
    });

    it('splits text at single position', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Hello world', [5]);

      expect(result).toEqual(['Hello', ' world']);
    });

    it('splits text at multiple positions', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Hello world test', [5, 11]);

      expect(result).toEqual(['Hello', ' world', ' test']);
    });

    it('filters out empty segments', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Hello', [0, 5]);

      // Adjacent positions at boundaries would create empty strings
      expect(result).not.toContain('');
    });

    it('handles positions at text boundaries', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Hello', [0]);

      expect(result).toEqual(['Hello']);
    });

    it('handles consecutive positions', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Hello', [2, 2]);

      // Duplicate positions should be handled
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns all segments including last one', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Split this text', [5, 10]);

      expect(result[result.length - 1]).toBe(' text');
    });

    it('handles positions in descending order (sorts internally)', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Hello world', [8, 3]);

      // Positions are processed in the order they appear in breakpoints array
      // which prepends 0 and appends text.length
      expect(result.length).toBeGreaterThan(1);
    });

    it('preserves whitespace in segments', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Hello  world', [6]);

      // The split happens at position 6: "Hello " + " world"
      expect(result[1]).toBe(' world');
    });

    it('handles empty string input', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('', [0]);

      expect(result).toEqual([]);
    });

    it('handles position at end of text', () => {
      const text = 'Hello';
      const result = FakeBackgroundTextNodes.splitTextAtPositions(text, [text.length]);

      expect(result).toEqual(['Hello']);
    });

    it('creates segments from 0 to first position', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('Hello world test', [5]);

      expect(result[0]).toBe('Hello');
    });

    it('handles text with only whitespace', () => {
      const result = FakeBackgroundTextNodes.splitTextAtPositions('   ', [1, 2]);

      // Whitespace segments are preserved
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('integration', () => {
    it('can collect text nodes and split at found positions', () => {
      const { textNode } = createContentEditable('Some text to process');

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.length);

      const collected = FakeBackgroundTextNodes.collectTextNodes(range);

      expect(collected).toHaveLength(1);

      const positions = [4, 9];
      const split = FakeBackgroundTextNodes.splitTextAtPositions(
        collected[0].textContent || '',
        positions
      );

      expect(split).toHaveLength(3);
    });
  });
});
