import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IconListNumbered } from '../../../../src/components/icons';

describe('IconListNumbered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should be a valid SVG string with 20x20 viewBox', () => {
    expect(IconListNumbered).toContain('viewBox="0 0 20 20"');
    expect(IconListNumbered).toContain('<svg');
    expect(IconListNumbered).toContain('</svg>');
  });

  it('should contain the three horizontal list lines unchanged', () => {
    expect(IconListNumbered).toContain('M8 5h9');
    expect(IconListNumbered).toContain('M8 10h9');
    expect(IconListNumbered).toContain('M8 15h9');
  });

  it('should use filled text elements for number glyphs instead of stroked paths', () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(IconListNumbered, 'image/svg+xml');
    const svg = doc.querySelector('svg');

    expect(svg).not.toBeNull();

    // Numbers should be rendered as filled <text> elements for legibility at small sizes
    const textElements = svg?.querySelectorAll('text');

    expect(textElements?.length).toBe(3);

    const textContents = Array.from(textElements ?? []).map((el) => el.textContent);

    expect(textContents).toContain('1');
    expect(textContents).toContain('2');
    expect(textContents).toContain('3');
  });

  it('should position number glyphs near y=5, y=10, y=15 to align with lines', () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(IconListNumbered, 'image/svg+xml');
    const textElements = Array.from(doc.querySelectorAll('text'));

    expect(textElements.length).toBe(3);

    const yPositions = textElements.map((el) => parseFloat(el.getAttribute('y') ?? '0'));

    // Numbers should be roughly centered on the line positions (y=5, y=10, y=15)
    // Allow some offset for text baseline alignment
    expect(yPositions[0]).toBeGreaterThanOrEqual(4);
    expect(yPositions[0]).toBeLessThanOrEqual(7);

    expect(yPositions[1]).toBeGreaterThanOrEqual(9);
    expect(yPositions[1]).toBeLessThanOrEqual(12);

    expect(yPositions[2]).toBeGreaterThanOrEqual(14);
    expect(yPositions[2]).toBeLessThanOrEqual(17);
  });

  it('should use fill="currentColor" on text elements for consistency', () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(IconListNumbered, 'image/svg+xml');
    const textElements = Array.from(doc.querySelectorAll('text'));

    for (const textEl of textElements) {
      expect(textEl.getAttribute('fill')).toBe('currentColor');
    }
  });
});
