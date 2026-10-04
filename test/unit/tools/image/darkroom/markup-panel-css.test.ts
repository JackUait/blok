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
  '.blok-darkroom__markup-shape[aria-checked="true"]',
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

  it('the shape picker is a two-column glass grid', () => {
    expect(body(css, '.blok-darkroom__markup-shapes')).toMatch(/background:\s*var\(--blok-darkroom-pill-bg\)/);
    expect(body(css, '.blok-darkroom__markup-shape-grid')).toMatch(/grid-template-columns:\s*repeat\(2,/);
  });

  it('the shape picker hides its focus ring until the user navigates with the keyboard', () => {
    const rule = body(css, '.blok-darkroom__markup-shapes:not([data-blok-keyboard-navigated]) button:focus-visible');

    expect(rule).toMatch(/outline:\s*none/);
  });

  it('the hairline in the shape grid runs across both columns', () => {
    const rule = body(css, '.blok-darkroom__markup-shape-grid .blok-darkroom__markup-sep');

    expect(rule).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(rule).toMatch(/height:\s*1px/);
  });

  it('the shape button chevron is small and muted next to the shape', () => {
    expect(body(css, '.blok-darkroom__markup-shapes-chevron')).toMatch(/width:\s*1[0-2]px/);
  });

  it('eraser size dots are hollow rings, not the last ink colour', () => {
    const rule = body(css, '.blok-darkroom__markup[data-tool="eraser"] .blok-darkroom__markup-dot');

    expect(rule).toMatch(/background:\s*transparent/);
    expect(rule).not.toMatch(/--blok-markup-color/);
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
    expect(empty).toMatch(/--blok-markup-grow:\s*14px/);
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

  it('draws the shape tiles in the current ink, at the current width, filled when Fill is on', () => {
    expect(body(css, '.blok-darkroom__markup-shape[data-ink] svg')).toMatch(/color:\s*var\(--blok-markup-color\)/);
    expect(body(css, '.blok-darkroom__markup-shape[data-ink] svg > *')).toMatch(/stroke-width:\s*var\(--blok-markup-shape-stroke\)/);
    ['0', '1', '2'].forEach((n) => {
      expect(body(css, `.blok-darkroom__markup-shapes[data-size="${n}"]`)).toMatch(/--blok-markup-shape-stroke:/);
    });
    expect(body(css, '.blok-darkroom__markup-shapes[data-fill] .blok-darkroom__markup-shape[data-fillable] svg > *'))
      .toMatch(/fill:\s*currentColor/);
  });

  it('keeps the checked shape tile a neutral fill, the glyph in the user\'s ink, never blue', () => {
    expect(body(css, '.blok-darkroom__markup-shape[aria-checked="true"]')).toMatch(/background:\s*var\(--blok-icon-active-bg\)/);
    expect(body(css, '.blok-darkroom__markup-shape[data-ink] svg')).not.toMatch(BLUE);
  });

  it('gives dark ink a light halo, so a black glyph still reads on the dark glass', () => {
    expect(body(css, '.blok-darkroom__markup-shapes[data-ink-dark] .blok-darkroom__markup-shape[data-ink] svg')).toMatch(/filter:\s*drop-shadow/);
  });

  it('springs the picker out of its button and traces each glyph on in turn', () => {
    expect(body(css, '.blok-darkroom__markup-shapes')).toMatch(/animation:[^;]*blok-markup-shapes-in/);
    expect(body(css, '.blok-darkroom__markup-shape svg > *')).toMatch(/animation:[^;]*blok-markup-trace/);
    expect(body(css, '.blok-darkroom__markup-shape svg > *')).toMatch(/--blok-markup-shape-i/);
    expect(css).toMatch(/@keyframes blok-markup-trace\s*\{[^}]*stroke-dashoffset:\s*1/);
  });

  it('finishes the whole open sequence within half a second', () => {
    const tokens = body(css, '.blok-darkroom__markup-shapes');
    const ms = (name: string): number => {
      const m = tokens.match(new RegExp(`${name}:\\s*(\\d+)ms`));

      if (m === null) throw new Error(`no ${name}`);

      return Number(m[1]);
    };
    // Eight drawn glyphs: the last one starts seven steps after the first.
    const lastGlyphDone = ms('--blok-markup-shape-lead') + 7 * ms('--blok-markup-shape-step') + ms('--blok-markup-shape-trace');

    expect(lastGlyphDone).toBeLessThanOrEqual(500);
    expect(body(css, '.blok-darkroom__markup-shape svg > *')).toMatch(/var\(--blok-markup-shape-trace\)/);
    expect(body(css, '.blok-darkroom__markup-shape svg > *')).toMatch(/var\(--blok-markup-shape-lead\)/);
  });

  it('crops the photo tiles to the tile, with a spotlight window and a round lens', () => {
    expect(body(css, '.blok-darkroom__markup-shape[data-photo] img')).toMatch(/object-fit:\s*cover/);
    expect(body(css, '.blok-darkroom__markup-spot::before')).toMatch(/box-shadow:/);
    expect(body(css, '.blok-darkroom__markup-lens')).toMatch(/border-radius:\s*50%/);
  });

  it('opens the picker still under reduced motion', () => {
    [
      '.blok-darkroom__markup-shapes',
      '.blok-darkroom__markup-shape svg > *',
      '.blok-darkroom__markup-shape[data-photo] img',
      '.blok-darkroom__markup-spot::before',
      '.blok-darkroom__markup-lens',
    ].forEach((sel) => expect(body(reducedMotion, sel)).toMatch(/animation:\s*none/));
  });

  it('stills the puck and the context fades under reduced motion', () => {
    expect(body(reducedMotion, '.blok-darkroom__markup-puck')).toMatch(/transition:\s*none/);
    expect(body(reducedMotion, '.blok-darkroom__markup-rail')).toMatch(/transition:\s*none/);
    expect(body(reducedMotion, '.blok-darkroom__markup-ctl')).toMatch(/transition:\s*none/);
  });
});
