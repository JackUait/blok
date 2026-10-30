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
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const STYLES_ENTRY = resolve(__dirname, '../../../../src/styles/main.css');

/** Entries of the sheets src/components/utils/lazy-styles.ts loads on first use. */
export const LAZY_STYLES_DIR = resolve(__dirname, '../../../../src/styles/lazy');

export const lazyEntries = (): string[] =>
  readdirSync(LAZY_STYLES_DIR).filter((name) => name.endsWith('.css')).sort().map((name) => join(LAZY_STYLES_DIR, name));

/**
 * The authored stylesheet the browser ends up with: main.css, each lazy entry
 * put back where its `[data-blok-sheet='<name>']` marker rule sits (or at the end
 * when it has none), with only the entries' local imports kept. An entry cut
 * into parts by `<name>-2`, `<name>-3`… markers puts each part at its own marker.
 */
export const withLazySheets = (
  mainSource: string,
  inlineFile: (filePath: string) => string,
): string => {
  const markerOf = (name: string): string => `[data-blok-sheet='${name}'] { --blok-sheet: ${name}; }`;
  const localImports = (entry: string, source: string): string =>
    [...source.matchAll(/@import\s+['"](\.[^'"]+)['"]/g)]
      .map(([, spec]) => inlineFile(resolve(dirname(entry), spec)))
      .join('\n');

  return lazyEntries().reduce((result, entry) => {
    const name = basename(entry, '.css');
    const parts = readFileSync(entry, 'utf-8').split(new RegExp(`^\\[data-blok-sheet='${name}-\\d+'\\].*$`, 'm'));

    return parts.reduce((source, part, index) => {
      const marker = markerOf(index === 0 ? name : `${name}-${index + 1}`);
      const css = localImports(entry, part);

      return source.includes(marker) ? source.replace(marker, () => css) : `${source}\n${css}`;
    }, result);
  }, mainSource);
};

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
 * Returns main.css with every local @import and lazy sheet inlined. Result is cached per
 * process to avoid repeated disk reads across test files.
 */
let cached: string | null = null;

export function readMainCss(): string {
  if (cached !== null) return cached;
  const seen = new Set<string>();

  cached = withLazySheets(inline(STYLES_ENTRY, seen), (filePath) => inline(filePath, seen));
  return cached;
}
