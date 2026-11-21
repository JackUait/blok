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

  // notion-motion.md Round 86 (row 27/73): over a full-page database the H1 is 32/38.4 with no block padding,
  // and the tabs start 12 under it (the tab bar keeps its own 4px top padding, so the title adds 8).
  describe('over a full-page database', () => {
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const body = (selector: string): string => {
      const at = flat.indexOf(` ${selector} {`);

      expect(at, selector).toBeGreaterThan(-1);

      return flat.slice(at, flat.indexOf('}', at));
    };

    it('keeps the published 40px default for every other page', () => {
      expect(body('[data-blok-page-header]')).toMatch(/--blok-page-title-size: 40px/);
    });

    it('sets the title size to 32px on the header, so the narrow tiers on the title still win', () => {
      expect(body('[data-blok-page-header][data-blok-page-full-database]')).toMatch(/--blok-page-title-size: 32px/);
    });

    it('drops the title block padding and leaves 8px under it', () => {
      const title = body('[data-blok-page-header][data-blok-page-full-database] [data-blok-page-title]');

      expect(title).toMatch(/padding-block: 0/);
      expect(title).toMatch(/margin-block-end: var\(--blok-space-2\)/);
    });
  });
});
