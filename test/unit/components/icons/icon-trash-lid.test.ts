import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconEmojiTrash, IconTrash } from '../../../../src/components/icons';

const parse = (markup: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (!svg || doc.querySelector('parsererror')) {
    throw new Error('Invalid SVG');
  }

  return svg;
};

const numbers = (d: string): number[] => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number);

describe('trash lid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['IconTrash', IconTrash],
    ['IconEmojiTrash', IconEmojiTrash],
  ])('%s draws the lid closed, as one group CSS can lift', (_name, markup) => {
    const svg = parse(markup);
    const lid = svg.querySelector('[data-blok-icon-lid]');

    expect(lid?.tagName).toBe('g');
    expect(lid?.hasAttribute('transform')).toBe(false);
    expect(lid?.querySelectorAll('path')).toHaveLength(2);

    const rim = numbers(lid?.querySelector('path')?.getAttribute('d') ?? '');
    const body = numbers(svg.querySelector(':scope > path')?.getAttribute('d') ?? '');

    // A closed lid rests on the bin: rim stroke touches the body's top.
    expect(body[1] - rim[1]).toBeLessThanOrEqual(1.25);
  });
});
