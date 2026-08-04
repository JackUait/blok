/**
 * Architectural enforcement: the First-Editable Selector Law.
 *
 * A block holder's FIRST `[contenteditable]` descendant is not always the
 * block's text element. List items render a bullet/number marker `<span>`
 * BEFORE the content cell, and that marker carries `contenteditable="false"`
 * (so `[contenteditable]` matches it) and is flipped to `"true"` by any code
 * that toggles editability without excluding it. Every such marker-shaped
 * decoration is stamped `data-blok-mutation-free`.
 *
 * Root cause this law encodes (the "list marker ghost", 2026-07-01, commits
 * 1f5058e5 + e4da98ab): `updateBlocksContentEditable` grabbed the marker via
 * a bare `[contenteditable]` selector and flipped it editable; the block-split
 * path then wrote the item's own HTML into "the first
 * `[contenteditable="true"]`" — the bullet span — rendering a giant duplicate
 * of the item text centered on the bullet. The two sites that bit were
 * guarded, but the CLASS survived: this investigation (2026-08-04) found ten
 * more bare first-editable queries, including one that made the toolbar
 * center on the marker's box — the very thing its own comment says it avoids.
 *
 * The law: every `querySelector`/`querySelectorAll` whose selector matches
 * `[contenteditable...]` descendants MUST exclude mutation-free decorations
 * with `:not([data-blok-mutation-free])`, or be listed in EXEMPT_QUERIES with
 * a reason. `matches()`/`closest()` are out of scope: they test a known node
 * or ascend from one, so they cannot "discover" a marker the way a descendant
 * search does (markers hold no caret and no user content).
 *
 * If this test fails on your change: add the `:not([data-blok-mutation-free])`
 * guard to the selector, or exempt it with a reason explaining why the query
 * can never resolve to a mutation-free decoration.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const SCAN_ROOT = 'src';

/**
 * Directories that are not part of the shipped editor runtime.
 * - stories: Storybook demo pages drive their own fixture DOM, which never
 *   contains list markers.
 */
const SKIP_DIRS = new Set(['stories', 'node_modules']);

const GUARD = ':not([data-blok-mutation-free])';

interface ExemptQuery {
  file: string;
  selector: string;
  reason: string;
}

/**
 * Queries deliberately allowed to match mutation-free decorations.
 * Every entry must say WHY. Exempting a query that positions, focuses,
 * mutates, or reads "the block's text element" violates the law — guard it
 * instead.
 */
const EXEMPT_QUERIES: ExemptQuery[] = [];

const walk = (dir: string): string[] => {
  const out: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const isDir = statSync(full).isDirectory();

    if (isDir && !SKIP_DIRS.has(entry)) {
      out.push(...walk(full));
    } else if (!isDir && entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.includes('.test.')) {
      out.push(full);
    }
  }

  return out;
};

/**
 * Literal selector arguments of querySelector/querySelectorAll calls that
 * target `[contenteditable...]`.
 */
const QUERY_RE = /querySelector(?:All)?(?:<[^>]*>)?\(\s*(['"`])((?:(?!\1).)*\[contenteditable(?:(?!\1).)*)\1/g;

/**
 * Blank out comments (keeping newlines so reported line numbers stay true) —
 * prose that MENTIONS a bare selector must not count as a violation.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) => comment.replace(/[^\n]/g, ' '));

const scanFile = (file: string): string[] => {
  const source = stripComments(readFileSync(file, 'utf8'));
  const relPath = relative(REPO_ROOT, file);
  const violations: string[] = [];

  for (const match of source.matchAll(QUERY_RE)) {
    const selector = match[2];
    const exempt =
      selector.includes(GUARD) ||
      EXEMPT_QUERIES.some((entry) => entry.file === relPath && entry.selector === selector);

    if (!exempt) {
      const line = source.slice(0, match.index).split('\n').length;

      violations.push(`  ${relPath}:${line} — querySelector('${selector}')`);
    }
  }

  return violations;
};

describe('First-Editable Selector Law', () => {
  it('every contenteditable descendant query excludes mutation-free decorations', () => {
    const violations = walk(join(REPO_ROOT, SCAN_ROOT)).flatMap(scanFile);

    expect(
      violations,
      `Bare [contenteditable] descendant queries can resolve to a list marker ` +
      `(the first [contenteditable] in a list item's holder) instead of the ` +
      `block's text element — the root cause of the marker-ghost bug. Add ` +
      `'${GUARD}' to the selector, or add an EXEMPT_QUERIES entry with a ` +
      `reason:\n${violations.join('\n')}`
    ).toEqual([]);
  });

  it('exemptions list only queries that still exist (no stale entries)', () => {
    const stale: string[] = [];

    for (const entry of EXEMPT_QUERIES) {
      const full = join(REPO_ROOT, entry.file);

      let source = '';

      try {
        source = readFileSync(full, 'utf8');
      } catch {
        stale.push(`  ${entry.file} — file no longer exists`);
        continue;
      }

      if (!source.includes(entry.selector)) {
        stale.push(`  ${entry.file} — selector '${entry.selector}' no longer present`);
      }
    }

    expect(
      stale,
      `EXEMPT_QUERIES entries must track live code:\n${stale.join('\n')}`
    ).toEqual([]);
  });
});
