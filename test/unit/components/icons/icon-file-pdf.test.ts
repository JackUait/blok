import { describe, it, expect } from 'vitest';
import { IconFile, IconFilePdf } from '../../../../src/components/icons';

const parseSvg = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null) {
    throw new Error('invalid svg');
  }

  return svg;
};

describe('IconFilePdf', () => {
  it('is a valid 20x20 SVG', () => {
    expect(IconFilePdf).toContain('viewBox="0 0 20 20"');
    expect(IconFilePdf).toContain('<svg');
    expect(IconFilePdf).toContain('</svg>');
  });

  it('reuses the generic file glyph (tinted red by the File block CSS)', () => {
    // Same shape as the regular file icon — only the category tint differs.
    expect(IconFilePdf).toBe(IconFile);
  });

  it('is a plain stroked glyph — no chip rect, no wordmark fill, no text', () => {
    const svg = parseSvg(IconFilePdf);

    expect(svg.querySelectorAll('text').length).toBe(0);
    expect(svg.querySelectorAll('rect').length).toBe(0);
    expect(
      Array.from(svg.querySelectorAll('path')).filter((p) => p.getAttribute('fill') === 'currentColor').length
    ).toBe(0);
  });
});
