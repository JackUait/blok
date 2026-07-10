/**
 * Static analysis of the shared invalid-field convention (H11) styling.
 *
 * `setFieldValidity()` marks rejected inputs with `aria-invalid="true"`, and
 * media-empty.css pairs that with a destructive ring (border-color + focus
 * box-shadow). Because main.css ships as a global stylesheet, a bare
 * `[aria-invalid="true"]` selector would leak onto every host-app form field
 * on the page — and its `outline: none` focus rule would strip focus
 * indicators from inputs Blok doesn't own.
 *
 * These guards pin the rules to Blok-scoped ancestors, mirroring the
 * isolation scope used by the preflight reset:
 * `[data-blok-interface]` (editor wrapper + inline toolbar),
 * `[data-blok-popover]` (floating popovers) and
 * `[data-blok-top-layer]` (Top-Layer-promoted elements).
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

const css = stripComments(readMainCss());

describe('shared invalid-field CSS scoping (H11)', () => {
  it('has no selector that begins with an unscoped [aria-invalid attribute', () => {
    /**
     * A selector starting at `[aria-invalid` (i.e. right after a rule end,
     * a comma, or the start of the sheet) has no Blok ancestor and would
     * match arbitrary host-app inputs.
     */
    expect(css).not.toMatch(/(?:^|\}|,)\s*\[aria-invalid/);
  });

  it('keeps the destructive border ring, scoped to Blok contexts', () => {
    expect(css).toMatch(
      /:where\(\[data-blok-interface\],\s*\[data-blok-popover\],\s*\[data-blok-top-layer\]\)\s*\[aria-invalid="true"\]\s*\{[^}]*border-color/
    );
  });

  it('keeps the focus ring override, scoped to Blok contexts', () => {
    expect(css).toMatch(
      /:where\(\[data-blok-interface\],\s*\[data-blok-popover\],\s*\[data-blok-top-layer\]\)\s*\[aria-invalid="true"\]:focus\b/
    );
  });
});
