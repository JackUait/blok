// Derived from @aiden0z/pptx-renderer 1.4.0 tests (Apache-2.0); modified for Blok.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import '../../helpers/domShims';
import {
  fitShape3DRasterScale,
  renderCircleBevelOverlay,
} from '../../../../../../../src/tools/file/pptx/renderer/shape3d/BevelLighting';

function filledRect(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height).fill(255);
}

function diskMask(size: number, radius: number): Uint8Array {
  const alpha = new Uint8Array(size * size);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      alpha[y * size + x] = Math.hypot(x - center, y - center) <= radius ? 255 : 0;
    }
  }
  return alpha;
}

function signedLighting(rgba: Uint8ClampedArray, pixelIndex: number): number {
  const offset = pixelIndex * 4;
  const alpha = rgba[offset + 3];
  return rgba[offset] >= 128 ? alpha : -alpha;
}

function nonTransparentPixels(rgba: Uint8ClampedArray): number {
  let count = 0;
  for (let offset = 3; offset < rgba.length; offset += 4) {
    if (rgba[offset] > 0) count += 1;
  }
  return count;
}

const defaultOptions = {
  bandPx: 7,
  heightPx: 4,
  lightAzimuthDeg: 315,
  lightElevationDeg: 50,
  intensity: 1.75,
};

