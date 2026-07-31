import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../../..');
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf-8');

/**
 * The playground chrome (index.html header, nav, settings panel …) is styled
 * with Tailwind utility classes, but the page used to rely on those utilities
 * LEAKING from Blok's injected stylesheet. Since scripts/scope-utilities scopes
 * every compiled utility to Blok's interface roots ([data-blok-interface],
 * [data-blok-popover]), the injected bundle no longer styles anything outside
 * the editor — which flattened the playground chrome.
 *
 * The playground must therefore ship its OWN Tailwind utilities entry, loaded
 * by index.html directly and NOT run through the scope transform (which keys
 * off the styles/main.css module id).
 */
describe('playground owns its Tailwind utilities', () => {
  const playgroundCssPath = resolve(root, 'src/playground/playground.css');

  it('index.html imports the playground stylesheet', () => {
    expect(indexHtml).toMatch(/import\s+['"]\.\/src\/playground\/playground\.css['"]/);
  });

  it('playground.css imports Tailwind utilities unscoped (no layer marker)', () => {
    const css = readFileSync(playgroundCssPath, 'utf-8');
    expect(css).toMatch(/@import\s+['"]tailwindcss\/utilities\.css['"]/);
    // layer(utilities) is the marker the build-time scope transform keys off —
    // the playground entry must never carry it on an import.
    expect(css).not.toMatch(/@import\s+[^;]*layer\(\s*utilities\s*\)/);
  });

  /**
   * Auto-detection scans all of src/, so this entry re-emitted the editor's own
   * utilities (`text-3xl` from the header tool …) UNSCOPED. Loading after Blok's
   * sheet, those copies beat the token rules in styles/heading.css on source
   * order — `style.fontSize.heading.*` was inert on the dev page while working
   * in the built bundle. The chrome's own sources are the only ones to scan.
   */
  it('playground.css scans only the page chrome, never the editor sources', () => {
    const css = readFileSync(playgroundCssPath, 'utf-8');

    expect(css).toMatch(/@import\s+['"]tailwindcss\/utilities\.css['"]\s+source\(\s*none\s*\)/);
    expect(css).toMatch(/@source\s+['"]\.['"]\s*;/);
    expect(css).toMatch(/@source\s+['"]\.\.\/\.\.\/index\.html['"]\s*;/);
  });
});
