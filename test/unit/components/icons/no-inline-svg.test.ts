import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Regression guard: every SVG icon used in production code must live in the
 * shared icons layer (`src/components/icons/index.ts`).
 *
 * Rationale: inline `<svg>` literals scattered across tools make icons
 * impossible to audit, theme, or localize. A central registry also powers the
 * playground `/icons` gallery.
 *
 * Whitelisted exceptions:
 * - src/components/icons/index.ts            → the registry itself
 * - src/components/utils/key-icon.ts         → SVGs composed dynamically
 *                                              per keyboard glyph at runtime
 * - src/stories/** (Storybook story files)   → fixtures demonstrating the
 *                                              external custom-icon API
 * - JSDoc comments mentioning `<svg>...</svg>` as documentation
 */

const SRC = join(__dirname, '..', '..', '..', '..', 'src');

const ALLOWED_FILES = new Set([
  'components/icons/index.ts',
  'components/utils/key-icon.ts',
]);

const ALLOWED_DIR_PREFIXES = [
  'stories' + sep,
];

function walk(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);

    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mts|cts|js|jsx)$/.test(entry)) {
      out.push(full);
    }
  }

  return out;
}

function isAllowed(relPath: string): boolean {
  const norm = relPath.split(sep).join('/');

  if (ALLOWED_FILES.has(relPath) || ALLOWED_FILES.has(norm)) return true;

  return ALLOWED_DIR_PREFIXES.some((prefix) => relPath.startsWith(prefix) || norm.startsWith(prefix.split(sep).join('/')));
}

/**
 * Strips JSDoc blocks (`/** ... *\/`) and whole-line `//` comments so example
 * SVG snippets quoted in documentation do not trip the guard. The regex form
 * is deliberate: a full JS tokenizer would be needed to safely strip every
 * comment flavor, but for this guard we only need to mask the places where
 * `<svg>` regularly appears as prose — JSDoc examples.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('no inline <svg> outside icons layer', () => {
  const files = walk(SRC);

  const offenders: { file: string; lines: number[] }[] = [];

  for (const abs of files) {
    const rel = relative(SRC, abs);

    if (isAllowed(rel)) continue;

    const stripped = stripComments(readFileSync(abs, 'utf8'));

    if (!stripped.includes('<svg')) continue;

    const lines: number[] = [];

    stripped.split('\n').forEach((line, idx) => {
      if (line.includes('<svg')) lines.push(idx + 1);
    });

    if (lines.length > 0) offenders.push({ file: rel, lines });
  }

  it('finds zero offenders', () => {
    if (offenders.length > 0) {
      const msg = offenders
        .map((o) => `  ${o.file}: line(s) ${o.lines.join(', ')}`)
        .join('\n');

      throw new Error(
        `Inline <svg> found outside src/components/icons/index.ts.\n` +
        `Move each icon into the shared icons layer and import it.\n` +
        `Offenders:\n${msg}`
      );
    }

    expect(offenders).toEqual([]);
  });
});
