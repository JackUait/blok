/**
 * Architectural enforcement: ban raw HTML Popover API usage outside the
 * centralized helper module.
 *
 * The bug history motivating this rule:
 *   1. tooltip.ts and popover-abstract.ts each owned their own copy of the
 *      promotion logic.
 *   2. CSS reset selectors were maintained per element type
 *      (`[data-blok-popover][popover]`, `[data-blok-interface=tooltip][popover]`).
 *   3. Any future component that called `showPopover()` would silently inherit
 *      the UA `[popover]` modal-dialog defaults and land in the bottom-right
 *      corner of the viewport with a Canvas background.
 *
 * This test fails the build if any source file outside top-layer.ts touches:
 *   - `.showPopover(`
 *   - `.hidePopover(`
 *   - `setAttribute('popover', ...)` / `setAttribute("popover", ...)`
 *
 * If you genuinely need a new Top Layer call site, route it through
 * `src/components/utils/top-layer.ts`. That single chokepoint guarantees the
 * `data-blok-top-layer` marker (and therefore the CSS reset) is applied.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(__dirname, '../../../src');

const ALLOWED_FILE = resolve(SRC_ROOT, 'components/utils/top-layer.ts');

const BANNED_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: '.showPopover(', regex: /\.showPopover\s*\(/ },
  { name: '.hidePopover(', regex: /\.hidePopover\s*\(/ },
  { name: `setAttribute('popover', ...)`, regex: /setAttribute\s*\(\s*['"`]popover['"`]/ },
  { name: `removeAttribute('popover')`, regex: /removeAttribute\s*\(\s*['"`]popover['"`]/ },
];

const SOURCE_FILE_EXTENSIONS = new Set(['.ts', '.tsx']);

const collectSourceFiles = (root: string): string[] => {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (!SOURCE_FILE_EXTENSIONS.has(extname(entry))) {
      continue;
    }

    if (entry.endsWith('.d.ts')) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
};

describe('Architectural rule: no raw HTML Popover API outside the top-layer helper', () => {
  const sourceFiles = collectSourceFiles(SRC_ROOT);

  for (const { name, regex } of BANNED_PATTERNS) {
    it(`forbids ${name} in any src/ file other than top-layer.ts`, () => {
      const violations: string[] = [];

      for (const file of sourceFiles) {
        if (file === ALLOWED_FILE) {
          continue;
        }

        const contents = readFileSync(file, 'utf-8');
        const lines = contents.split('\n');

        lines.forEach((line, index) => {
          if (regex.test(line)) {
            violations.push(`${relative(SRC_ROOT, file)}:${index + 1}: ${line.trim()}`);
          }
        });
      }

      /**
       * If this fails, route the offending call through
       * src/components/utils/top-layer.ts (promoteToTopLayer / removeFromTopLayer).
       * Adding a raw call here would skip the data-blok-top-layer marker and
       * therefore skip the CSS reset that neutralizes UA `[popover]` defaults.
       */
      expect(violations).toEqual([]);
    });
  }
});