describe('renderCircleBevelOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the transparent exterior and flat interior out of the lighting overlay', () => {
    const size = 41;
    const alpha = diskMask(size, 16);
    const overlay = renderCircleBevelOverlay(alpha, size, size, defaultOptions);

    expect(overlay).toHaveLength(size * size * 4);
    expect(overlay[(0 * size + 0) * 4 + 3]).toBe(0);
    expect(overlay[(20 * size + 20) * 4 + 3]).toBe(0);
    expect(overlay[(6 * size + 20) * 4 + 3]).toBeGreaterThan(0);
  });

  it('produces continuously varying light around a curved silhouette', () => {
    const size = 101;
    const center = 50;
    const overlay = renderCircleBevelOverlay(diskMask(size, 40), size, size, defaultOptions);
    const samples = Array.from({ length: 24 }, (_, index) => {
      const angle = (index / 24) * Math.PI * 2;
      const x = Math.round(center + Math.cos(angle) * 36);
      const y = Math.round(center + Math.sin(angle) * 36);
      return signedLighting(overlay, y * size + x);
    });

    const tonalBuckets = new Set(samples.map((value) => Math.round(value / 10)));
    expect(tonalBuckets.size).toBeGreaterThanOrEqual(8);
    expect(Math.max(...samples)).toBeGreaterThan(20);
    expect(Math.min(...samples)).toBeLessThan(-20);
  });

  it('rotates the directional lighting by 180 degrees without changing its silhouette', () => {
    const width = 31;
    const height = 21;
    const alpha = filledRect(width, height);
    const first = renderCircleBevelOverlay(alpha, width, height, {
      ...defaultOptions,
      lightAzimuthDeg: 315,
    });
    const opposite = renderCircleBevelOverlay(alpha, width, height, {
      ...defaultOptions,
      lightAzimuthDeg: 135,
    });

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const firstValue = signedLighting(first, y * width + x);
        const mirrorValue = signedLighting(opposite, (height - 1 - y) * width + (width - 1 - x));
        expect(Math.abs(firstValue - mirrorValue)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('broadens a three-point shadow rim without moving its key highlight', () => {
    const size = 101;
    const center = 50;
    const alpha = diskMask(size, 40);
    const coupled = renderCircleBevelOverlay(alpha, size, size, {
      ...defaultOptions,
      lightAzimuthDeg: 330,
    });
    const broadened = renderCircleBevelOverlay(alpha, size, size, {
      ...defaultOptions,
      lightAzimuthDeg: 330,
      shadowFloor: 0.22,
      shadowScale: 0.25,
    });
    const sample = (rgba: Uint8ClampedArray, degrees: number) => {
      const angle = (degrees * Math.PI) / 180;
      const x = Math.round(center + Math.cos(angle) * 36);
      const y = Math.round(center + Math.sin(angle) * 36);
      return signedLighting(rgba, y * size + x);
    };

    // The native three-point donut keeps its upper-left key highlight, but its shadow is a broad
    // material rim instead of one concentrated Lambert lobe.
    expect(sample(broadened, 240)).toBe(sample(coupled, 240));
    expect(sample(broadened, 60)).toBeGreaterThan(sample(coupled, 60));
    expect(sample(broadened, 150)).toBeLessThan(sample(coupled, 150));
  });

  it('can steer a three-point shadow lobe independently from its key highlight', () => {
    const size = 101;
    const center = 50;
    const alpha = diskMask(size, 40);
    const coupled = renderCircleBevelOverlay(alpha, size, size, {
      ...defaultOptions,
      lightAzimuthDeg: 330,
      shadowFloor: 0.6,
      shadowScale: 0.25,
    });
    const split = renderCircleBevelOverlay(alpha, size, size, {
      ...defaultOptions,
      lightAzimuthDeg: 330,
      shadowAzimuthDeg: 285,
      shadowFloor: 0.6,
      shadowScale: 0.25,
    });
    const sample = (rgba: Uint8ClampedArray, degrees: number) => {
      const angle = (degrees * Math.PI) / 180;
      const x = Math.round(center + Math.cos(angle) * 36);
      const y = Math.round(center + Math.sin(angle) * 36);
      return signedLighting(rgba, y * size + x);
    };

    expect(sample(split, 240)).toBe(sample(coupled, 240));
    expect(sample(split, 15)).toBeLessThan(sample(split, 75));
    expect(sample(coupled, 15)).toBeGreaterThan(sample(coupled, 75));
  });

  it('can partially steer a shadow without applying the full shifted lobe', () => {
    const size = 101;
    const center = 50;
    const alpha = diskMask(size, 40);
    const options = {
      ...defaultOptions,
      lightAzimuthDeg: 350,
      shadowAzimuthDeg: 285,
      shadowFloor: 0.03,
      shadowScale: 0.87,
    };
    const coupled = renderCircleBevelOverlay(alpha, size, size, {
      ...options,
      shadowDirectionMix: 0,
    });
    const partial = renderCircleBevelOverlay(alpha, size, size, {
      ...options,
      shadowDirectionMix: 0.5,
    });
    const split = renderCircleBevelOverlay(alpha, size, size, {
      ...options,
      shadowDirectionMix: 1,
    });
    const sample = (rgba: Uint8ClampedArray, degrees: number) => {
      const angle = (degrees * Math.PI) / 180;
      const x = Math.round(center + Math.cos(angle) * 36);
      const y = Math.round(center + Math.sin(angle) * 36);
      return signedLighting(rgba, y * size + x);
    };

    expect(sample(partial, 15)).toBeLessThan(sample(coupled, 15));
    expect(sample(partial, 15)).toBeGreaterThan(sample(split, 15));
    expect(sample(partial, 260)).toBe(sample(coupled, 260));
  });

  it('can lift the key highlight without deepening the shadow lobe', () => {
    const size = 101;
    const center = 50;
    const alpha = diskMask(size, 40);
    const base = renderCircleBevelOverlay(alpha, size, size, {
      ...defaultOptions,
      lightAzimuthDeg: 330,
      shadowAzimuthDeg: 300,
      shadowFloor: 0.7,
      shadowScale: 0.4,
    });
    const lifted = renderCircleBevelOverlay(alpha, size, size, {
      ...defaultOptions,
      lightAzimuthDeg: 330,
      shadowAzimuthDeg: 300,
      shadowFloor: 0.7,
      shadowScale: 0.4,
      highlightScale: 1.2,
    });
    const sample = (rgba: Uint8ClampedArray, degrees: number) => {
      const angle = (degrees * Math.PI) / 180;
      const x = Math.round(center + Math.cos(angle) * 36);
      const y = Math.round(center + Math.sin(angle) * 36);
      return signedLighting(rgba, y * size + x);
    };

    expect(sample(lifted, 240)).toBeGreaterThan(sample(base, 240));
    expect(sample(lifted, 30)).toBe(sample(base, 30));
  });

  it('uses bevel width for band extent and bevel height for lighting contrast', () => {
    const width = 51;
    const height = 31;
    const alpha = filledRect(width, height);
    const narrow = renderCircleBevelOverlay(alpha, width, height, {
      ...defaultOptions,
      bandPx: 3,
    });
    const wide = renderCircleBevelOverlay(alpha, width, height, {
      ...defaultOptions,
      bandPx: 9,
    });
    const low = renderCircleBevelOverlay(alpha, width, height, {
      ...defaultOptions,
      heightPx: 1,
    });
    const high = renderCircleBevelOverlay(alpha, width, height, {
      ...defaultOptions,
      heightPx: 8,
    });
    const totalContrast = (rgba: Uint8ClampedArray) => {
      let total = 0;
      for (let offset = 3; offset < rgba.length; offset += 4) total += rgba[offset];
      return total;
    };

    expect(nonTransparentPixels(wide)).toBeGreaterThan(nonTransparentPixels(narrow));
    expect(totalContrast(high)).toBeGreaterThan(totalContrast(low));
  });

  it('uses material intensity to scale contrast without changing the bevel band', () => {
    const width = 51;
    const height = 31;
    const alpha = filledRect(width, height);
    const subtle = renderCircleBevelOverlay(alpha, width, height, {
      ...defaultOptions,
      intensity: 0.8,
    });
    const strong = renderCircleBevelOverlay(alpha, width, height, {
      ...defaultOptions,
      intensity: 1.75,
    });
    const totalContrast = (rgba: Uint8ClampedArray) => {
      let total = 0;
      for (let offset = 3; offset < rgba.length; offset += 4) total += rgba[offset];
      return total;
    };

    expect(nonTransparentPixels(subtle)).toBe(nonTransparentPixels(strong));
    expect(totalContrast(subtle)).toBeLessThan(totalContrast(strong));
  });

  it('rejects invalid bevel inputs rather than emitting non-finite pixels', () => {
    expect(() =>
      renderCircleBevelOverlay(filledRect(2, 2), 2, 2, {
        ...defaultOptions,
        bandPx: 0,
      }),
    ).toThrow(/bandPx and heightPx must be positive/);
    expect(() =>
      renderCircleBevelOverlay(filledRect(2, 2), 2, 2, {
        ...defaultOptions,
        intensity: Number.NaN,
      }),
    ).toThrow(/intensity must be a non-negative finite number/);
    expect(() =>
      renderCircleBevelOverlay(filledRect(2, 2), 2, 2, {
        ...defaultOptions,
        shadowDirectionMix: 1.1,
      }),
    ).toThrow(/shadow direction mix must be a finite normalized value/);
  });
});

describe('fitShape3DRasterScale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves the requested scale when it fits the pixel budget', () => {
    expect(fitShape3DRasterScale(200, 100, 2, 1_000_000)).toBe(2);
  });

  it('reduces scale enough for both rounded raster dimensions to fit', () => {
    const scale = fitShape3DRasterScale(1_000, 500, 2, 1_000_000);

    expect(scale).toBeGreaterThan(1.4);
    expect(scale).toBeLessThan(2);
    expect(Math.ceil(1_000 * scale) * Math.ceil(500 * scale)).toBeLessThanOrEqual(1_000_000);
  });

  it('returns zero for invalid bounds or budgets', () => {
    expect(fitShape3DRasterScale(0, 100, 2, 1_000_000)).toBe(0);
    expect(fitShape3DRasterScale(100, 100, Number.NaN, 1_000_000)).toBe(0);
    expect(fitShape3DRasterScale(100, 100, 2, 0)).toBe(0);
  });
});
