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

/**
 * Map an arbitrary CSS color to the nearest Blok preset color.
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

  let bestColor = cssColor;
  let bestDistance = Infinity;

  for (const preset of COLOR_PRESETS) {
    const presetHex = preset[mode];
    const presetRgb = parseColor(presetHex);

    if (presetRgb === null) {
      continue;
    }

    const distance =
      (rgb[0] - presetRgb[0]) ** 2 +
      (rgb[1] - presetRgb[1]) ** 2 +
      (rgb[2] - presetRgb[2]) ** 2;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestColor = presetHex;
    }
  }

  return bestColor;
}
