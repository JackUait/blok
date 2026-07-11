/**
 * Architectural enforcement: the Table-Cell Font-Scale Law.
 *
 * A table cell defines a reduced type scale (`text-sm`, 14px, via CELL_CLASSES
 * in src/tools/table/table-core.ts). Every block rendered inside a cell must
 * present its text at that scale so a list/paragraph/etc never outsizes its
 * neighbours in the same cell.
 *
 * The failure mode this guards (shipped once, for lists): a block tool writes a
 * host-configured font size as an INLINE `style.fontSize` on cell-reachable
 * content. Inline styles beat the cell's inherited size, so that block renders
 * larger than sibling paragraphs. It happened with the list tool's `itemSize`
 * (item.style.fontSize) and is latent in the paragraph tool's `styles.size`
 * (inlineStyles.fontSize) — both are neutralised in cells by a
 * `font-size: inherit !important` override in src/styles/tables.css.
 *
 * This test keeps that guarantee honest as tools evolve:
 *
 * 1. Every inline `fontSize` sink under src/tools is scanned (directory walk —
 *    a new tool cannot dodge it). Each must be classified as either:
 *    - GUARDED — the sink writes text that can render inside a cell, and
 *      tables.css force-inherits its font there. (The behavioural proof lives
 *      in test/playwright/tests/tools/table-any-block-type.spec.ts.)
 *    - EXEMPT — the sink never renders as cell body text (UI chrome, a tool
 *      that is restricted from cells, or a fixed decorative glyph). Every entry
 *      says WHY.
 *    An unclassified sink fails the test: the author must decide whether it is
 *    cell-reachable and, if so, add a tables.css override before exempting.
 *
 * 2. The tables.css override selectors that neutralise the GUARDED sinks must
 *    exist, so the fix cannot be silently deleted.
 *
 * Boundary: this scans inline `style.fontSize` writes (the config-driven vector
 * that caused the bug). A tool that instead sizes cell text via a Tailwind
 * font-size utility on a child element is out of scope here — the `[data-blok-tool]`
 * override covers the tool root, and any such child would need its own override
 * plus a behavioural test, same as the list item.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const SCAN_ROOT = 'src/tools';
const TABLES_CSS = 'src/styles/tables.css';

interface FontSizeSink {
  /** Repo-relative file the sink lives in. */
  file: string;
  /** Distinctive substring of the assignment line, e.g. `item.style.fontSize`. */
  match: string;
  /** Why it is guarded / why it is safe to exempt. */
  reason: string;
}

/**
 * Sinks that write text which CAN render inside a table cell. Each is
 * neutralised by a `font-size: inherit !important` rule in tables.css so the
 * cell's type scale wins. Behaviour is proven by the table-any-block-type e2e.
 */
const GUARDED_SINKS: FontSizeSink[] = [
  {
    file: 'src/tools/paragraph/index.ts',
    match: 'inlineStyles.fontSize',
    reason: 'paragraph styles.size on the [data-blok-tool="paragraph"] root — inherited via the [data-blok-tool] cell override',
  },
  {
    file: 'src/tools/list/dom-builder.ts',
    match: 'item.style.fontSize',
    reason: 'list itemSize on the [role="listitem"] item — inherited via the [role="listitem"] cell override',
  },
  {
    file: 'src/tools/list/dom-builder.ts',
    match: 'wrapper.style.fontSize',
    reason: 'checklist itemSize on the [role="listitem"] wrapper — inherited via the [role="listitem"] cell override',
  },
];

/**
 * Sinks that never render as cell body text. Every entry must say WHY.
 * Exempting a sink that DOES render cell text violates the law — add a
 * tables.css override and mark it GUARDED instead.
 */
const EXEMPT_SINKS: FontSizeSink[] = [
  {
    file: 'src/tools/header/index.ts',
    match: 'inlineStyles.fontSize',
    reason: 'header is restricted in table cells (convertToParagraph demotes it) — its size override never renders in a cell',
  },
  {
    file: 'src/tools/list/dom-builder.ts',
    match: 'marker.style.fontSize',
    reason: 'fixed-size list bullet on a child that is neither a [data-blok-tool] root nor a [role="listitem"]; intentional, matches its size outside cells',
  },
  {
    file: 'src/tools/table/table-cell-placement-picker.ts',
    match: 'label.style.fontSize',
    reason: 'table cell-placement picker chrome (a control label) — never rendered as cell block content',
  },
  {
    file: 'src/tools/database/index.ts',
    match: 'titleEl.style.fontSize',
    reason: 'database page title, not inline cell body text; database is a page container and its title size is intentional',
  },
];

const KNOWN_SINKS = [...GUARDED_SINKS, ...EXEMPT_SINKS];

const collectFiles = (root: string): string[] =>
  readdirSync(root).flatMap((entry) => {
    const fullPath = join(root, entry);

    if (statSync(fullPath).isDirectory()) {
      return collectFiles(fullPath);
    }

    return entry.endsWith('.ts') && !entry.endsWith('.d.ts') ? [fullPath] : [];
  });

/** Matches an inline font-size write: `x.fontSize = …` or `fontSize: …` (not `==`). */
const FONT_SIZE_SINK = /\bfontSize\s*[:=](?!=)/;

interface FoundSink {
  file: string;
  line: number;
  text: string;
}

const findSinks = (): FoundSink[] =>
  collectFiles(join(REPO_ROOT, SCAN_ROOT))
    .map((file) => file.slice(REPO_ROOT.length + 1))
    .flatMap((file) => {
      const source = readFileSync(join(REPO_ROOT, file), 'utf-8');

      return source
        .split('\n')
        .map((text, index) => ({ file, line: index + 1, text }))
        .filter(({ text }) => FONT_SIZE_SINK.test(text));
    });

describe('Table-Cell Font-Scale Law: cell text stays at the cell type scale', () => {
  it('every inline fontSize sink under src/tools is GUARDED or EXEMPT', () => {
    const violations = findSinks()
      .filter(({ file, text }) =>
        !KNOWN_SINKS.some((sink) => sink.file === file && text.includes(sink.match))
      )
      .map(({ file, line, text }) =>
        `${file}:${line} writes an inline font-size (${text.trim()}) that is not classified. ` +
        'If this text can render inside a table cell, add a font-size override in ' +
        `${TABLES_CSS} (plus a case in table-any-block-type.spec.ts) and list it in ` +
        'GUARDED_SINKS; otherwise add it to EXEMPT_SINKS with a reason.'
      );

    expect(violations).toEqual([]);
  });

  it('every classified sink still exists in code (stale entries must be removed)', () => {
    const found = findSinks();

    const stale = KNOWN_SINKS
      .filter((sink) =>
        !found.some(({ file, text }) => sink.file === file && text.includes(sink.match))
      )
      .map((sink) => `${sink.file}: classified sink "${sink.match}" no longer exists`);

    expect(stale).toEqual([]);
  });

  it('tables.css force-inherits font-size for cell blocks and list items (the fix cannot be deleted)', () => {
    const css = readFileSync(join(REPO_ROOT, TABLES_CSS), 'utf-8');

    // The rule that neutralises every GUARDED sink.
    expect(css).toMatch(/\[data-blok-table-cell-blocks\]\s+\[data-blok-tool\]/);
    expect(css).toMatch(/\[data-blok-table-cell-blocks\]\s+\[data-blok-tool="list"\]\s+\[role="listitem"\]/);
    expect(css).toMatch(/font-size:\s*inherit\s*!important/);
  });
});
