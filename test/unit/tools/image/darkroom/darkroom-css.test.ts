import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../../../src/tools/image/darkroom/darkroom.css'), 'utf8');
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);

  if (at === -1) {
    throw new Error(`missing ${selector}`);
  }

  return css.slice(at, css.indexOf('}', at));
};
const BLUE = /#(?:3b82f6|2563eb|1d4ed8|0a84ff|007aff|4a90e2)|\bblue\b|--blok-(?:link|focus)/i;

describe('darkroom.css', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the selected shape chip is neutral: active tokens, never blue', () => {
    const selected = rule('.blok-darkroom__chip[data-active="true"]');

    expect(selected).toContain('var(--blok-icon-active-bg)');
    expect(selected).not.toMatch(BLUE);
  });

  it('the selected chip reads light-on-dark whatever the host theme', () => {
    const chipScope = rule('.blok-darkroom__pill');
    const bg = /--blok-icon-active-bg:\s*([^;]+);/.exec(chipScope)?.[1] ?? '';

    expect(bg).toMatch(/^rgba\(255, 255, 255, 0?\.\d+\)$/);
    // Ink must be re-declared under the dark scope, or it keeps the host's black.
    expect(chipScope).toMatch(/--blok-text-primary:\s*var\(--blok-darkroom-ink\);/);
    expect(chipScope).toMatch(/--blok-icon-active-text:\s*var\(--blok-text-primary\);/);
    expect(rule('.blok-darkroom')).toMatch(/--blok-darkroom-ink:\s*#fff;/);
    expect(chipScope).not.toMatch(BLUE);
  });

  it('Done is white on black, not blue', () => {
    const done = rule('.blok-darkroom__btn--primary');

    expect(done).not.toMatch(BLUE);
    expect(done).toMatch(/background:\s*var\(--blok-darkroom-done-bg\)/);
    expect(done).toMatch(/color:\s*var\(--blok-darkroom-done-ink\)/);
    expect(rule('.blok-darkroom')).toMatch(/--blok-darkroom-done-bg:\s*#fff;/);
    expect(rule('.blok-darkroom')).toMatch(/--blok-darkroom-done-ink:\s*#000;/);
  });

  it('the frame radius comes from the morph channel', () => {
    expect(rule('.blok-darkroom__frame')).toMatch(/border-radius:\s*var\(--blok-radius-darkroom-frame\)/);
  });

  it('a hidden control stays hidden even where the rule sets display', () => {
    expect(rule('.blok-darkroom [hidden]')).toMatch(/display:\s*none/);
  });

  it('never uses the font shorthand with inherit, which drops the whole declaration', () => {
    expect(css).not.toMatch(/font:[^;]*\binherit\b/);
  });

  it('the fly-out clone is fixed, radius-morphed, and scales its img from the corner', () => {
    const flight = rule('.blok-darkroom-flight');

    expect(flight).toMatch(/position:\s*fixed/);
    expect(flight).toMatch(/border-radius:\s*var\(--blok-radius-darkroom-frame\)/);
    expect(rule('.blok-darkroom-flight [data-role="image-plane"]')).toMatch(/transform-origin:\s*0 0/);
  });

  it('the turned img keeps its centre origin: only the camera plane scales from the corner', () => {
    // planeImageStyle turns the img about its centre; a corner origin would swing it out of the plane.
    expect(css).not.toMatch(/\.blok-darkroom-flight img\s*\{/);
    expect(css).not.toMatch(/\.blok-darkroom__photo img[^{]*\{[^}]*transform-origin/);
    expect(rule('.blok-darkroom__photo')).toMatch(/transform-origin:\s*0 0/);
  });

  it('the veil paints the same dark surround, square, and never takes a press', () => {
    const veil = rule('.blok-darkroom-veil');
    const background = (r: string): string => /background:\s*([^;]+);/.exec(r)?.[1] ?? 'none';

    expect(background(veil)).toBe(background(rule('.blok-darkroom[data-blok-top-layer][popover]')));
    expect(veil).toMatch(/position:\s*fixed/);
    expect(veil).toMatch(/inset:\s*0/);
    expect(veil).toMatch(/pointer-events:\s*none/);
    expect(veil).not.toMatch(/border-radius/);
    expect(veil).not.toMatch(BLUE);
    // The palette the gradient reads must reach the veil too.
    expect(css).toMatch(/\.blok-darkroom-veil,\s*\.blok-darkroom \{\s*--blok-darkroom-bg-center/);
  });

  it('the promoted veil and clone outrank the top-layer reset that would shrink them', () => {
    expect(css).toMatch(/\.blok-darkroom-veil\[data-blok-top-layer\]\[popover\],\s*\.blok-darkroom-veil \{/);
    expect(css).toMatch(/\.blok-darkroom-flight\[data-blok-top-layer\]\[popover\],\s*\.blok-darkroom-flight \{/);
  });

  it('the bottom dock fades by opacity like the bar, and stops for reduced motion', () => {
    expect(rule('.blok-darkroom__dock')).toMatch(/transition:\s*opacity 120ms ease/);
    expect(rule('.blok-darkroom__dock')).toMatch(/position:\s*absolute/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(reduced).toMatch(/\.blok-darkroom__dock[,\s]/);
  });

  it('the ratio pill flows inside the dock instead of pinning itself to the bottom', () => {
    const pillRules = [...css.matchAll(/(?:^|\n)\.blok-darkroom__pill \{([^}]*)\}/g)].map((m) => m[1]);

    expect(pillRules.length).toBeGreaterThan(1);
    pillRules.forEach((body) => expect(body).not.toMatch(/position:\s*absolute/));
  });

  it('all tab panels share one dock cell and a hidden one keeps its box, so the frame does not jump between tabs', () => {
    expect(rule('.blok-darkroom__dock')).toMatch(/display:\s*grid/);
    const panel = rule('.blok-darkroom__dock > .blok-darkroom__panel');

    expect(panel).toMatch(/grid-row:\s*1/);
    expect(panel).toMatch(/grid-column:\s*1/);
    const hidden = rule('.blok-darkroom__dock > .blok-darkroom__panel[hidden]');

    expect(hidden).toMatch(/display:\s*flex/);
    expect(hidden).toMatch(/visibility:\s*hidden/);
    expect(rule('.blok-darkroom__dock > .blok-darkroom__tabs')).toMatch(/grid-row:\s*2/);
  });

  it('the adjust resets stack above the chip row, whose backdrop-filter paints it like a positioned box', () => {
    const layer = rule('.blok-darkroom__adjust-resets');

    expect(layer).toMatch(/position:\s*relative/);
    expect(layer).toMatch(/z-index:\s*1/);
  });

  it('the typed-value field lies over the number in the same type, and the number hides under it', () => {
    const field = rule('.blok-darkroom__dial-input');

    expect(field).toMatch(/position:\s*absolute/);
    expect(field).toMatch(/top:\s*0/);
    expect(field).toMatch(/ui-monospace/);
    expect(field).not.toMatch(BLUE);
    expect(rule('.blok-darkroom__dial-value')).toMatch(/cursor:\s*text/);
    expect(rule('.blok-darkroom__dial-value[data-editing]')).toMatch(/visibility:\s*hidden/);
  });

  describe('outside Crop mode the photo shows as the cropped result', () => {
    // The body of the rule whose selector list names this selector, grouped or not.
    const offCrop = (target: string): string => {
      const selector = `.blok-darkroom__surface:not([data-mode="crop"]) ${target}`;
      const hit = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .find(([, list]) => list.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((x) => x.trim()).includes(selector));

      if (!hit) throw new Error(`missing ${selector}`);

      return hit[2];
    };

    // Split a box-shadow value on its top-level commas only.
    const layers = (body: string): string[] => {
      const value = /box-shadow:\s*([^;]+);/.exec(body)?.[1] ?? '';

      return value.split(/,(?![^(]*\))/).map((x) => x.trim());
    };

    it('handles fade out instead of vanishing, and take no press while gone', () => {
      const handle = offCrop('.blok-darkroom__handle');

      expect(handle).not.toMatch(/display:\s*none/);
      expect(handle).toMatch(/opacity:\s*0/);
      expect(handle).toMatch(/visibility:\s*hidden/);
      expect(handle).toMatch(/pointer-events:\s*none/);
      expect(rule('.blok-darkroom__handle')).toMatch(/transition:[^;]*opacity[^;]*visibility/);
      expect(offCrop('.blok-darkroom__grid')).toMatch(/display:\s*none/);
    });

    it('every frame state has the same two shadow layers, so a tab switch never pairs the outline with the 9999px mask', () => {
      const states = [rule('.blok-darkroom__frame'), rule('.blok-darkroom__surface[data-peek] .blok-darkroom__frame'), offCrop('.blok-darkroom__frame')];

      states.forEach((body) => {
        const [outline, mask] = layers(body);

        expect(layers(body)).toHaveLength(2);
        expect(outline).not.toMatch(/9999px/);
        expect(mask).toMatch(/^0 0 0 9999px /);
      });
    });

    it('the frame drops its outline and the mask goes opaque', () => {
      const [outline, mask] = layers(offCrop('.blok-darkroom__frame'));

      expect(outline).toBe('0 0 0 0 transparent');
      expect(mask).toBe('0 0 0 9999px var(--blok-darkroom-bg-edge)');
      expect(rule('.blok-darkroom')).toMatch(/--blok-darkroom-bg-edge:\s*#[0-9a-f]{6};/);
    });

    it('the stage stops offering a grab cursor', () => {
      expect(offCrop('.blok-darkroom__stage')).toMatch(/cursor:\s*default/);
    });
  });

  describe('local reset controls', () => {
    const bodyOf = (selector: string): string => {
      const hit = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
        .find(([, list]) => list.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((x) => x.trim()).includes(selector));

      if (!hit) throw new Error(`missing ${selector}`);

      return hit[2];
    };

    it.each(['.blok-darkroom__dial-reset', '.blok-darkroom__panel-reset'])('%s hides by visibility so the layout keeps its box', (sel) => {
      const off = bodyOf(`${sel}[data-shown="false"]`);

      expect(off).toMatch(/visibility:\s*hidden/);
      expect(off).not.toMatch(/display:\s*none/);
    });

    it('the dial reset sits beside the value label, and nothing is blue', () => {
      expect(bodyOf('.blok-darkroom__dial-box')).toMatch(/position:\s*relative/);
      expect(bodyOf('.blok-darkroom__dial-reset')).toMatch(/position:\s*absolute/);
      expect(bodyOf('.blok-darkroom__dial-reset')).not.toMatch(BLUE);
      expect(bodyOf('.blok-darkroom__panel-reset')).not.toMatch(BLUE);
    });
  });

  it('is imported by main.css instead of the old crop styles', () => {
    const main = readFileSync(resolve(__dirname, '../../../../../src/styles/main.css'), 'utf8');

    expect(main).toContain("@import '../tools/image/darkroom/darkroom.css';");
    expect(main).not.toContain('crop-editor.css');
    expect(main).not.toContain('crop-modal.css');
  });
});
