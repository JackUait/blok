import { COLOR_PRESETS } from '../shared/color-presets';

/**
 * Parse a CSS color string (hex or rgb()) to an [R, G, B] tuple.
 * Returns null if the string cannot be parsed.
 */
export function parseColor(cssColor: string): [number, number, number] | null {
  const hex6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(cssColor);

  if (hex6) {
    return [parseInt(hex6[1], 16), parseInt(hex6[2], 16), parseInt(hex6[3], 16)];
  }

  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(cssColor);

  if (hex3) {
    return [
      parseInt(hex3[1] + hex3[1], 16),
      parseInt(hex3[2] + hex3[2], 16),
      parseInt(hex3[3] + hex3[3], 16),
    ];
  }

  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(cssColor);

  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }

  return null;
}

/** Saturation threshold below which a color is considered achromatic (gray/black/white) */
const ACHROMATIC_THRESHOLD = 0.10;

/**
 * Convert an RGB tuple (0-255 per channel) to HSL.
 *
 * @returns [H, S, L] where H is 0-360 degrees, S and L are 0-1
 */
function rgbToHsl(rgb: [number, number, number]): [number, number, number] {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  const hueFromMax = (channel: number): number => {
    if (channel === r) {
      return ((g - b) / d + (g < b ? 6 : 0)) / 6;
    }

    if (channel === g) {
      return ((b - r) / d + 2) / 6;
    }

    return ((r - g) / d + 4) / 6;
  };

  return [hueFromMax(max) * 360, s, l];
}

/**
 * Compute the perceptual distance between two colors using HSL with hue weighting.
 *
 * Achromatic colors (saturation below threshold) are compared by lightness only,
 * and are penalized heavily against chromatic colors to prevent gray mapping to
 * a saturated preset.
 *
 * Chromatic colors use weighted distance: hue (most important), saturation, lightness.
 * Hue distance is circular (wraps at 360 degrees).
 */
function hslDistance(
  hsl1: [number, number, number],
  hsl2: [number, number, number]
): number {
  const HUE_WEIGHT = 8;
  const SAT_WEIGHT = 1;
  const LIGHT_WEIGHT = 1;

  const isAchromatic1 = hsl1[1] < ACHROMATIC_THRESHOLD;
  const isAchromatic2 = hsl2[1] < ACHROMATIC_THRESHOLD;

  /* Both achromatic: compare lightness only */
  if (isAchromatic1 && isAchromatic2) {
    const lightDiff = Math.abs(hsl1[2] - hsl2[2]);

    return lightDiff * lightDiff;
  }

  /* One achromatic, one chromatic: large penalty so grays never match saturated presets */
  if (isAchromatic1 !== isAchromatic2) {
    return 1000;
  }

  /* Both chromatic: weighted HSL distance */
  const hueDiff = Math.abs(hsl1[0] - hsl2[0]);
  const circularHue = Math.min(hueDiff, 360 - hueDiff) / 180; // normalized 0-1
  const satDiff = Math.abs(hsl1[1] - hsl2[1]);
  const lightDiff = Math.abs(hsl1[2] - hsl2[2]);

  return (
    HUE_WEIGHT * circularHue * circularHue +
    SAT_WEIGHT * satDiff * satDiff +
    LIGHT_WEIGHT * lightDiff * lightDiff
  );
}

/**
 * Map an arbitrary CSS color to the nearest Blok preset color.
 *
 * Uses HSL-weighted distance with hue priority for perceptually intuitive results.
 *
 * @param cssColor - CSS color string (hex or rgb)
 * @param mode - 'text' for text color presets, 'bg' for background presets
 * @returns the nearest preset hex color, or the input unchanged if unparseable
 */
export function mapToNearestPresetColor(cssColor: string, mode: 'text' | 'bg'): string {
  const rgb = parseColor(cssColor);

  if (rgb === null) {
    return cssColor;
  }

  const hsl = rgbToHsl(rgb);

  const best = COLOR_PRESETS.reduce<{ color: string; distance: number }>(
    (acc, preset) => {
      const presetRgb = parseColor(preset[mode]);

      if (presetRgb === null) {
        return acc;
      }

      const distance = hslDistance(hsl, rgbToHsl(presetRgb));

      return distance < acc.distance ? { color: preset[mode], distance } : acc;
    },
    { color: cssColor, distance: Infinity }
  );

  return best.color;
}
