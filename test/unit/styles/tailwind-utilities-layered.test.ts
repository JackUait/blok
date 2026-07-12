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
 * The fix is to import Tailwind's utilities INTO the `utilities` cascade layer,
 * exactly as canonical `@import "tailwindcss"` does, so the host stays in
 * control of its own utilities. These tests lock that in.
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
