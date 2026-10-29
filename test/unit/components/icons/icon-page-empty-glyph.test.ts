import { describe, expect, it } from 'vitest';
import { IconPageEmpty } from '../../../../src/components/icons';

const pathsOf = (icon: string): SVGPathElement[] => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');

  if (doc.querySelector('svg') === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
  }

  return Array.from(doc.querySelectorAll('path'));
};

/**
 * Notion's `pageEmpty` (notion-spec-2 §18.1, §19.15): a bare folded sheet with no text lines,
 * 14x17 of its 18px box. The sheet runs 13 wide and 17 tall on the 20 grid, so it renders at
 * about that size.
 */
describe('IconPageEmpty', () => {
  it('is a sheet and its fold, with no text lines', () => {
    expect(pathsOf(IconPageEmpty)).toHaveLength(2);
  });

  it('draws the sheet 13 wide and 17 tall, centred on the canvas', () => {
    const sheet = pathsOf(IconPageEmpty)[0].getAttribute('d');

    expect(sheet).toBe('M3.5 3.5a2 2 0 0 1 2-2h5l6 6v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13Z');
  });

  it('meets the fold where the sheet bends', () => {
    expect(pathsOf(IconPageEmpty)[1].getAttribute('d')).toBe('M10.5 1.5v6h6');
  });
});
