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

  it('should draw the list rules on the shared Blok Line rows', () => {
    expect(IconListNumbered).toContain('M8.5 6.5H16.5M8.5 13.5H16.5');
  });

  it('should render digit glyphs as stroked paths, never as text', () => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(IconListNumbered, 'image/svg+xml');
    const svg = doc.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll('text').length).toBe(0);

    // Digits are stroked hairlines (not solid glyphs) so they match the rule weight.
    const digitPaths = Array.from(svg?.querySelectorAll('path') ?? []).filter(
      (p) => p.getAttribute('stroke') === 'currentColor' && !(p.getAttribute('d') ?? '').startsWith('M8.5 6.5')
    );

    expect(digitPaths).toHaveLength(1);
    expect(digitPaths[0]?.getAttribute('fill')).toBeNull();
  });
});
