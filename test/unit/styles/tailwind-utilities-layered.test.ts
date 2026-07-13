import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

/**
 * Blok's stylesheet is injected into the host page's <head> (UI.loadStyles), so
 * its generated Tailwind utilities (.text-3xl, .grid, .flex, every responsive
 * variant …) coexist with the host app's own. Per the cascade-layer spec,
 * UN-LAYERED declarations always beat LAYERED ones — so if Blok emits its
 * utilities outside @layer, they silently override a host Tailwind v4 app's
 * layered utilities on the HOST's own elements (e.g. Blok's `.text-3xl` beats
 * the host's `sm:text-4xl`, collapsing the host's responsive layout the moment
 * the editor mounts).
 *
 * Importing Tailwind's utilities INTO the `utilities` cascade layer is HALF of
 * the fix — it keeps a host Tailwind app in control of its own utilities. But a
 * layered rule ALWAYS loses to an UN-LAYERED host reset (`* { margin: 0 }`,
 * `h1 { font-size: inherit }`) that every non-Tailwind app ships, which would
 * flatten editor content. The other half runs at build time
 * (scripts/scope-utilities): the compiled `@layer utilities` block is hoisted
 * out of the layer and each selector is scoped to Blok's interface roots — so
 * the utilities beat un-layered host resets INSIDE the editor yet never match
 * host elements OUTSIDE it. See scope-tailwind-utilities.test.ts.
 *
 * These tests lock in the authored `layer(utilities)` import, which is BOTH the
 * host-cascade contract AND the marker the build-time scope transform keys off.
 */
describe('Tailwind utilities are cascade-layered', () => {
  it('imports tailwindcss/utilities.css into @layer utilities', () => {
    expect(css).toMatch(
      /@import\s+['"]tailwindcss\/utilities\.css['"]\s+layer\(\s*utilities\s*\)\s*;/
    );
  });

  it('never imports tailwindcss/utilities.css unlayered', () => {
    // An import with no layer() clause would re-introduce the host-clobbering bug.
    expect(css).not.toMatch(
      /@import\s+['"]tailwindcss\/utilities\.css['"]\s*;/
    );
  });
});
