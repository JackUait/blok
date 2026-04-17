import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTooltipContent } from '../../../../../src/components/modules/toolbar/tooltip';

vi.mock('../../../../../src/components/dom', () => {
  const make = vi.fn((tag: string, _classNames: string | string[] | null = null, attributes: Record<string, unknown> = {}) => {
    const element = document.createElement(tag);

    // Handle attributes (like textContent)
    for (const attrName in attributes) {
      if (!Object.prototype.hasOwnProperty.call(attributes, attrName)) {
        continue;
      }

      const value = attributes[attrName];

      if (value === undefined || value === null) {
        continue;
      }

      if (attrName in element) {
        (element as unknown as Record<string, unknown>)[attrName] = value;
      }
    }

    return element;
  });

  return {
    Dom: {
      make,
    },
  };
});

describe('createTooltipContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a container element with flex column layout and muted text color', () => {
    const result = createTooltipContent(['Line 1', 'Line 2']);

    expect(result.style.display).toBe('flex');
    expect(result.style.flexDirection).toBe('column');
    expect(result.style.gap).toBe('4px');
    expect(result.style.color).toBe('rgba(255, 255, 255, 0.55)');
  });

  it('creates a single line element without space', () => {
    const result = createTooltipContent(['SingleLine']);

    expect(result.children).toHaveLength(1);
    const line = result.children[0] as HTMLElement;
    expect(line).toHaveTextContent('SingleLine');
  });

  it('creates a single line element with space - first word styled white and bold', () => {
    const result = createTooltipContent(['First rest']);

    expect(result.children).toHaveLength(1);
    const line = result.children[0] as HTMLElement;
    expect(line.children).toHaveLength(1);

    const span = line.children[0] as HTMLElement;
    expect(span.tagName).toBe('SPAN');
    expect(span).toHaveTextContent('First');
    expect(span.style.color).toBe('white');
    expect(span.style.fontWeight).toBe('500');

    // The rest of the text is a text node
    // Check using nodeValue directly since toHaveTextContent may normalize whitespace
    const textNode = line.childNodes[1] as Text;
    expect(textNode.nodeValue).toBe(' rest');
  });

  it('creates multiple lines separated by gap', () => {
    const result = createTooltipContent(['Line 1', 'Line 2', 'Line 3']);

    expect(result.children).toHaveLength(3);
  });

  it('handles multiple lines with styled first words', () => {
    const result = createTooltipContent(['First line', 'Second line', 'Third line']);

    expect(result.children).toHaveLength(3);

    // Check each line has first word styled white
    for (let i = 0; i < 3; i++) {
      const line = result.children[i] as HTMLElement;
      expect(line.children).toHaveLength(1);
      const span = line.children[0] as HTMLElement;
      expect(span.style.color).toBe('white');
    }
  });

  it('handles empty lines array', () => {
    const result = createTooltipContent([]);

    expect(result.children).toHaveLength(0);
  });

  it('handles lines with only spaces as first word boundary', () => {
    const result = createTooltipContent(['WordWith SpaceAfter ']);

    expect(result.children).toHaveLength(1);
    const line = result.children[0] as HTMLElement;
    const span = line.children[0] as HTMLElement;
    expect(span).toHaveTextContent('WordWith');
    // The substring from spaceIndex includes the space
    const textNode = line.childNodes[1] as Text;
    expect(textNode.nodeValue).toBe(' SpaceAfter ');
  });

  it('preserves exact spacing in second part of line', () => {
    const result = createTooltipContent(['Cmd  Click']);

    expect(result.children).toHaveLength(1);
    const line = result.children[0] as HTMLElement;
    const textNode = line.childNodes[1] as Text;
    expect(textNode.nodeValue).toBe('  Click');
  });

  describe('segment-based lines', () => {
    it('renders a line with a single highlighted segment', () => {
      const result = createTooltipContent([
        [{ text: 'Click', highlight: true }, { text: ' to add below', highlight: false }],
      ]);

      expect(result.children).toHaveLength(1);
      const line = result.children[0] as HTMLElement;
      const span = line.children[0] as HTMLElement;
      expect(span.tagName).toBe('SPAN');
      expect(span).toHaveTextContent('Click');
      expect(span.style.color).toBe('white');
    expect(span.style.fontWeight).toBe('500');

      const textNode = line.childNodes[1] as Text;
      expect(textNode.nodeValue).toBe(' to add below');
    });

    it('renders a line with multiple highlighted segments', () => {
      const result = createTooltipContent([
        [
          { text: 'Click', highlight: true },
          { text: ' or ', highlight: false },
          { text: '⌘/', highlight: true },
          { text: ' to open menu', highlight: false },
        ],
      ]);

      expect(result.children).toHaveLength(1);
      const line = result.children[0] as HTMLElement;

      // Two highlighted spans: 'Click' and '⌘/'
      const spans = Array.from(line.children) as HTMLElement[];
      expect(spans).toHaveLength(2);
      expect(spans[0].tagName).toBe('SPAN');
      expect(spans[0]).toHaveTextContent('Click');
      expect(spans[0].style.color).toBe('white');
      expect(spans[1].tagName).toBe('SPAN');
      expect(spans[1]).toHaveTextContent('⌘/');
      expect(spans[1].style.color).toBe('white');

      // Text nodes in between
      const childNodes = Array.from(line.childNodes);
      expect(childNodes[1]).toBeInstanceOf(Text);
      expect((childNodes[1] as Text).nodeValue).toBe(' or ');
      expect(childNodes[3]).toBeInstanceOf(Text);
      expect((childNodes[3] as Text).nodeValue).toBe(' to open menu');
    });

    it('renders a line with no highlighted segments as plain text', () => {
      const result = createTooltipContent([
        [{ text: 'plain text', highlight: false }],
      ]);

      const line = result.children[0] as HTMLElement;
      expect(line.children).toHaveLength(0);
      const textNode = line.childNodes[0] as Text;
      expect(textNode.nodeValue).toBe('plain text');
    });

    it('mixes string lines and segment lines', () => {
      const result = createTooltipContent([
        'Drag to move',
        [
          { text: 'Click', highlight: true },
          { text: ' or ', highlight: false },
          { text: '⌘/', highlight: true },
          { text: ' to open menu', highlight: false },
        ],
      ]);

      expect(result.children).toHaveLength(2);

      // First line: string-based (first word highlighted)
      const firstLine = result.children[0] as HTMLElement;
      const firstSpan = firstLine.children[0] as HTMLElement;
      expect(firstSpan).toHaveTextContent('Drag');
      expect(firstSpan.style.color).toBe('white');

      // Second line: segment-based (two highlighted spans)
      const secondLine = result.children[1] as HTMLElement;
      const spans = Array.from(secondLine.children) as HTMLElement[];
      expect(spans).toHaveLength(2);
      expect(spans[0]).toHaveTextContent('Click');
      expect(spans[1]).toHaveTextContent('⌘/');
    });
  });
});
