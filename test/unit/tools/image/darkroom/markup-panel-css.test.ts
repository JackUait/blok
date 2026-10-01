import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const raw = readFileSync(resolve(__dirname, '../../../../../src/tools/image/darkroom/markup-panel.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** selector → joined declarations of every rule naming exactly that selector. */
const body = (source: string, selector: string): string => {
  const bodies: string[] = [];

  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(/,(?![^(]*\))/).map((s) => s.trim().replace(/\s+/g, ' '));

    if (selectors.includes(selector)) bodies.push(m[2]);
  }

  return bodies.join(';');
};

const reducedMotion = ((): string => {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');

  return start < 0 ? '' : css.slice(start);
})();

const BLUE = /#(?:3b82f6|2563eb|1d4ed8|0a84ff|007aff|4a90e2)|\bblue\b|--blok-(?:link|focus)/i;

/** Every selected state the panel paints. */
const SELECTED = [
  '.blok-darkroom__markup-tool[aria-checked="true"]',
  '.blok-darkroom__markup-puck',
  '.blok-darkroom__markup-swatch[aria-checked="true"]',
  '.blok-darkroom__markup-swatch[aria-checked="true"]::before',
  '.blok-darkroom__markup-size[aria-checked="true"]',
  '.blok-darkroom__markup-style[aria-checked="true"]',
  '.blok-darkroom__markup-fill[aria-pressed="true"]',
];

describe('markup-panel.css', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-declares light ink for the dark glass, whatever the host theme', () => {
    const rule = body(css, '.blok-darkroom__markup');

    expect(rule).toMatch(/--blok-icon-active-bg:\s*rgba\(255, 255, 255, 0?\.\d+\)/);
    expect(rule).toMatch(/--blok-text-primary:\s*var\(--blok-darkroom-ink\)/);
    expect(rule).toMatch(/--blok-icon-active-text:\s*var\(--blok-text-primary\)/);
  });

  it.each(SELECTED)('%s is styled and never blue', (selector) => {
    const rule = body(css, selector);

    expect(rule).not.toBe('');
    expect(rule).not.toMatch(BLUE);
  });

  it.each([
    '.blok-darkroom__markup-size[aria-checked="true"]',
    '.blok-darkroom__markup-style[aria-checked="true"]',
    '.blok-darkroom__markup-fill[aria-pressed="true"]',
  ])('%s paints the neutral active fill and primary ink', (selector) => {
    const rule = body(css, selector);

    expect(rule).toMatch(/background:\s*var\(--blok-icon-active-bg\)/);
    expect(rule).toMatch(/color:\s*var\(--blok-icon-active-text\)/);
  });

  it('the checked tool takes primary ink on the neutral puck', () => {
    expect(body(css, '.blok-darkroom__markup-tool[aria-checked="true"]')).toMatch(/color:\s*var\(--blok-icon-active-text\)/);
    expect(body(css, '.blok-darkroom__markup-puck')).toMatch(/background:\s*var\(--blok-icon-active-bg\)/);
  });

  it('paints the keyboard ring from the focus-ring token only', () => {
    const rule = body(css, '.blok-darkroom__markup button:focus-visible');

    expect(rule).toMatch(/outline:\s*2px solid var\(--blok-focus-ring\)/);
    expect(css).not.toContain(':focus-within');
    expect(css).not.toMatch(/:focus(?!-visible)/);
  });

  it('removes hidden controls from layout even outside the darkroom', () => {
    expect(body(css, '.blok-darkroom__markup [hidden]')).toMatch(/display:\s*none/);
  });

  it('keeps both rows one fixed height, so the dock never jumps', () => {
    expect(body(css, '.blok-darkroom__markup-rail')).toMatch(/height:\s*var\(--blok-markup-row\)/);
    // Plus a bleed that its negative margin cancels.
    expect(body(css, '.blok-darkroom__markup-context')).toMatch(/height:\s*calc\(var\(--blok-markup-row\) \+ 2 \* var\(--blok-markup-bleed\)\)/);
    expect(body(css, '.blok-darkroom__markup-context')).toMatch(/margin-block:\s*calc\(-1 \* var\(--blok-markup-bleed\)\)/);
  });

  it('grows the rail and drops it to the middle of both rows when the context row is empty', () => {
    const empty = body(css, '.blok-darkroom__markup[data-context-empty]');
    const rail = body(css, '.blok-darkroom__markup-rail');

    // Declared on the panel, so the drop reads the base row, not the grown one.
    expect(empty).toMatch(/--blok-markup-grow:\s*[1-9]\d*px/);
    expect(empty).toMatch(/--blok-markup-drop:\s*calc\(\(var\(--blok-markup-row\) \+ var\(--blok-space-3\)\) \/ 2\)/);
    expect(rail).toMatch(/--blok-markup-hit:\s*calc\(var\(--blok-markup-size\) \+ var\(--blok-markup-grow\)\)/);
    expect(rail).toMatch(/translate:\s*0 var\(--blok-markup-drop\)/);
    // The grown rail must not change the panel height, or the dock jumps.
    expect(rail).toMatch(/margin-block:\s*calc\(-1 \* var\(--blok-markup-grow\) \/ 2\)/);
    expect(body(css, '.blok-darkroom__markup')).toMatch(/--blok-markup-hit:\s*var\(--blok-markup-size\)/);
  });

  it('scrolls both rows sideways instead of wrapping', () => {
    expect(body(css, '.blok-darkroom__markup-rail')).toMatch(/overflow-x:\s*auto/);
    expect(body(css, '.blok-darkroom__markup-context')).toMatch(/overflow-x:\s*auto/);
  });

  it('stills the puck and the context fades under reduced motion', () => {
    expect(body(reducedMotion, '.blok-darkroom__markup-puck')).toMatch(/transition:\s*none/);
    expect(body(reducedMotion, '.blok-darkroom__markup-rail')).toMatch(/transition:\s*none/);
    expect(body(reducedMotion, '.blok-darkroom__markup-ctl')).toMatch(/transition:\s*none/);
  });
});
