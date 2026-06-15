import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

/**
 * Regression: the image alt-text popover must follow the page theme.
 *
 * Root cause of the bug it guards: alt-popover.css painted its surface with
 * `--blok-surface-strong` / `--blok-surface-muted` / `--blok-alt-popover-shadow`,
 * tokens that were declared ONCE — inside the light-theme palette block — but
 * with hardcoded DARK values (#1e1e1e). No theme ever re-declared them, so the
 * popover rendered dark in light theme.
 *
 * These tests prove the popover's surface tokens are (a) theme-aware
 * (different value in light vs dark palette) and (b) actually light in light
 * theme.
 */

const css = readMainCss();

function findMatchingBrace(source: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    if (depth === 0 && source[i] === '}') return i;
  }
  return -1;
}

/** Body of the first brace block whose declarations contain `needle`. */
function blockContaining(needle: string): string {
  for (let i = 0; i < css.length; i++) {
    if (css[i] !== '{') continue;
    const close = findMatchingBrace(css, i);
    if (close === -1) continue;
    const body = css.slice(i + 1, close);
    if (body.includes(needle)) return body;
    i = close;
  }
  throw new Error(`no palette block contains: ${needle}`);
}

/** Map of `--token` → value for every custom property declared in `body`. */
function tokenMap(body: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(--[a-z][\w-]*)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) map.set(m[1], m[2].trim());
  return map;
}

/** Var name referenced by the FIRST `var(--x)` inside `declaration`. */
function varName(declaration: string): string {
  const m = /var\(\s*(--[a-z][\w-]*)/.exec(declaration);
  if (!m) throw new Error(`no var() in: ${declaration}`);
  return m[1];
}

/** Declarations of the `.blok-image-alt-popover` surface rule. */
function altSurfaceRule(): string {
  // Rule selector groups the bare class and the popover-attr variant.
  const idx = css.indexOf('.blok-image-alt-popover,');
  if (idx === -1) throw new Error('alt popover surface rule missing');
  const open = css.indexOf('{', idx);
  return css.slice(open + 1, findMatchingBrace(css, open));
}

function altInputRule(): string {
  const idx = css.indexOf('.blok-image-alt-popover__input {');
  if (idx === -1) throw new Error('alt popover input rule missing');
  const open = css.indexOf('{', idx);
  return css.slice(open + 1, findMatchingBrace(css, open));
}

const light = tokenMap(blockContaining('--blok-selection: #e1f2ff'));
const dark = tokenMap(blockContaining('--blok-popover-bg: #252525'));

function declLine(body: string, prop: string): string {
  const m = new RegExp(`\\b${prop}\\s*:[^;]+;`).exec(body);
  if (!m) throw new Error(`no ${prop} in rule`);
  return m[0];
}

/** Rough luminance of a hex color (#rgb/#rrggbb). */
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

describe('image alt popover theming', () => {
  it('paints its surface with a theme-aware token (light ≠ dark)', () => {
    const bgVar = varName(declLine(altSurfaceRule(), 'background'));
    const lightVal = light.get(bgVar);
    const darkVal = dark.get(bgVar) ?? lightVal; // missing in dark → inherits light
    expect(lightVal).toBeDefined();
    expect(lightVal).not.toBe(darkVal);
  });

  it('uses a light surface color in light theme', () => {
    const bgVar = varName(declLine(altSurfaceRule(), 'background'));
    const lightVal = light.get(bgVar);
    if (!lightVal || !lightVal.startsWith('#')) throw new Error(`expected hex, got ${lightVal}`);
    expect(hexLuminance(lightVal)).toBeGreaterThan(0.5);
  });

  it('paints its input field with a theme-aware token (light ≠ dark)', () => {
    const bgVar = varName(declLine(altInputRule(), 'background'));
    const lightVal = light.get(bgVar);
    const darkVal = dark.get(bgVar) ?? lightVal;
    expect(lightVal).toBeDefined();
    expect(lightVal).not.toBe(darkVal);
  });

  it('uses a theme-aware drop shadow (light ≠ dark)', () => {
    const shadowVar = varName(declLine(altSurfaceRule(), 'box-shadow'));
    const lightVal = light.get(shadowVar);
    const darkVal = dark.get(shadowVar) ?? lightVal;
    expect(lightVal).toBeDefined();
    expect(lightVal).not.toBe(darkVal);
  });
});

/** Declarations of the base `[data-blok-tool="image"] .blok-image-toolbar` rule. */
function imageToolbarRule(): string {
  const idx = css.indexOf('[data-blok-tool="image"] .blok-image-toolbar {');
  if (idx === -1) throw new Error('image toolbar rule missing');
  const open = css.indexOf('{', idx);
  return css.slice(open + 1, findMatchingBrace(css, open));
}

describe('image overlay toolbar theming', () => {
  it('paints its surface with a theme-aware token (light ≠ dark)', () => {
    const bgVar = varName(declLine(imageToolbarRule(), 'background'));
    const lightVal = light.get(bgVar);
    const darkVal = dark.get(bgVar) ?? lightVal;
    expect(lightVal).toBeDefined();
    expect(lightVal).not.toBe(darkVal);
  });

  it('uses a light surface color in light theme', () => {
    const bgVar = varName(declLine(imageToolbarRule(), 'background'));
    const lightVal = light.get(bgVar);
    if (!lightVal || !lightVal.startsWith('#')) throw new Error(`expected hex, got ${lightVal}`);
    expect(hexLuminance(lightVal)).toBeGreaterThan(0.5);
  });
});
