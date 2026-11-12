import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/page-title.css', 'utf8');

describe('page title css', () => {
  it('uses the editor content column and drops it in full width', () => {
    expect(css).toMatch(/\[data-blok-page-header\]\s*\{[^}]*--blok-content-column:\s*var\(--blok-content-max-width,\s*var\(--max-width-content\)\)/);
    expect(css).toMatch(/\[data-blok-page-header\]\[data-blok-width="full"\]\s*\{[^}]*--blok-content-column:\s*var\(--blok-content-max-width,\s*none\)/);
  });

  it('never clamps or truncates the title', () => {
    expect(css).not.toMatch(/line-clamp|text-overflow|-webkit-box/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('steps sizes with container queries, never fluid units', () => {
    expect(css).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@container/);
    expect(css).not.toMatch(/\d(cqw|cqi|vw)\b/);
  });

  it('paints the open picker state neutral, not blue', () => {
    expect(css).toMatch(/\[aria-expanded="true"\][^{]*\{[^}]*var\(--blok-item-hover-bg\)/);
  });

  // notion-motion.md Round 15 C.
  describe('page cover', () => {
    const rule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);

      expect(at, selector).toBeGreaterThan(-1);

      return css.slice(at, css.indexOf('}', at));
    };

    it('is 143 tall and has no motion of its own', () => {
      expect(rule('[data-blok-page-cover]')).toMatch(/block-size:\s*143px/);
      expect(rule('[data-blok-page-cover]')).not.toMatch(/transition|animation/);
    });

    it('fades the row buttons in over 100ms and the cover buttons over 200ms', () => {
      expect(css).toMatch(/\[data-blok-page-add-cover\][^{]*\{[^}]*transition:\s*opacity 100ms ease/);
      expect(rule('[data-blok-page-cover-controls]')).toMatch(/transition:\s*opacity 200ms ease/);
    });

    it('places the cover buttons 12px from the top and the end', () => {
      expect(rule('[data-blok-page-cover-controls]')).toMatch(/inset-block-start:\s*var\(--blok-space-3\)/);
      expect(rule('[data-blok-page-cover-controls]')).toMatch(/inset-inline-end:\s*var\(--blok-space-3\)/);
    });

    it('opens the picker 540 wide with a 200ms fade', () => {
      expect(css).toMatch(/\[data-blok-page-cover-picker\]\[data-blok-top-layer\]\[popover\]\s*\{[^}]*inline-size:\s*540px/);
      expect(rule('[data-blok-page-cover-picker][data-blok-top-layer][popover]')).toMatch(/animation:\s*blok-page-cover-picker-in 200ms ease/);
    });
  });
});
