import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTooltipContent } from '../../../../../src/components/modules/toolbar/tooltip';

vi.mock('../../../../../src/components/dom', () => {
  const make = vi.fn((tag: string, classes?: string | string[], props?: Record<string, unknown>) => {
    const element = document.createElement(tag);
    if (props?.textContent) {
      element.textContent = String(props.textContent);
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

  it('creates a container element with flex column layout', () => {
    const result = createTooltipContent(['Line 1', 'Line 2']);

    expect(result.style.display).toBe('flex');
    expect(result.style.flexDirection).toBe('column');
    expect(result.style.gap).toBe('4px');
  });

  it('creates a single line element without space', () => {
    const result = createTooltipContent(['SingleLine']);

    expect(result.children).toHaveLength(1);
    const line = result.children[0] as HTMLElement;
    expect(line.textContent).toBe('SingleLine');
  });

  it('creates a single line element with space - first word styled white', () => {
    const result = createTooltipContent(['First rest']);

    expect(result.children).toHaveLength(1);
    const line = result.children[0] as HTMLElement;
    expect(line.children).toHaveLength(1);

    const span = line.children[0] as HTMLElement;
    expect(span.tagName).toBe('SPAN');
    expect(span.textContent).toBe('First');
    expect(span.style.color).toBe('white');

    // The rest of the text is a text node
    expect(line.childNodes[1].textContent).toBe(' rest');
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
    expect(span.textContent).toBe('WordWith');
    // The substring from spaceIndex includes the space
    expect(line.childNodes[1].textContent).toBe(' SpaceAfter ');
  });

  it('preserves exact spacing in second part of line', () => {
    const result = createTooltipContent(['Cmd  Click']);

    expect(result.children).toHaveLength(1);
    const line = result.children[0] as HTMLElement;
    expect(line.childNodes[1].textContent).toBe('  Click');
  });
});
