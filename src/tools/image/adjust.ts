import type { ImageAdjust, ImageData, ImageFilterPreset } from '../../../types/tools/image';

/** UI order. */
export const FILTER_PRESETS: readonly ImageFilterPreset[] = ['none', 'vivid', 'dramatic', 'warm', 'mono', 'noir', 'fade', 'sepia'];

export const ADJUST_KEYS = ['brightness', 'contrast', 'saturation'] as const;

type Adjust = Required<ImageAdjust>;

/** Only CSS filter functions, so the editor and every renderer look the same. */
const PRESET_CSS: Record<ImageFilterPreset, string> = {
  none: '',
  vivid: 'saturate(1.35) contrast(1.1)',
  dramatic: 'contrast(1.3) saturate(1.15) brightness(0.95)',
  warm: 'sepia(0.25) saturate(1.25)',
  mono: 'grayscale(1)',
  noir: 'grayscale(1) contrast(1.4) brightness(0.9)',
  fade: 'contrast(0.85) brightness(1.08) saturate(0.75)',
  sepia: 'sepia(0.75)',
};

const isPreset = (value: unknown): value is ImageFilterPreset =>
  typeof value === 'string' && (FILTER_PRESETS as readonly string[]).includes(value);

const normaliseValue = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  // `+ 0` turns -0 into 0.
  return Math.round(Math.min(100, Math.max(-100, value))) + 0;
};

const normaliseAdjust = (adjust: unknown): Adjust => {
  const source: Record<string, unknown> = typeof adjust === 'object' && adjust !== null && !Array.isArray(adjust)
    ? { ...adjust }
    : {};

  return {
    brightness: normaliseValue(source.brightness),
    contrast: normaliseValue(source.contrast),
    saturation: normaliseValue(source.saturation),
  };
};

const formatNumber = (value: number): string => String(Math.round(value * 10000) / 10000);

export function readAdjust(data: Partial<ImageData>): { filter: ImageFilterPreset; adjust: Adjust } {
  return {
    filter: isPreset(data.filter) ? data.filter : 'none',
    adjust: normaliseAdjust(data.adjust),
  };
}

export function adjustFields(filter: ImageFilterPreset, adjust: ImageAdjust): Pick<ImageData, 'filter' | 'adjust'> {
  const fields: Pick<ImageData, 'filter' | 'adjust'> = {};
  const values = normaliseAdjust(adjust);
  const kept: ImageAdjust = {};

  if (isPreset(filter) && filter !== 'none') {
    fields.filter = filter;
  }

  for (const key of ADJUST_KEYS) {
    if (values[key] !== 0) {
      kept[key] = values[key];
    }
  }

  if (Object.keys(kept).length > 0) {
    fields.adjust = kept;
  }

  return fields;
}

/** CSS `filter` value; '' when nothing applies. Preset first, then adjust. */
export function cssFilter(filter: ImageFilterPreset, adjust: ImageAdjust): string {
  const { brightness, contrast, saturation } = normaliseAdjust(adjust);
  const parts = [isPreset(filter) ? PRESET_CSS[filter] : ''];

  if (brightness !== 0) {
    parts.push(`brightness(${formatNumber(1 + brightness / 200)})`);
  }
  if (contrast !== 0) {
    parts.push(`contrast(${formatNumber(1 + contrast / 200)})`);
  }
  if (saturation !== 0) {
    parts.push(`saturate(${formatNumber(1 + saturation / 100)})`);
  }

  return parts.filter((part) => part !== '').join(' ');
}

/** One SVG filter primitive that does what one CSS filter function does. */
export type SvgFilterStep =
  | { kind: 'linear'; slope: number; intercept: number }
  | { kind: 'saturate'; amount: number }
  | { kind: 'matrix'; values: number[] };

const round4 = (v: number): number => Math.round(v * 10000) / 10000 + 0;

/** Rows from the Filter Effects spec, at amount 1; `1 - a` of the identity blends them back. */
const TONE_MATRIX: Record<'grayscale' | 'sepia', number[]> = {
  grayscale: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
  sepia: [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131],
};

const toneStep = (rows: number[], amount: number): SvgFilterStep => {
  const a = Math.min(1, Math.max(0, amount));
  const at = (i: number): number => round4((rows[i] ?? 0) * a + (i % 4 === 0 ? 1 - a : 0));

  return {
    kind: 'matrix',
    values: [at(0), at(1), at(2), 0, 0, at(3), at(4), at(5), 0, 0, at(6), at(7), at(8), 0, 0, 0, 0, 0, 1, 0],
  };
};

/**
 * The filter `cssFilter` writes, as SVG primitives. WebKit ignores CSS filter
 * functions on SVG content, so SVG copies of the photo need these instead.
 */
export function svgFilterSteps(css: string): SvgFilterStep[] {
  return Array.from(css.matchAll(/([a-z-]+)\(([-\d.]+)\)/g)).flatMap(([, fn, raw]): SvgFilterStep[] => {
    const v = Number(raw);

    if (!Number.isFinite(v)) return [];
    if (fn === 'brightness') return [{ kind: 'linear', slope: v, intercept: 0 }];
    if (fn === 'contrast') return [{ kind: 'linear', slope: v, intercept: round4(0.5 - 0.5 * v) }];
    if (fn === 'saturate') return [{ kind: 'saturate', amount: v }];
    if (fn === 'grayscale' || fn === 'sepia') return [toneStep(TONE_MATRIX[fn], v)];

    return [];
  });
}

export function isNeutral(filter: ImageFilterPreset, adjust: ImageAdjust): boolean {
  return cssFilter(filter, adjust) === '';
}
