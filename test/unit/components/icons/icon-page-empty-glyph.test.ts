import { describe, expect, it } from 'vitest';
import { IconPage, IconPageEmpty } from '../../../../src/components/icons';

const parse = (icon: string): Document => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');

  if (doc.querySelector('svg') === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
  }

  return doc;
};

const framesOf = (icon: string): string[][] =>
  Array.from(parse(icon).querySelectorAll('rect'), rect => ['x', 'y', 'width', 'height', 'rx'].map(name => rect.getAttribute(name) ?? ''));

/** Notion's `pageEmpty`: a bare page with no text lines. */
describe('IconPageEmpty', () => {
  it('is the page frame alone, with no text lines and no fold', () => {
    expect(parse(IconPageEmpty).querySelectorAll('path')).toHaveLength(0);
    expect(framesOf(IconPageEmpty)).toHaveLength(1);
  });

  it('draws the same portrait frame as IconPage, centred on the canvas', () => {
    const [frame] = framesOf(IconPageEmpty);
    const [x, y, width, height] = (frame ?? []).map(Number);

    expect(framesOf(IconPageEmpty)).toEqual(framesOf(IconPage));
    expect(2 * (x ?? 0) + (width ?? 0)).toBe(20);
    expect(2 * (y ?? 0) + (height ?? 0)).toBe(20);
  });
});
