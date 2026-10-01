import { describe, it, expect } from 'vitest';
import type { ImageData, ImageFilterPreset } from '../../../../types/tools/image';
import {
  ADJUST_KEYS,
  FILTER_PRESETS,
  adjustFields,
  cssFilter,
  isNeutral,
  readAdjust,
  resolveFilters,
  svgFilterSteps,
} from '../../../../src/tools/image/adjust';

const ZERO = { brightness: 0, contrast: 0, saturation: 0 };

/** Builds data with fields the type would reject, as a stored document may hold. */
const raw = (fields: Record<string, unknown>): Partial<ImageData> => fields;

describe('constants', () => {
  it('lists 24 presets in UI order, none first', () => {
    expect(FILTER_PRESETS).toEqual([
      'none',
      'vivid', 'vivid-warm', 'vivid-cool',
      'dramatic', 'dramatic-warm', 'dramatic-cool',
      'chrome', 'lomo',
      'warm', 'golden', 'cool', 'dusk',
      'fade', 'matte', 'pastel',
      'film', 'vintage', 'retro', 'sepia',
      'mono', 'silvertone', 'noir', 'high-key',
    ]);
  });

  it('lists adjust keys in order', () => {
    expect(ADJUST_KEYS).toEqual(['brightness', 'contrast', 'saturation']);
  });
});

