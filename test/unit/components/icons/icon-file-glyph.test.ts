import { describe, it, expect } from 'vitest';
import { IconFile } from '../../../../src/components/icons';

const parseSvg = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null) {
    throw new Error('invalid svg');
  }

  return svg;
};

/**
 * Every file category the File block cannot name with a glyph of its own —
 * PDF, plain text, and anything unrecognised — falls back to IconFile and is
 * told apart only by the .blok-file-icon[data-file-category] tint. That only
 * reads as a file if the drawing stays a plain page.
 */
describe('IconFile', () => {
  it('is a valid 20x20 SVG', () => {
    expect(IconFile).toContain('viewBox="0 0 20 20"');
    expect(IconFile).toContain('<svg');
    expect(IconFile).toContain('</svg>');
  });

  it('is a plain stroked glyph — no chip rect, no wordmark fill, no text', () => {
    const svg = parseSvg(IconFile);

    expect(svg.querySelectorAll('text').length).toBe(0);
    expect(svg.querySelectorAll('rect').length).toBe(0);
    expect(
      Array.from(svg.querySelectorAll('path')).filter((p) => p.getAttribute('fill') === 'currentColor').length
    ).toBe(0);
  });
});
