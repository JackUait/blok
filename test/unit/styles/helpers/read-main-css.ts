/**
 * Read src/styles/main.css and recursively inline every local @import
 * (./ or ../ paths) so callers see the full Blok stylesheet as a single
 * string. Package imports (e.g. 'tailwindcss/utilities.css') are left as
 * raw `@import` statements — consumers grep authored source, not framework
 * output.
 *
 * Introduced when main.css was split by concern into keyframes.css,
 * image.css, tokens.css, colors.css, isolation.css, preflight.css,
 * checklist.css, tables.css, slash-search.css, emoji-picker.css and
 * database.css. Existing style audits (preflight, top-layer, image radii,
 * slash-search, css-vars) grep the flattened source; using this helper
 * keeps them oblivious to the file layout.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STYLES_ENTRY = resolve(__dirname, '../../../../src/styles/main.css');

function inline(filePath: string, seen: Set<string>): string {
  if (seen.has(filePath)) return '';
  seen.add(filePath);
  const source = readFileSync(filePath, 'utf-8');
  const baseDir = dirname(filePath);

  return source.replace(
    /@import\s+['"]([^'"]+)['"]\s*;?/g,
    (match, spec: string) => {
      if (!spec.startsWith('.')) return match;
      return inline(resolve(baseDir, spec), seen);
    }
  );
}

/**
 * Returns main.css with every local @import inlined. Result is cached per
 * process to avoid repeated disk reads across test files.
 */
let cached: string | null = null;

export function readMainCss(): string {
  if (cached !== null) return cached;
  cached = inline(STYLES_ENTRY, new Set());
  return cached;
}

export const MAIN_CSS_ENTRY = STYLES_ENTRY;
