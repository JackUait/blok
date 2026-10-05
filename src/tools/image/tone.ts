export type Tone = 'paper' | 'graphite';
export interface Rgb { r: number; g: number; b: number }
export interface Rgba extends Rgb { a: number }
export interface ToneGrid { width: number; height: number; luminance: Float32Array }
/** Fractions of the visible picture: 0..1 from its left/top edge. */
export interface Region { x: number; y: number; w: number; h: number }

const channel = (v: number): number => {
  const s = v / 255;

  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export const relativeLuminance = ({ r, g, b }: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

// Must match the --blok-overlay-surface values of the [data-tone] rules in image.css.
const PAPER = relativeLuminance({ r: 255, g: 255, b: 255 });
const GRAPHITE = relativeLuminance({ r: 0x25, g: 0x25, b: 0x25 });

/** Paints background layers (innermost first, so on top) over `base`, as the browser stacks them. */
export const flatten = (layers: Rgba[], base: Rgb): Rgb =>
  layers.reduceRight<Rgb>((under, c) => ({
    r: c.r * c.a + under.r * (1 - c.a),
    g: c.g * c.a + under.g * (1 - c.a),
    b: c.b * c.a + under.b * (1 - c.a),
  }), base);

/** `pixels` is unpremultiplied RGBA, as getImageData returns it. */
export function luminanceGrid(pixels: Uint8ClampedArray, width: number, height: number, backdrop: Rgb): ToneGrid {
  const luminance = Float32Array.from({ length: width * height }, (_, i) => {
    const a = pixels[i * 4 + 3] / 255;

    return relativeLuminance({
      r: pixels[i * 4] * a + backdrop.r * (1 - a),
      g: pixels[i * 4 + 1] * a + backdrop.g * (1 - a),
      b: pixels[i * 4 + 2] * a + backdrop.b * (1 - a),
    });
  });

  return { width, height, luminance };
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const span = (start: number, size: number, cells: number): [number, number] | null => {
  const from = Math.max(0, start);
  const to = Math.min(1, start + size);

  if (size <= 0 || to <= from) return null;

  return [Math.min(cells - 1, Math.floor(from * cells)), Math.max(0, Math.ceil(to * cells) - 1)];
};

export function regionLuminance(grid: ToneGrid, region: Region): number | null {
  const xs = span(region.x, region.w, grid.width);
  const ys = span(region.y, region.h, grid.height);

  if (!xs || !ys) return null;
  const cells = range(ys[0], ys[1]).flatMap((y) => range(xs[0], xs[1]).map((x) => grid.luminance[y * grid.width + x]));

  return cells.reduce((sum, l) => sum + l, 0) / cells.length;
}

/** The tone closer to the area wins, so the chrome sits in the picture instead of on it. */
export const pickTone = (luminance: number): Tone =>
  contrast(luminance, PAPER) <= contrast(luminance, GRAPHITE) ? 'paper' : 'graphite';
