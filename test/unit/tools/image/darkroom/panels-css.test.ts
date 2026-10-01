import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const full = readFileSync(resolve(__dirname, '../../../../../src/tools/image/darkroom/darkroom.css'), 'utf8');
const MARKER = '/* Panels: dial, mode tabs, adjust, filters */';
const section = full.includes(MARKER) ? full.slice(full.indexOf(MARKER)) : '';

/** selector → joined declarations of every rule naming exactly that selector. */
const body = (css: string, selector: string): string => {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];

  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(/,(?![^(]*\))/).map((s) => s.trim().replace(/\s+/g, ' '));

    if (selectors.includes(selector)) bodies.push(m[2]);
  }

  return bodies.join(';');
};

const BLUE = /#(?:3b82f6|2563eb|1d4ed8|0a84ff|007aff|4a90e2)|\bblue\b|--blok-(?:link|focus)/i;
const SELECTED = [
  '.blok-darkroom__tab[data-active="true"]',
  '.blok-darkroom__filter[data-active="true"]',
];
const SCOPES = ['.blok-darkroom__tabs', '.blok-darkroom__adjust', '.blok-darkroom__filters', '.blok-darkroom__dial'];

describe('darkroom.css panels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lives in its own section at the end of the file', () => {
    expect(section).not.toBe('');
  });

  it.each(SELECTED)('%s is neutral: active tokens, never blue', (selector) => {
    const rule = body(section, selector);

    expect(rule).toMatch(/background:\s*var\(--blok-icon-active-bg\)/);
    expect(rule).toMatch(/color:\s*var\(--blok-icon-active-text\)/);
    expect(rule).not.toMatch(BLUE);
  });

  it('the selected adjust chip reuses the neutral chip rule', () => {
    expect(body(full, '.blok-darkroom__chip[data-active="true"]')).toContain('var(--blok-icon-active-bg)');
  });

  it.each(SCOPES)('%s re-declares light ink for the dark glass, whatever the host theme', (scope) => {
    const rule = body(section, scope);

    expect(rule).toMatch(/--blok-icon-active-bg:\s*rgba\(255, 255, 255, 0?\.\d+\)/);
    expect(rule).toMatch(/--blok-text-primary:\s*var\(--blok-darkroom-ink\)/);
    expect(rule).toMatch(/--blok-icon-active-text:\s*var\(--blok-text-primary\)/);
  });

  it('nothing but the focus ring is blue', () => {
    expect(section.replace(/outline:\s*2px solid var\(--blok-focus-ring\);/g, '')).not.toMatch(BLUE);
  });

  it('the dial owns touch so a drag never scrolls the page', () => {
    expect(body(section, '.blok-darkroom__dial')).toMatch(/touch-action:\s*none/);
  });

  it('the filter strip scrolls sideways when it overflows', () => {
    expect(body(section, '.blok-darkroom__filters')).toMatch(/overflow-x:\s*auto/);
  });

  it('stacks the strength slider under the strip, and a hidden one takes no room', () => {
    expect(body(section, '.blok-darkroom__filter-panel')).toMatch(/flex-direction:\s*column/);
    expect(body(full, '.blok-darkroom__dial-box[hidden]')).toMatch(/display:\s*none/);
  });

  it('shows a tool reset only for a changed value, keeping its cell', () => {
    const off = body(section, '.blok-darkroom__adjust-reset[data-shown="false"]');

    expect(off).toMatch(/visibility:\s*hidden/);
    expect(off).not.toMatch(/display:\s*none/);
    expect(body(section, '.blok-darkroom__adjust-dot')).toBe('');
  });

  it('the reset layer lies over the chips on the same three-column grid', () => {
    const cols = /grid-template-columns:\s*repeat\(3, 1fr\)/;

    expect(body(section, '.blok-darkroom__adjust-tools')).toMatch(cols);
    expect(body(section, '.blok-darkroom__adjust-resets')).toMatch(cols);
    expect(body(section, '.blok-darkroom__adjust-row > *')).toMatch(/grid-area:\s*1 \/ 1/);
    // The layer covers the chips, so only its buttons may take a press.
    expect(body(section, '.blok-darkroom__adjust-resets')).toMatch(/pointer-events:\s*none/);
    expect(body(section, '.blok-darkroom__adjust-reset')).toMatch(/pointer-events:\s*auto/);
    expect(body(section, '.blok-darkroom__adjust-reset')).not.toMatch(BLUE);
  });

  it('keyboard focus is visible on every new control', () => {
    ['.blok-darkroom__tab:focus-visible', '.blok-darkroom__filter:focus-visible', '.blok-darkroom__dial:focus-visible', '.blok-darkroom__adjust-reset:focus-visible']
      .forEach((selector) => expect(body(section, selector)).toMatch(/outline:\s*2px solid var\(--blok-focus-ring\)/));
  });

  it('turns transitions off for reduced motion', () => {
    const reduced = section.slice(section.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(section).toContain('@media (prefers-reduced-motion: reduce)');
    expect(reduced).toMatch(/\.blok-darkroom__tab[\s\S]*transition:\s*none/);
  });
});
