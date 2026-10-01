import type { ImageAdjust, ImageData, ImageFilterDefinition, ImageFilterPreset } from '../../../types/tools/image';

/** UI order. */
export const FILTER_PRESETS: readonly ImageFilterPreset[] = [
  'none',
  'vivid', 'vivid-warm', 'vivid-cool',
  'dramatic', 'dramatic-warm', 'dramatic-cool',
  'chrome', 'lomo',
  'warm', 'golden', 'cool', 'dusk',
  'fade', 'matte', 'pastel',
  'film', 'vintage', 'retro', 'sepia',
  'mono', 'silvertone', 'noir', 'high-key',
];

export const ADJUST_KEYS = ['brightness', 'contrast', 'saturation'] as const;

type Adjust = Required<ImageAdjust>;

/** Only functions `svgFilterSteps` can redraw, so the editor, every renderer and SVG copies look the same. */
type FilterFn = 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'sepia' | 'invert' | 'hue-rotate';

interface FilterOp {
  fn: FilterFn;
  value: number;
}

/** The value that leaves the image unchanged; strength blends toward it. */
const IDENTITY: Record<FilterFn, number> = {
  'brightness': 1,
  'contrast': 1,
  'saturate': 1,
  'grayscale': 0,
  'sepia': 0,
  'invert': 0,
  'hue-rotate': 0,
};

/** Amounts above 1 mean nothing for these. */
const CAPPED_AT_ONE: ReadonlySet<FilterFn> = new Set(['grayscale', 'sepia', 'invert']);

const PRESET_CSS: Record<ImageFilterPreset, string> = {
  'none': '',
  'vivid': 'saturate(1.35) contrast(1.1)',
  'vivid-warm': 'sepia(0.2) saturate(1.45) contrast(1.1)',
  'vivid-cool': 'saturate(1.35) contrast(1.1) hue-rotate(-12deg)',
  'dramatic': 'contrast(1.3) saturate(1.15) brightness(0.95)',
  'dramatic-warm': 'contrast(1.3) sepia(0.2) saturate(1.2) brightness(0.95)',
  'dramatic-cool': 'contrast(1.3) saturate(1.1) hue-rotate(-10deg) brightness(0.95)',
  'chrome': 'contrast(1.2) saturate(1.25) brightness(1.05)',
  'lomo': 'contrast(1.45) saturate(1.4) brightness(0.92)',
  'warm': 'sepia(0.25) saturate(1.25)',
  'golden': 'sepia(0.35) saturate(1.4) brightness(1.05) contrast(1.05)',
  'cool': 'saturate(1.05) hue-rotate(-12deg) brightness(1.03)',
  'dusk': 'sepia(0.25) hue-rotate(-20deg) saturate(1.15) brightness(0.9)',
  'fade': 'contrast(0.85) brightness(1.08) saturate(0.75)',
  'matte': 'contrast(0.8) brightness(1.1) saturate(0.9)',
  'pastel': 'saturate(0.6) brightness(1.15) contrast(0.85)',
  'film': 'contrast(1.1) saturate(0.85) sepia(0.12) brightness(1.02)',
  'vintage': 'sepia(0.35) contrast(0.9) brightness(1.05) saturate(0.85)',
  'retro': 'sepia(0.4) hue-rotate(-15deg) saturate(1.3) contrast(0.95)',
  'sepia': 'sepia(0.75)',
  'mono': 'grayscale(1)',
  'silvertone': 'grayscale(1) sepia(0.12) contrast(1.1) brightness(1.05)',
  'noir': 'grayscale(1) contrast(1.4) brightness(0.9)',
  'high-key': 'grayscale(1) brightness(1.2) contrast(0.9)',
};

const isPreset = (value: unknown): value is ImageFilterPreset =>
  typeof value === 'string' && (FILTER_PRESETS as readonly string[]).includes(value);

const ANGLE_TO_DEG: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };

const readOp = (fn: string, raw: string): FilterOp | null => {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(%|deg|grad|rad|turn)?$/.exec(raw.trim());

  if (match === null) return null;
  const n = Number(match[1]);
  const unit = match[2];

  if (fn === 'hue-rotate') {
    // A bare number is not a valid angle in CSS.
    return unit !== undefined && unit !== '%' ? { fn, value: n * ANGLE_TO_DEG[unit] } : null;
  }
  if (!Object.hasOwn(IDENTITY, fn) || (unit !== undefined && unit !== '%') || n < 0) return null;
  const amount = unit === '%' ? n / 100 : n;
  const op = fn as FilterFn;

  return { fn: op, value: CAPPED_AT_ONE.has(op) ? Math.min(1, amount) : amount };
};

/** Keeps the known functions, in order; everything else (url(), blur(), stray text) is dropped. */
const parseOps = (css: string): FilterOp[] =>
  Array.from(css.matchAll(/([a-z-]+)\(([^()]*)\)/g)).flatMap(([, fn, raw]) => {
    const op = readOp(fn, raw);

    return op === null ? [] : [op];
  });

/** A resolved filter list: what the strip offers, and how every known name looks. */
export interface FilterSet {
  /** Names the strip offers, Original first. */
  order: readonly string[];
  ops(name: string): readonly FilterOp[];
  /** A host filter's title; undefined for built-ins, which are translated. */
  title(name: string): string | undefined;
}

