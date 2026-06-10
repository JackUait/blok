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

  it('should render digit glyphs as filled paths aligned with the lines', () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(IconListNumbered, 'image/svg+xml');
    const svg = doc.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll('text').length).toBe(0);

    const digitPaths = Array.from(svg?.querySelectorAll('path') ?? []).filter(
      (p) => p.getAttribute('fill') === 'currentColor'
    );

    expect(digitPaths.length).toBe(3);
  });
});
