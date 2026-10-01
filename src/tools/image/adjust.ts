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

export function isNeutral(filter: ImageFilterPreset, adjust: ImageAdjust): boolean {
  return cssFilter(filter, adjust) === '';
}
