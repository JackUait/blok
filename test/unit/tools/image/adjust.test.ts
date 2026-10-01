import { describe, it, expect } from 'vitest';
import type { ImageData, ImageFilterPreset } from '../../../../types/tools/image';
import {
  ADJUST_KEYS,
  FILTER_PRESETS,
  adjustFields,
  cssFilter,
  isNeutral,
  readAdjust,
} from '../../../../src/tools/image/adjust';

const ZERO = { brightness: 0, contrast: 0, saturation: 0 };

/** Builds data with fields the type would reject, as a stored document may hold. */
const raw = (fields: Record<string, unknown>): Partial<ImageData> => fields;

describe('constants', () => {
  it('lists presets in UI order, none first', () => {
    expect(FILTER_PRESETS).toEqual(['none', 'vivid', 'dramatic', 'warm', 'mono', 'noir', 'fade', 'sepia']);
  });

  it('lists adjust keys in order', () => {
    expect(ADJUST_KEYS).toEqual(['brightness', 'contrast', 'saturation']);
  });
});

describe('readAdjust', () => {
  it('defaults to none and all zero when fields are absent', () => {
    expect(readAdjust({})).toEqual({ filter: 'none', adjust: ZERO });
  });

  it('keeps every known preset', () => {
    for (const filter of FILTER_PRESETS) {
      expect(readAdjust({ filter }).filter).toBe(filter);
    }
  });

  it('drops an unknown filter to none', () => {
    expect(readAdjust(raw({ filter: 'lomo' })).filter).toBe('none');
    expect(readAdjust(raw({ filter: 3 })).filter).toBe('none');
    expect(readAdjust(raw({ filter: 'toString' })).filter).toBe('none');
  });

  it('reads valid values', () => {
    expect(readAdjust({ adjust: { brightness: 20, contrast: -40, saturation: 100 } }).adjust)
      .toEqual({ brightness: 20, contrast: -40, saturation: 100 });
  });

  it('turns non-finite and non-number values into 0', () => {
    const { adjust } = readAdjust(raw({ adjust: { brightness: NaN, contrast: Infinity, saturation: '50' } }));

    expect(adjust).toEqual(ZERO);
    expect(readAdjust(raw({ adjust: { brightness: -Infinity, contrast: null, saturation: true } })).adjust).toEqual(ZERO);
  });

  it('clamps to -100..100', () => {
    expect(readAdjust({ adjust: { brightness: 150, contrast: -101, saturation: 100.4 } }).adjust)
      .toEqual({ brightness: 100, contrast: -100, saturation: 100 });
  });

  it('rounds to integers with Math.round (.5 goes up)', () => {
    expect(readAdjust({ adjust: { brightness: 2.5, contrast: -2.5, saturation: 10.49 } }).adjust)
      .toEqual({ brightness: 3, contrast: -2, saturation: 10 });
  });

  it('turns -0 into 0', () => {
    const { adjust } = readAdjust({ adjust: { brightness: -0, contrast: -0.4, saturation: -0.5 } });

    expect(Object.is(adjust.brightness, 0)).toBe(true);
    expect(Object.is(adjust.contrast, 0)).toBe(true);
    expect(Object.is(adjust.saturation, 0)).toBe(true);
  });

  it('treats a non-object adjust as all zero', () => {
    expect(readAdjust(raw({ adjust: 5 })).adjust).toEqual(ZERO);
    expect(readAdjust(raw({ adjust: 'x' })).adjust).toEqual(ZERO);
    expect(readAdjust(raw({ adjust: null })).adjust).toEqual(ZERO);
    expect(readAdjust(raw({ adjust: [10, 20] })).adjust).toEqual(ZERO);
  });

  it('ignores unknown adjust keys', () => {
    expect(readAdjust(raw({ adjust: { warmth: 40, brightness: 10 } })).adjust)
      .toEqual({ brightness: 10, contrast: 0, saturation: 0 });
  });
});