const BUILT_IN_OPS = new Map<string, FilterOp[]>(FILTER_PRESETS.map((p) => [p, parseOps(PRESET_CSS[p])]));

const isDefinition = (entry: unknown): entry is ImageFilterDefinition =>
  typeof entry === 'object' && entry !== null
  && typeof (entry as ImageFilterDefinition).name === 'string'
  && typeof (entry as ImageFilterDefinition).title === 'string'
  && typeof (entry as ImageFilterDefinition).css === 'string';

/** Builds the filter set from the tool's `filters` config. Built-ins always render, listed or not. */
export function resolveFilters(config: ReadonlyArray<ImageFilterPreset | ImageFilterDefinition> | undefined): FilterSet {
  const custom = new Map<string, { title: string; ops: FilterOp[] }>();
  const order: string[] = ['none'];

  for (const entry of config ?? FILTER_PRESETS) {
    const name = isDefinition(entry) ? entry.name : entry;

    if (typeof name !== 'string' || name === '' || name === 'none' || order.includes(name)) continue;
    if (isDefinition(entry)) {
      custom.set(name, { title: entry.title, ops: parseOps(entry.css) });
    } else if (!isPreset(name)) {
      continue;
    }
    order.push(name);
  }

  return {
    order,
    ops: (name) => custom.get(name)?.ops ?? BUILT_IN_OPS.get(name) ?? [],
    title: (name) => custom.get(name)?.title,
  };
}

export const DEFAULT_FILTERS: FilterSet = resolveFilters(undefined);

const normaliseValue = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  // `+ 0` turns -0 into 0.
  return Math.round(Math.min(100, Math.max(-100, value))) + 0;
};

const normaliseStrength = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) + 0 : 100;

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

const formatNumber = (value: number): string => String(Math.round(value * 10000) / 10000 + 0);

/** An unknown name is kept: it may be another host's filter, and dropping it would lose the user's look on save. */
const readFilterName = (value: unknown): string => (typeof value === 'string' && value !== '' ? value : 'none');

export function readAdjust(data: Partial<ImageData>): { filter: string; strength: number; adjust: Adjust } {
  return {
    filter: readFilterName(data.filter),
    strength: normaliseStrength(data.filterStrength),
    adjust: normaliseAdjust(data.adjust),
  };
}

export function adjustFields(
  filter: string,
  adjust: ImageAdjust,
  strength = 100
): Pick<ImageData, 'filter' | 'filterStrength' | 'adjust'> {
  const fields: Pick<ImageData, 'filter' | 'filterStrength' | 'adjust'> = {};
  const values = normaliseAdjust(adjust);
  const kept: ImageAdjust = {};
  const name = readFilterName(filter);
  const level = normaliseStrength(strength);

  if (name !== 'none') {
    fields.filter = name;
    if (level !== 100) fields.filterStrength = level;
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

const formatOp = ({ fn, value }: FilterOp, strength: number): string => {
  const scaled = IDENTITY[fn] + (value - IDENTITY[fn]) * strength;

  return fn === 'hue-rotate' ? `${fn}(${formatNumber(scaled)}deg)` : `${fn}(${formatNumber(scaled)})`;
};

/** CSS `filter` value; '' when nothing applies. Look first, scaled by strength, then adjust. */
export function cssFilter(filter: string, adjust: ImageAdjust, strength = 100, filters: FilterSet = DEFAULT_FILTERS): string {
  const { brightness, contrast, saturation } = normaliseAdjust(adjust);
  const level = normaliseStrength(strength) / 100;
  const parts = level === 0 ? [] : filters.ops(readFilterName(filter)).map((op) => formatOp(op, level));

  if (brightness !== 0) {
    parts.push(`brightness(${formatNumber(1 + brightness / 200)})`);
  }
  if (contrast !== 0) {
    parts.push(`contrast(${formatNumber(1 + contrast / 200)})`);
  }
  if (saturation !== 0) {
    parts.push(`saturate(${formatNumber(1 + saturation / 100)})`);
  }

  return parts.join(' ');
}

/** One SVG filter primitive that does what one CSS filter function does. */
export type SvgFilterStep =
  | { kind: 'linear'; slope: number; intercept: number }
  | { kind: 'saturate'; amount: number }
  | { kind: 'hue'; degrees: number }
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
  return Array.from(css.matchAll(/([a-z-]+)\(([-\d.]+)(deg)?\)/g)).flatMap(([, fn, raw]): SvgFilterStep[] => {
    const v = Number(raw);

    if (!Number.isFinite(v)) return [];
    if (fn === 'brightness') return [{ kind: 'linear', slope: v, intercept: 0 }];
    if (fn === 'contrast') return [{ kind: 'linear', slope: v, intercept: round4(0.5 - 0.5 * v) }];
    if (fn === 'saturate') return [{ kind: 'saturate', amount: v }];
    if (fn === 'grayscale' || fn === 'sepia') return [toneStep(TONE_MATRIX[fn], v)];
    if (fn === 'invert') return [{ kind: 'linear', slope: round4(1 - 2 * v), intercept: v }];
    if (fn === 'hue-rotate') return [{ kind: 'hue', degrees: v }];

    return [];
  });
}

export function isNeutral(filter: string, adjust: ImageAdjust): boolean {
  return cssFilter(filter, adjust) === '';
}
