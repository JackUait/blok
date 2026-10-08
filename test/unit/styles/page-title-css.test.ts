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
});