describe('adjustFields', () => {
  it('returns an empty object for the defaults', () => {
    expect(adjustFields('none', ZERO)).toEqual({});
    expect(adjustFields('none', {})).toEqual({});
  });

  it('has no filter key for none', () => {
    expect('filter' in adjustFields('none', { brightness: 10 })).toBe(false);
  });

  it('keeps a real preset', () => {
    expect(adjustFields('noir', ZERO)).toEqual({ filter: 'noir' });
  });

  it('keeps only non-zero adjust keys', () => {
    expect(adjustFields('none', { brightness: 0, contrast: 30, saturation: 0 }))
      .toEqual({ adjust: { contrast: 30 } });
  });

  it('omits adjust when every value normalises to zero', () => {
    const fields = adjustFields('warm', { brightness: 0.4, contrast: -0, saturation: NaN });

    expect(fields).toEqual({ filter: 'warm' });
    expect('adjust' in fields).toBe(false);
  });

  it('normalises values', () => {
    expect(adjustFields('vivid', { brightness: 250, contrast: -12.5, saturation: 7.6 }))
      .toEqual({ filter: 'vivid', adjust: { brightness: 100, contrast: -12, saturation: 8 } });
  });

  it('drops an unknown filter', () => {
    expect(adjustFields('lomo' as unknown as ImageFilterPreset, ZERO)).toEqual({});
  });
});

describe('cssFilter', () => {
  it('is empty when nothing applies', () => {
    expect(cssFilter('none', ZERO)).toBe('');
    expect(cssFilter('none', {})).toBe('');
  });

  it.each([
    ['vivid', 'saturate(1.35) contrast(1.1)'],
    ['dramatic', 'contrast(1.3) saturate(1.15) brightness(0.95)'],
    ['warm', 'sepia(0.25) saturate(1.25)'],
    ['mono', 'grayscale(1)'],
    ['noir', 'grayscale(1) contrast(1.4) brightness(0.9)'],
    ['fade', 'contrast(0.85) brightness(1.08) saturate(0.75)'],
    ['sepia', 'sepia(0.75)'],
  ] as const)('emits the %s preset exactly', (filter, css) => {
    expect(cssFilter(filter, ZERO)).toBe(css);
  });

  it('maps each adjust value', () => {
    expect(cssFilter('none', { brightness: 50 })).toBe('brightness(1.25)');
    expect(cssFilter('none', { contrast: -100 })).toBe('contrast(0.5)');
    expect(cssFilter('none', { saturation: -100 })).toBe('saturate(0)');
    expect(cssFilter('none', { saturation: 100 })).toBe('saturate(2)');
  });

  it('formats numbers compactly to 4 decimals', () => {
    expect(cssFilter('none', { brightness: 1 })).toBe('brightness(1.005)');
    expect(cssFilter('none', { contrast: -33 })).toBe('contrast(0.835)');
    expect(cssFilter('none', { saturation: 7 })).toBe('saturate(1.07)');
  });

  it('orders adjust as brightness, contrast, saturate', () => {
    expect(cssFilter('none', { saturation: 20, contrast: 20, brightness: 20 }))
      .toBe('brightness(1.1) contrast(1.1) saturate(1.2)');
  });

  it('skips zero adjust values', () => {
    expect(cssFilter('none', { brightness: 0, contrast: 40, saturation: 0 })).toBe('contrast(1.2)');
  });

  it('puts the preset first, then adjust', () => {
    expect(cssFilter('mono', { brightness: -20, saturation: 10 }))
      .toBe('grayscale(1) brightness(0.9) saturate(1.1)');
  });

  it('normalises adjust values before mapping', () => {
    expect(cssFilter('none', { brightness: 300, contrast: 0.2, saturation: NaN })).toBe('brightness(1.5)');
    expect(cssFilter('none', { brightness: 2.5 })).toBe('brightness(1.015)');
  });
});

describe('isNeutral', () => {
  it('is true for none with zero adjust', () => {
    expect(isNeutral('none', ZERO)).toBe(true);
    expect(isNeutral('none', {})).toBe(true);
    expect(isNeutral('none', { brightness: 0.3 })).toBe(true);
  });

  it('is false with a preset', () => {
    expect(isNeutral('sepia', ZERO)).toBe(false);
  });

  it('is false with any non-zero adjust', () => {
    expect(isNeutral('none', { saturation: -1 })).toBe(false);
  });
});
