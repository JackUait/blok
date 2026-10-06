import { describe, expect, it } from 'vitest';
import { IconFile, IconFileDoc, IconPage } from '../../../../src/components/icons';

const pathsOf = (icon: string): SVGPathElement[] => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');

  if (doc.querySelector('svg') === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
  }

  return Array.from(doc.querySelectorAll('path'));
};

const dOf = (path: SVGPathElement | undefined): string => path?.getAttribute('d') ?? '';

/**
 * The page block and the File block sit next to each other in the toolbox,
 * and both are drawn as a folded sheet. The page shares the file family's
 * frame but paints its fold solid, so the two read apart at 16 px.
 */
describe('IconPage', () => {
  it('is a 20-unit standard icon', () => {
    expect(IconPage).toContain('width="20" height="20" viewBox="0 0 20 20"');
  });

  it('shares the file family sheet outline', () => {
    expect(dOf(pathsOf(IconPage)[0])).toBe(dOf(pathsOf(IconFile)[0]));
  });

  it('paints its folded corner solid, unlike the file glyphs', () => {
    const fold = pathsOf(IconPage)[1];

    expect(fold.getAttribute('fill')).toBe('currentColor');
    expect(fold.getAttribute('stroke')).toBe('currentColor');
    expect(fold.getAttribute('stroke-width')).toBe('1.25');

    [IconFile, IconFileDoc].forEach((icon) => {
      expect(pathsOf(icon)[1].getAttribute('fill')).toBeNull();
    });
  });

  it('keeps text lines of its own', () => {
    const lines = dOf(pathsOf(IconPage)[2]);

    expect(lines).not.toBe('');
    expect(lines).not.toBe(dOf(pathsOf(IconFile)[2]));
    expect(lines).not.toBe(dOf(pathsOf(IconFileDoc)[2]));
  });
});
