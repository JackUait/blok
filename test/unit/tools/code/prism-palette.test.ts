import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { LIGHT_RULES, DARK_RULES } from '../../../../src/tools/code/prism-applier';
import { ACTIVE_LINE_STYLES } from '../../../../src/tools/code/constants';

const COLORS_CSS = readFileSync(resolve(__dirname, '../../../../src/styles/colors.css'), 'utf8');

/** Every `--blok-code-bg` declaration in colors.css: the light root first, then the dark theme blocks. */
const codeSurfaces = (): string[] =>
  Array.from(COLORS_CSS.matchAll(/--blok-code-bg:\s*(#[0-9a-f]{6})\s*;/gi), (m) => m[1]);

/** Every `--blok-item-hover-bg` rgba in colors.css, in the same theme order as the surfaces. */
const hoverTints = (): Array<[number, number, number, number]> =>
  Array.from(COLORS_CSS.matchAll(/--blok-item-hover-bg:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g), (m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);

/** The active-line band's share of the hover tint, read from its class. */
const bandShare = (): number => {
  const match = /var\(--blok-item-hover-bg\)_(\d+)%/.exec(ACTIVE_LINE_STYLES);

  if (!match) {
    throw new Error('active-line band no longer mixes --blok-item-hover-bg');
  }

  return Number(match[1]) / 100;
};

/** The surface under the caret's line: the band composited over the code surface. */
const underBand = (surface: string, [r, g, b, a]: [number, number, number, number]): string => {
  const alpha = a * bandShare();
  const mix = (at: number, over: number): string =>
    Math.round(parseInt(surface.slice(at, at + 2), 16) * (1 - alpha) + over * alpha).toString(16).padStart(2, '0');

  return `#${mix(1, r)}${mix(3, g)}${mix(5, b)}`;
};

const channel = (hex: string, at: number): number => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string): number =>
  0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

/** `color: var(--blok-code-<role>, #hex)` pairs in one theme's rules. */
const tokenColors = (rules: string): Array<{ role: string; hex: string }> =>
  Array.from(rules.matchAll(/color:\s*var\(--blok-code-([a-z-]+),\s*(#[0-9a-f]{6})\)/gi), (m) => ({ role: m[1], hex: m[2] }));

describe('code syntax palette', () => {
  it('paints every token through a host-overridable --blok-code-* hook', () => {
    const bareHex = (rules: string): string[] => Array.from(rules.matchAll(/color:\s*(#[0-9a-f]{3,8})\s*;/gi), (m) => m[1]);

    expect(bareHex(LIGHT_RULES)).toStrictEqual([]);
    expect(bareHex(DARK_RULES)).toStrictEqual([]);
    expect(tokenColors(LIGHT_RULES).length).toBeGreaterThan(10);
    expect(tokenColors(DARK_RULES).length).toBeGreaterThan(10);
  });

  it('uses the same hook names in both themes, so one override reaches both', () => {
    const roles = (rules: string): string[] => [...new Set(tokenColors(rules).map((t) => t.role))].sort();

    expect(roles(DARK_RULES)).toStrictEqual(roles(LIGHT_RULES));
  });

  it('declares one solid code surface per theme block', () => {
    expect(codeSurfaces()).toHaveLength(3);
  });

  it('keeps every light token at WCAG AA on the light code surface and under the active-line band', () => {
    const [light] = codeSurfaces();
    const band = underBand(light, hoverTints()[0]);
    const failing = tokenColors(LIGHT_RULES).filter((t) => contrast(t.hex, light) < 4.5 || contrast(t.hex, band) < 4.5);

    expect(failing).toStrictEqual([]);
  });

  it('keeps every dark token at WCAG AA on the dark code surface and under the active-line band', () => {
    const [, dark] = codeSurfaces();
    const band = underBand(dark, hoverTints()[1]);
    const failing = tokenColors(DARK_RULES).filter((t) => contrast(t.hex, dark) < 4.5 || contrast(t.hex, band) < 4.5);

    expect(failing).toStrictEqual([]);
  });
});
