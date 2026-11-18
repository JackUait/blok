/**
 * Cover of a recent link that has no picture: a strong color worked out from
 * the site name, with the site's first letter on it in a lighter tone.
 */
export interface LinkCover {
  background: string;
  letter: string;
  /** Caption color: white, or dark ink on a cover too bright for white. */
  ink: string;
}

const SATURATION = 68;
const LIGHTNESS = 44;
const LETTER_SATURATION = 78;
// The letter is always this much lighter than its cover.
const LETTER_LIFT = 13;
const LIGHT_INK = '#fff';
const DARK_INK = '#1c1b19';
const DARK_INK_LUMINANCE = 0.0109;
// WCAG AA for the 13px title.
const MIN_CONTRAST = 4.5;

const channel = (value: number): number => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

const luminance = (hue: number, lightness: number): number => {
  const s = SATURATION / 100;
  const l = lightness / 100;
  const a = s * Math.min(l, 1 - l);
  const part = (n: number): number => {
    const k = (n + hue / 30) % 12;

    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };

  return 0.2126 * channel(part(0)) + 0.7152 * channel(part(8)) + 0.0722 * channel(part(4));
};

const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const build = (hue: number, lightness: number, ink: string): LinkCover => ({
  background: `hsl(${hue} ${SATURATION}% ${lightness}%)`,
  letter: `hsl(${hue} ${LETTER_SATURATION}% ${lightness + LETTER_LIFT}%)`,
  ink,
});

/**
 * @param hue - 0 to 359
 */
export function coverColorsForHue(hue: number): LinkCover {
  const base = luminance(hue, LIGHTNESS);

  if (contrast(base, 1) >= MIN_CONTRAST) {
    return build(hue, LIGHTNESS, LIGHT_INK);
  }

  if (contrast(base, DARK_INK_LUMINANCE) >= MIN_CONTRAST) {
    return build(hue, LIGHTNESS, DARK_INK);
  }

  // Too bright for white, too dark for ink: darken until white reads.
  const steps = Array.from({ length: LIGHTNESS }, (_, step) => LIGHTNESS - step);
  const lightness = steps.find((candidate) => contrast(luminance(hue, candidate), 1) >= MIN_CONTRAST) ?? 0;

  return build(hue, lightness, LIGHT_INK);
}

/**
 * The same site always gets the same cover.
 * @param site - host name without "www."
 */
export function coverColors(site: string): LinkCover {
  return coverColorsForHue(Array.from(site).reduce((hue, char) => (hue * 31 + (char.codePointAt(0) ?? 0)) % 360, 0));
}
