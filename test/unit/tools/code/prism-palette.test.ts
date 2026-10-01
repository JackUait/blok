import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { LIGHT_RULES, DARK_RULES } from '../../../../src/tools/code/prism-applier';

const COLORS_CSS = readFileSync(resolve(__dirname, '../../../../src/styles/colors.css'), 'utf8');

/** Every `--blok-code-bg` declaration in colors.css: the light root first, then the dark theme blocks. */
const codeSurfaces = (): string[] =>
  Array.from(COLORS_CSS.matchAll(/--blok-code-bg:\s*(#[0-9a-f]{6})\s*;/gi), (m) => m[1]);

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

  it('keeps every light token at WCAG AA on the light code surface', () => {
    const [light] = codeSurfaces();
    const failing = tokenColors(LIGHT_RULES).filter((t) => contrast(t.hex, light) < 4.5);

    expect(failing).toStrictEqual([]);
  });

  it('keeps every dark token at WCAG AA on the dark code surface', () => {
    const [, dark] = codeSurfaces();
    const failing = tokenColors(DARK_RULES).filter((t) => contrast(t.hex, dark) < 4.5);

    expect(failing).toStrictEqual([]);
  });
});
