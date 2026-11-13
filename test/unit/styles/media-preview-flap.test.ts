/**
 * The file page's dog-ear lifts off the page on hover. jsdom has no CSS, so
 * this reads the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/media-empty.css'), 'utf-8');

describe('media preview dog-ear', () => {
  it('never crosses its fold, so the corner stays on the page', () => {
    const block = /@keyframes blok-media-preview-flap \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const scales = Array.from(block.matchAll(/scaleY\((-?[\d.]+)\)/g), (match) => Number(match[1]));

    expect(scales.length).toBeGreaterThan(0);
    expect(scales.filter((scale) => scale <= 0)).toEqual([]);
  });
});
