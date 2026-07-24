/**
 * Detect default page background colors that should NOT be mapped to a Blok preset.
 *
 * When browsers natively copy from a contenteditable, computed styles include
 * the resolved page background (e.g. `rgb(255, 255, 255)` in light mode,
 * `rgb(25, 25, 24)` in Blok's dark mode). These are not intentional formatting
 * and would otherwise collapse onto the gray bg preset since gray is the only
 * achromatic background.
 *
 * Centralized here so every consumer (paste preprocessors, table clipboard,
 * HTML import, color-mapping itself) shares the same definition.
 *
 * Kept dependency-free (no import of color-mapping) to avoid a circular
 * import — color-mapping uses these predicates as a defense-in-depth guard.
 */

/**
 * True when bgColor is the default white page background
 * (`#fff`, `#ffffff`, `rgb(255,255,255)`, or the keyword `white`).
 */
export function isDefaultWhiteBackground(bgColor: string): boolean {
  const normalized = bgColor.replace(/\s/g, '').toLowerCase();

  return (
    normalized === 'rgb(255,255,255)' ||
    normalized === '#ffffff' ||
    normalized === '#fff' ||
    normalized === 'white'
  );
}

/**
 * Compute simplified linear luminance (no gamma correction) of a CSS color
 * value. Adequate for threshold comparisons used to spot default page bgs.
 *
 * Supports: `#rgb`, `#rrggbb`, `rgb(...)`, `rgba(...)`, `hsl(...)`, `hsla(...)`.
 * Alpha is ignored. Returns -1 if the format is unrecognized.
 */
function computeRelativeLuminance(color: string): number {
  const normalized = color.replace(/\s/g, '').toLowerCase();

  const rgbMatch = /^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/.exec(normalized);

  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10) / 255;
    const g = parseInt(rgbMatch[2], 10) / 255;
    const b = parseInt(rgbMatch[3], 10) / 255;

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const hslMatch = /^hsla?\(([\d.]+),([\d.]+)%,([\d.]+)%(?:,[\d.]+)?\)$/.exec(normalized);

  if (hslMatch) {
    const h = parseFloat(hslMatch[1]) / 360;
    const s = parseFloat(hslMatch[2]) / 100;
    const l = parseFloat(hslMatch[3]) / 100;

    if (s === 0) {
      /* achromatic — r = g = b = l */
      return 0.2126 * l + 0.7152 * l + 0.0722 * l;
    }

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const wrap = (t: number): number => {
      if (t < 0) {
        return t + 1;
      }

      if (t > 1) {
        return t - 1;
      }

      return t;
    };
    const hueToChannel = (t: number): number => {
      const wrapped = wrap(t);

      if (wrapped < 1 / 6) {
        return p + (q - p) * 6 * wrapped;
      }

      if (wrapped < 1 / 2) {
        return q;
      }

      if (wrapped < 2 / 3) {
        return p + (q - p) * (2 / 3 - wrapped) * 6;
      }

      return p;
    };

    const r = hueToChannel(h + 1 / 3);
    const g = hueToChannel(h);
    const b = hueToChannel(h - 1 / 3);

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const hexMatch = /^#([0-9a-f]{6}|[0-9a-f]{3})$/.exec(normalized);

  if (hexMatch) {
    const hex = hexMatch[1];
    const expand = hex.length === 3
      ? [hex[0] + hex[0], hex[1] + hex[1], hex[2] + hex[2]]
      : [hex.substring(0, 2), hex.substring(2, 4), hex.substring(4, 6)];
    const r = parseInt(expand[0], 16) / 255;
    const g = parseInt(expand[1], 16) / 255;
    const b = parseInt(expand[2], 16) / 255;

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  return -1;
}

/**
 * True when bgColor is a near-black (dark mode page) background.
 *
 * Uses simplified linear luminance < 0.12 — below all Blok dark bg presets
 * (~18% minimum lightness for #2f2f2f, lin-luminance ≈ 0.184) while catching
 * typical dark page backgrounds (`#191918` ≈ 0.098, `rgb(25,25,24)` ≈ 0.098).
 */
export function isDefaultDarkBackground(bgColor: string): boolean {
  const luminance = computeRelativeLuminance(bgColor);

  return luminance >= 0 && luminance < 0.12;
}

/**
 * Minimum value each RGB channel must reach for a colour to count as
 * "near-white". Deliberately high (250) so it strips only backgrounds that are
 * visually white — Blok's lightest genuine highlight preset (`#f1f1ef`,
 * channels 241/241/239) stays below it and survives.
 */
const NEAR_WHITE_MIN_CHANNEL = 250;

/**
 * Parse a CSS colour into 8-bit RGB channels plus alpha. Handles the forms
 * paste sources emit — `#rgb`, `#rrggbb`, `rgb(...)`, `rgba(...)` and the
 * `white`/`transparent` keywords. Returns null for anything else (hsl, named
 * colours other than white/transparent), which callers treat as "not invisible".
 */
function parseRgba(color: string): { r: number; g: number; b: number; a: number } | null {
  const normalized = color.replace(/\s/g, '').toLowerCase();

  if (normalized === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  if (normalized === 'white') {
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  const rgbMatch = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/.exec(normalized);

  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10),
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    };
  }

  const hexMatch = /^#([0-9a-f]{6}|[0-9a-f]{3})$/.exec(normalized);

  if (hexMatch) {
    const hex = hexMatch[1];
    const expand = hex.length === 3
      ? [hex[0] + hex[0], hex[1] + hex[1], hex[2] + hex[2]]
      : [hex.substring(0, 2), hex.substring(2, 4), hex.substring(4, 6)];

    return {
      r: parseInt(expand[0], 16),
      g: parseInt(expand[1], 16),
      b: parseInt(expand[2], 16),
      a: 1,
    };
  }

  return null;
}

/**
 * True when a pasted `background-color` produces no visible highlight and
 * should be dropped instead of mapped to a Blok preset — i.e. it is
 * transparent (or zero-alpha), near-white (matches the light page bg), or a
 * near-black dark-mode page bg.
 *
 * This is the single definition shared by the marker sanitizer and the paste
 * preprocessors so every path agrees on what counts as "invisible" — pasting a
 * Summernote/near-white/transparent span no longer leaves a spurious empty
 * `<mark>`. Genuine highlights (including Blok's pale gray `#f1f1ef`) are kept.
 */
export function isInvisibleBackground(bgColor: string): boolean {
  const rgba = parseRgba(bgColor);

  if (rgba !== null) {
    if (rgba.a === 0) {
      return true;
    }

    if (rgba.r >= NEAR_WHITE_MIN_CHANNEL && rgba.g >= NEAR_WHITE_MIN_CHANNEL && rgba.b >= NEAR_WHITE_MIN_CHANNEL) {
      return true;
    }
  }

  return isDefaultDarkBackground(bgColor);
}
