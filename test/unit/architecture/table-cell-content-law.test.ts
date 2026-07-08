/**
 * Architectural enforcement: the Table Cell Content Law.
 *
 * The law (see CLAUDE.md, Tools section): table cells store content as an
 * HTML string, and ANY code converting that string into blocks MUST use
 * `parseCellContentToBlocks`, and any code serializing cell blocks back into
 * that string MUST use `serializeCellBlocksToHtml` (both in
 * src/tools/table/table-cell-paste.ts). Ad-hoc `<br>`-splitting or
 * space-joining of block texts silently destroys lists inside cells — that
 * exact pattern independently existed in FIVE places (initializeCells,
 * buildCellPayloadFromTd, buildCellContent, insertSingleCellPayloadInline,
 * buildClipboardHtml) and each one flattened cell lists on a different
 * copy/paste path. Root cause of "pasted table loses bullet points"
 * (fixed in db4c243d) and "copied table loses bullet points in external apps".
 *
 * This test mechanically enforces the law so a sixth flatten site cannot be
 * added by oversight:
 *
 * 1. Every .ts file under src/tools/table plus the table-cells paste handler
 *    is scanned (directory walk — new files cannot dodge the scan).
 * 2. Outside table-cell-paste.ts, these flatten fingerprints are forbidden:
 *    - splitting a string on `<br>` (cell HTML → text lines)
 *    - joining with `'<br>'` (block texts → cell HTML)
 *    - joining with `' '` (block texts → flat text)
 *    unless listed in EXEMPT_SITES with a reason explaining why the site
 *    cannot lose list structure.
 * 3. The known cell-content conversion sites must import the canonical pair —
 *    removing the import (i.e. rewriting the site by hand) fails the test.
 *
 * If this test fails on your change: route the conversion through
 * parseCellContentToBlocks / serializeCellBlocksToHtml, or — only if the site
 * provably cannot carry list blocks — add an exemption below with a reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');

/** The single file allowed to implement cell-content conversion primitives. */
const CANONICAL_FILE = 'src/tools/table/table-cell-paste.ts';

/** Paste pipeline files outside src/tools/table that handle cell blocks. */
const EXTRA_FILES = ['src/components/modules/paste/handlers/table-cells-handler.ts'];

interface ExemptSite {
  file: string;
  /** The exact matched snippet expected at this site (guards against drift). */
  snippet: string;
  reason: string;
}

/**
 * Flatten-fingerprint occurrences that provably cannot lose list structure.
 * Every entry must say WHY. Adding an entry to silence a site that CAN see
 * list blocks violates the law — use the canonical pair instead.
 */
const EXEMPT_SITES: ExemptSite[] = [
  {
    file: 'src/tools/table/table-subsystems.ts',
    snippet: ".join('<br>')",
    reason:
      'insertSingleCellPayloadInline runs only behind the isTextOnly gate ' +
      '(every block is a paragraph with string text), so a <br>-join is lossless',
  },
  {
    file: 'src/tools/table/table-cell-clipboard.ts',
    snippet: ".join(' ')",
    reason:
      'extractBlockHtml normalizes LEGACY items-array block shapes (no per-item ' +
      'depth/style to preserve); modern list blocks never reach this branch',
  },
  {
    file: 'src/tools/table/table-cell-clipboard.ts',
    snippet: ".join(' ')).join('\\t')",
    reason:
      'buildClipboardPlainText feeds the text/plain TSV channel — cells cannot ' +
      'contain newlines and plain text carries no list structure by definition',
  },
];

/**
 * Sites that MUST route through the canonical pair: file → required imports.
 * These are the historical flatten sites; losing the import means the
 * conversion was rewritten by hand.
 */
const REQUIRED_IMPORTS: Record<string, string[]> = {
  'src/tools/table/table-cell-blocks.ts': ['parseCellContentToBlocks'],
  'src/tools/table/table-cell-clipboard.ts': ['parseCellContentToBlocks', 'serializeCellBlocksToHtml'],
  'src/components/modules/paste/handlers/table-cells-handler.ts': ['serializeCellBlocksToHtml'],
};

/** Flatten fingerprints: [description, matcher]. */
const FORBIDDEN_PATTERNS: Array<[string, RegExp]> = [
  ['<br>-split of cell HTML', /\.split\(\s*(?:\/<br|['"`]<br)/gi],
  ["'<br>'-join of block texts", /\.join\(\s*['"`]<br\s*\/?>['"`]\s*\)/gi],
  ["' '-join (space-flattening) of block texts", /\.join\(\s*' '\s*\)/g],
];

const collectFiles = (root: string): string[] => {
  const entries = readdirSync(root);

  return entries.flatMap((entry) => {
    const fullPath = join(root, entry);

    if (statSync(fullPath).isDirectory()) {
      return collectFiles(fullPath);
    }

    return entry.endsWith('.ts') && !entry.endsWith('.d.ts') ? [fullPath] : [];
  });
};

const SCANNED_FILES = [
  ...collectFiles(join(REPO_ROOT, 'src/tools/table')).map((file) => file.slice(REPO_ROOT.length + 1)),
  ...EXTRA_FILES,
];

const readSource = (relFile: string): string => readFileSync(join(REPO_ROOT, relFile), 'utf-8');

const lineOf = (source: string, index: number): number =>
  source.slice(0, index).split('\n').length;

const isExempt = (relFile: string, source: string, matchIndex: number): boolean =>
  EXEMPT_SITES.some((site) => {
    if (site.file !== relFile) {
      return false;
    }

    const siteIndex = source.indexOf(site.snippet);

    return siteIndex !== -1 && matchIndex >= siteIndex && matchIndex < siteIndex + site.snippet.length;
  });

describe('Table Cell Content Law: cell HTML ↔ blocks conversion goes through the canonical pair', () => {
  it('no flatten fingerprints outside table-cell-paste.ts (unless exempted with a reason)', () => {
    const violations = SCANNED_FILES
      .filter((file) => file !== CANONICAL_FILE)
      .flatMap((file) => {
        const source = readSource(file);

        return FORBIDDEN_PATTERNS.flatMap(([description, pattern]) =>
          Array.from(source.matchAll(new RegExp(pattern.source, pattern.flags)))
            .filter((match) => !isExempt(file, source, match.index))
            .map((match) =>
              `${file}:${lineOf(source, match.index)} — ${description}. ` +
              'Route cell content through parseCellContentToBlocks / serializeCellBlocksToHtml ' +
              '(table-cell-paste.ts), or add an EXEMPT_SITES entry with a reason if this site ' +
              'provably never sees list blocks.'
            )
        );
      });

    expect(violations).toEqual([]);
  });

  it('every exemption still matches real code (stale exemptions must be removed)', () => {
    const stale = EXEMPT_SITES
      .filter((site) => !readSource(site.file).includes(site.snippet))
      .map((site) => `${site.file}: exempted snippet ${JSON.stringify(site.snippet)} no longer exists`);

    expect(stale).toEqual([]);
  });

  it('known cell-content conversion sites import the canonical pair', () => {
    const missing = Object.entries(REQUIRED_IMPORTS).flatMap(([file, names]) => {
      const source = readSource(file);

      return names
        .filter((name) => !source.includes(name))
        .map((name) => `${file}: no longer uses ${name} — cell-content conversion must go through table-cell-paste.ts`);
    });

    expect(missing).toEqual([]);
  });

  it('the canonical file actually exports the pair', () => {
    const source = readSource(CANONICAL_FILE);

    expect(source).toContain('export const parseCellContentToBlocks');
    expect(source).toContain('export const serializeCellBlocksToHtml');
  });
});