describe('readAdjust', () => {
  it('defaults to none, full strength and all zero when fields are absent', () => {
    expect(readAdjust({})).toEqual({ filter: 'none', strength: 100, adjust: ZERO });
  });

  it('keeps every known preset', () => {
    for (const filter of FILTER_PRESETS) {
      expect(readAdjust({ filter }).filter).toBe(filter);
    }
  });

  it('keeps a filter name it does not know, so a host filter survives another host', () => {
    expect(readAdjust(raw({ filter: 'brand-look' })).filter).toBe('brand-look');
  });

  it('drops a non-string or empty filter to none', () => {
    expect(readAdjust(raw({ filter: 3 })).filter).toBe('none');
    expect(readAdjust(raw({ filter: '' })).filter).toBe('none');
    expect(readAdjust(raw({ filter: null })).filter).toBe('none');
  });

  it('reads strength as a whole number in 0..100', () => {
    expect(readAdjust(raw({ filter: 'vivid', filterStrength: 40 })).strength).toBe(40);
    expect(readAdjust(raw({ filter: 'vivid', filterStrength: 140 })).strength).toBe(100);
    expect(readAdjust(raw({ filter: 'vivid', filterStrength: -3 })).strength).toBe(0);
    expect(readAdjust(raw({ filter: 'vivid', filterStrength: 12.6 })).strength).toBe(13);
    expect(readAdjust(raw({ filter: 'vivid', filterStrength: 'x' })).strength).toBe(100);
    expect(readAdjust(raw({ filter: 'vivid', filterStrength: NaN })).strength).toBe(100);
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

  it('keeps a filter name it does not know', () => {
    expect(adjustFields('brand-look', ZERO)).toEqual({ filter: 'brand-look' });
  });

  it('drops an empty or non-string filter', () => {
    expect(adjustFields('', ZERO)).toEqual({});
    expect(adjustFields(3 as unknown as ImageFilterPreset, ZERO)).toEqual({});
  });

  it('omits strength at 100 and with no filter', () => {
    expect(adjustFields('vivid', ZERO, 100)).toEqual({ filter: 'vivid' });
    expect(adjustFields('none', ZERO, 40)).toEqual({});
  });

  it('keeps a lower strength, rounded and clamped', () => {
    expect(adjustFields('vivid', ZERO, 40)).toEqual({ filter: 'vivid', filterStrength: 40 });
    expect(adjustFields('vivid', ZERO, 0)).toEqual({ filter: 'vivid', filterStrength: 0 });
    expect(adjustFields('vivid', ZERO, 33.4)).toEqual({ filter: 'vivid', filterStrength: 33 });
    expect(adjustFields('vivid', ZERO, -5)).toEqual({ filter: 'vivid', filterStrength: 0 });
    expect(adjustFields('vivid', ZERO, 180)).toEqual({ filter: 'vivid' });
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

  it('gives every preset but none a look of its own', () => {
    const looks = FILTER_PRESETS.filter((p) => p !== 'none').map((p) => cssFilter(p, ZERO));

    expect(looks.every((css) => css !== '')).toBe(true);
    expect(new Set(looks).size).toBe(looks.length);
  });

  it('renders an unknown filter as no look', () => {
    expect(cssFilter('brand-look', ZERO)).toBe('');
    expect(cssFilter('toString', ZERO)).toBe('');
  });

  it('scales each function toward its identity by strength', () => {
    expect(cssFilter('noir', ZERO, 50)).toBe('grayscale(0.5) contrast(1.2) brightness(0.95)');
    expect(cssFilter('retro', ZERO, 50)).toBe('sepia(0.2) hue-rotate(-7.5deg) saturate(1.15) contrast(0.975)');
  });

  it('drops the look at strength 0 but keeps the adjustments', () => {
    expect(cssFilter('noir', ZERO, 0)).toBe('');
    expect(cssFilter('noir', { brightness: 50 }, 0)).toBe('brightness(1.25)');
  });

  it('does not scale the adjustments by strength', () => {
    expect(cssFilter('mono', { brightness: 50 }, 50)).toBe('grayscale(0.5) brightness(1.25)');
  });

  it('reads a host filter from the given set', () => {
    const filters = resolveFilters([{ name: 'brand', title: 'Brand', css: 'sepia(0.5) hue-rotate(20deg)' }]);

    expect(cssFilter('brand', ZERO, 100, filters)).toBe('sepia(0.5) hue-rotate(20deg)');
    expect(cssFilter('brand', ZERO, 50, filters)).toBe('sepia(0.25) hue-rotate(10deg)');
  });

  it('still renders a built-in the host left out of its list', () => {
    const filters = resolveFilters(['vivid']);

    expect(cssFilter('noir', ZERO, 100, filters)).toBe('grayscale(1) contrast(1.4) brightness(0.9)');
  });
});

describe('resolveFilters', () => {
  it('offers every built-in, in order, when the host sets nothing', () => {
    expect(resolveFilters(undefined).order).toEqual(FILTER_PRESETS);
  });

  it('keeps the host order, with Original always first and once', () => {
    expect(resolveFilters(['noir', 'none', 'vivid']).order).toEqual(['none', 'noir', 'vivid']);
  });

  it('offers only Original for an empty list', () => {
    expect(resolveFilters([]).order).toEqual(['none']);
  });

  it('skips unknown names, duplicates and malformed entries', () => {
    const filters = resolveFilters([
      'vivid',
      'nope' as ImageFilterPreset,
      'vivid',
      { name: '', title: 'Empty', css: 'sepia(1)' },
      { name: 'none', title: 'Not original', css: 'sepia(1)' },
      { name: 'x', title: 'X', css: 3 as unknown as string },
      null as unknown as ImageFilterPreset,
    ]);

    expect(filters.order).toEqual(['none', 'vivid']);
  });

  it('sorts the built-ins into six families, in strip order', () => {
    expect(resolveFilters(undefined).groups).toEqual([
      { key: 'vivid', names: ['vivid', 'vivid-warm', 'vivid-cool', 'chrome', 'lomo'] },
      { key: 'dramatic', names: ['dramatic', 'dramatic-warm', 'dramatic-cool'] },
      { key: 'tone', names: ['warm', 'golden', 'cool', 'dusk'] },
      { key: 'soft', names: ['fade', 'matte', 'pastel'] },
      { key: 'vintage', names: ['film', 'vintage', 'retro', 'sepia'] },
      { key: 'bw', names: ['mono', 'silvertone', 'noir', 'high-key'] },
    ]);
  });

  it('keeps only families the host list uses, in its order within each, and puts host filters in Custom', () => {
    const filters = resolveFilters(['noir', { name: 'brand', title: 'Brand', css: 'sepia(1)' }, 'mono', 'vivid']);

    expect(filters.groups).toEqual([
      { key: 'vivid', names: ['vivid'] },
      { key: 'bw', names: ['noir', 'mono'] },
      { key: 'custom', names: ['brand'] },
    ]);
  });

  it('a host entry that retunes a built-in name stays in that built-in\'s family', () => {
    expect(resolveFilters([{ name: 'noir', title: 'Ink', css: 'grayscale(1)' }]).groups).toEqual([{ key: 'bw', names: ['noir'] }]);
  });

  it('names the family of any look, Custom for a name it does not know', () => {
    const filters = resolveFilters(['vivid']);

    expect(filters.groupOf('retro')).toBe('vintage');
    expect(filters.groupOf('brand')).toBe('custom');
    expect(filters.groupOf('none')).toBeUndefined();
  });

  it('adds a host filter with its title', () => {
    const filters = resolveFilters([{ name: 'brand', title: 'Brand', css: 'saturate(1.2)' }]);

    expect(filters.order).toEqual(['none', 'brand']);
    expect(filters.title('brand')).toBe('Brand');
    expect(filters.title('vivid')).toBeUndefined();
  });

  it('lets a host entry retune a built-in name', () => {
    const filters = resolveFilters([{ name: 'vivid', title: 'Punchy', css: 'saturate(2)' }]);

    expect(cssFilter('vivid', ZERO, 100, filters)).toBe('saturate(2)');
    expect(filters.title('vivid')).toBe('Punchy');
  });

  it('keeps only the CSS functions it can also draw in SVG', () => {
    const filters = resolveFilters([{
      name: 'brand',
      title: 'Brand',
      css: 'constructor(1) url(#x) blur(2px) drop-shadow(0 0 2px red) sepia(50%) invert(0.1) opacity(0.5) hue-rotate(0.5turn) saturate(1.2);background:red',
    }]);

    expect(cssFilter('brand', ZERO, 100, filters)).toBe('sepia(0.5) invert(0.1) hue-rotate(180deg) saturate(1.2)');
  });

  it('reads hue-rotate in deg, rad, grad and turn', () => {
    const css = (value: string): string =>
      cssFilter('h', ZERO, 100, resolveFilters([{ name: 'h', title: 'H', css: `hue-rotate(${value})` }]));

    expect(css('90deg')).toBe('hue-rotate(90deg)');
    expect(css('100grad')).toBe('hue-rotate(90deg)');
    expect(css('0.25turn')).toBe('hue-rotate(90deg)');
    expect(css('3.14159265rad')).toBe('hue-rotate(180deg)');
    expect(css('90')).toBe('');
  });

  it('clamps grayscale, sepia and invert to 1 and rejects negative amounts', () => {
    const filters = resolveFilters([{ name: 'h', title: 'H', css: 'grayscale(3) sepia(-1) invert(200%) brightness(-2)' }]);

    expect(cssFilter('h', ZERO, 100, filters)).toBe('grayscale(1) invert(1)');
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

describe('svgFilterSteps', () => {
  it('maps every function the darkroom writes onto its Filter Effects primitive', () => {
    expect(svgFilterSteps('brightness(1.5) contrast(1.2) saturate(0.5)')).toEqual([
      { kind: 'linear', slope: 1.5, intercept: 0 },
      { kind: 'linear', slope: 1.2, intercept: -0.1 },
      { kind: 'saturate', amount: 0.5 },
    ]);
  });

  it('turns grayscale and sepia into their spec matrices', () => {
    const [gray] = svgFilterSteps('grayscale(1)');
    const [sepia] = svgFilterSteps('sepia(1)');

    expect(gray?.kind).toBe('matrix');
    expect(gray?.kind === 'matrix' ? gray.values.slice(0, 3) : []).toEqual([0.2126, 0.7152, 0.0722]);
    expect(sepia?.kind === 'matrix' ? sepia.values.slice(0, 3) : []).toEqual([0.393, 0.769, 0.189]);
  });

  it('maps hue-rotate onto hueRotate and invert onto a linear transfer', () => {
    const [hue] = svgFilterSteps('hue-rotate(180deg)');
    const [inv] = svgFilterSteps('invert(0.25)');

    expect(hue).toEqual({ kind: 'hue', degrees: 180 });
    expect(inv).toEqual({ kind: 'linear', slope: 0.5, intercept: 0.25 });
  });

  it('reads every preset and skips what it does not know', () => {
    FILTER_PRESETS.forEach((preset) => {
      const css = cssFilter(preset, {});

      expect(svgFilterSteps(css)).toHaveLength(css === '' ? 0 : css.split(') ').length);
    });
    expect(svgFilterSteps('blur(2px) none')).toEqual([]);
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
