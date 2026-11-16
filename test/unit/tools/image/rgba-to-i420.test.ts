import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { rgbaToI420 } from '../../../../src/tools/image/rgba-to-i420';

/** `width`×`height` pixels of one colour. */
const solid = (width: number, height: number, rgb: [number, number, number]): Uint8Array =>
  Uint8Array.from(Array.from({ length: width * height }, () => [...rgb, 255]).flat());

describe('rgbaToI420', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('maps white and black to the limited-range ends, not 255 and 0', () => {
    expect(Array.from(rgbaToI420(solid(2, 2, [255, 255, 255]), 2, 2))).toEqual([235, 235, 235, 235, 128, 128]);
    expect(Array.from(rgbaToI420(solid(2, 2, [0, 0, 0]), 2, 2))).toEqual([16, 16, 16, 16, 128, 128]);
  });

  it('uses the BT.709 weights for the primaries', () => {
    expect(Array.from(rgbaToI420(solid(2, 2, [255, 0, 0]), 2, 2))).toEqual([63, 63, 63, 63, 102, 240]);
    expect(Array.from(rgbaToI420(solid(2, 2, [0, 255, 0]), 2, 2))).toEqual([173, 173, 173, 173, 42, 26]);
    expect(Array.from(rgbaToI420(solid(2, 2, [0, 0, 255]), 2, 2))).toEqual([32, 32, 32, 32, 240, 118]);
  });

  it('writes a Y plane, then quarter-size U and V planes', () => {
    const out = rgbaToI420(solid(4, 2, [255, 255, 255]), 4, 2);

    expect(out).toHaveLength(4 * 2 + 2 + 2);
  });

  it('averages each 2×2 block into one chroma sample', () => {
    // Left column red, right column blue: one block, so U and V are the mean of both.
    const rgba = Uint8Array.from([255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]);

    expect(Array.from(rgbaToI420(rgba, 2, 2))).toEqual([63, 32, 63, 32, 171, 179]);
  });

  it('rounds odd sizes up for chroma and averages only the pixels that exist', () => {
    // 3×1: red, red, blue. The second chroma sample covers the lone blue pixel.
    const rgba = Uint8Array.from([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255]);

    expect(Array.from(rgbaToI420(rgba, 3, 1))).toEqual([63, 63, 32, 102, 240, 240, 118]);
  });
});
