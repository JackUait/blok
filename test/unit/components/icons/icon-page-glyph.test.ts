import { describe, expect, it } from 'vitest';
import { IconFile, IconFileDoc, IconPage } from '../../../../src/components/icons';

const parse = (icon: string): Document => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');

  if (doc.querySelector('svg') === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
  }

  return doc;
};

const pathsOf = (icon: string): string[] => Array.from(parse(icon).querySelectorAll('path'), path => path.getAttribute('d') ?? '');

const FOLD = 'M11 3v2.5a2 2 0 0 0 2 2h2.5';

/**
 * The page block and the File block sit next to each other in the toolbox.
 * A fold means a file on disk; a Blok page is the portrait frame with no fold,
 * so the two read apart at 16 px.
 */
describe('IconPage', () => {
  it('is a 20-unit standard icon', () => {
    expect(IconPage).toContain('width="20" height="20" viewBox="0 0 20 20"');
  });

  it('is the Keyline portrait page frame', () => {
    const frames = Array.from(parse(IconPage).querySelectorAll('rect'), rect => ['x', 'y', 'width', 'height', 'rx'].map(name => rect.getAttribute(name)));

    expect(frames).toEqual([['4.5', '3', '11', '14', '2']]);
  });

  it('has no fold, unlike the file glyphs', () => {
    expect(pathsOf(IconPage)).not.toContain(FOLD);

    [IconFile, IconFileDoc].forEach((icon) => {
      expect(pathsOf(icon)).toContain(FOLD);
    });
  });

  it('keeps text lines of its own', () => {
    const [lines] = pathsOf(IconPage);

    expect(lines).toMatch(/^(M[\d. ]+h[\d.]+)+$/);
    expect(lines).not.toBe(pathsOf(IconFileDoc)[2]);
  });
});
