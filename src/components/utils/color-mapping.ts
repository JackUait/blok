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
