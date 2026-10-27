// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../../helpers/domShims';
import { interiorDistanceField } from '../../../../../../../src/tools/file/pptx/renderer/shape3d/DistanceField';

function alphaMask(rows: string[]): Uint8Array {
  return Uint8Array.from(rows.join('').replaceAll('.', '0').replaceAll('#', '1'), (value) =>
    value === '1' ? 255 : 0,
  );
}

describe('interiorDistanceField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('computes exact Euclidean distances inside a centered silhouette', () => {
    const distance = interiorDistanceField(
      alphaMask(['.....', '.###.', '.###.', '.###.', '.....']),
      5,
      5,
    );

    expect(Array.from(distance)).toEqual([
      0, 0, 0, 0, 0,
      0, 1, 1, 1, 0,
      0, 1, 2, 1, 0,
      0, 1, 1, 1, 0,
      0, 0, 0, 0, 0,
    ]);
  });

  it('uses an explicit transparent border when the silhouette touches every raster edge', () => {
    const distance = interiorDistanceField(alphaMask(['###', '###', '###']), 3, 3);

    expect(Array.from(distance)).toEqual([1, 1, 1, 1, 2, 1, 1, 1, 1]);
  });

  it('keeps transparent holes outside the interior distance field', () => {
    const distance = interiorDistanceField(
      alphaMask(['#####', '#####', '##.##', '#####', '#####']),
      5,
      5,
    );

    expect(distance[2 * 5 + 2]).toBe(0);
    expect(distance[2 * 5 + 1]).toBe(1);
    expect(distance[1 * 5 + 2]).toBe(1);
    expect(distance[0]).toBe(1);
  });

  it('keeps diagonal distances Euclidean around an interior hole', () => {
    const rows = new Array<string>(9).fill('#########');
    rows[4] = '####.####';
    const distance = interiorDistanceField(alphaMask(rows), 9, 9);

    expect(distance[3 * 9 + 3]).toBeCloseTo(Math.SQRT2, 5);
    expect(distance[2 * 9 + 3]).toBeCloseTo(Math.sqrt(5), 5);
  });

  it('honors the alpha threshold and validates raster dimensions', () => {
    expect(Array.from(interiorDistanceField(Uint8Array.from([127, 128]), 2, 1, 128))).toEqual([
      0, 1,
    ]);
    expect(() => interiorDistanceField(new Uint8Array(3), 2, 2)).toThrow(
      /alpha length must equal width \* height/,
    );
    expect(() => interiorDistanceField(new Uint8Array(), 0, 2)).toThrow(
      /positive integers/,
    );
  });
});
