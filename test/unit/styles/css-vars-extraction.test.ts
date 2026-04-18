import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * CSS custom property extraction audit.
 *
 * These tests are introduced RED as part of Phase 1 of the
 * CSS variables extraction spec (docs/superpowers/specs/2026-04-18-css-vars-extraction-design.md).
 *
 * Each rule flips GREEN as the matching extraction batch lands in Phase 2:
 *   R1 — batches B1 (colors) + B4 (shadows)
 *   R2 — batches B2, B3, B7 (lengths + typography lengths)
 *   R3 — enforced continuously from B1 onwards
 *   R4 — enforced continuously from B1 onwards
 *
 * Source used: src/styles/main.css (author CSS, pre-Tailwind-compile).
 * This avoids depending on a `yarn build` step inside the unit test runner
 * and matches the pattern used in test/unit/styles/preflight.test.ts.
 */

const cssPath = resolve(__dirname, '../../../src/styles/main.css');
const css = readFileSync(cssPath, 'utf-8');

/**
 * Lines that belong to the palette / token-definition blocks and are therefore
 * allowed to contain raw literals. Extraction batches declare new `--blok-*`
 * vars here; direct-usage literals elsewhere are the violation.
 *
 * The inventory spec (§1, §6) identifies three blocks:
 *   A. `:root { ... }`               — light theme palette
 *   B. `@media (prefers-color-scheme: dark) :root { ... }` — dark media query
 *   C. `[data-blok-interface=blok][data-blok-theme=dark] { ... }` — dark attr
 *
 * Each block's literal-allowed range is detected by regex on the source.
 */
type Range = { start: number; end: number };

function findBlockRanges(source: string): Range[] {
  /**
   * A "palette block" is any CSS rule whose body contains at least one
   * `--blok-*:` declaration. That includes:
   *   - `:root { ... }`
   *   - `[data-blok-interface], [data-blok-popover] { ... }`
   *   - `:root:not([data-blok-theme="light"]) [data-blok-interface] { ... }`
   *   - `[data-blok-theme="dark"] [data-blok-interface] { ... }`
   *   - any future variant we introduce
   *
   * Detecting by content (not selector) keeps the audit resilient as the
   * selector strategy evolves.
   */
  const ranges: Range[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '{') continue;
    const closeIdx = findMatchingBrace(source, i);
    if (closeIdx === -1) continue;
    const body = source.slice(i + 1, closeIdx);
    // Any custom-property declaration marks this as a token-definition block
    // (`:root`, scoped palette roots, `@theme`, dark-theme overrides, etc).
    if (/--[a-z][\w-]*\s*:/.test(body)) {
      ranges.push({ start: i, end: closeIdx });
    }
    // Don't jump past this block — nested palette blocks (e.g. :root inside
    // @media) must also be detected.
  }
  return ranges;
}

function findMatchingBrace(source: string, openIdx: number): number {
  let depth = 0;

  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
      continue;
    }
    if (source[i] !== '}') continue;
    depth--;
    if (depth === 0) return i;
  }

  return -1;
}

function lineOf(source: string, idx: number): number {
  return source.slice(0, idx).split('\n').length;
}

function inAnyRange(idx: number, ranges: Range[]): boolean {
  return ranges.some((r) => idx >= r.start && idx <= r.end);
}

/**
 * Strip comment blocks so regex matches ignore commented-out example values.
 * Newlines inside comments are preserved so that source positions and line
 * numbers computed from the stripped buffer still match the original file.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (match) =>
    match.replace(/[^\n]/g, ' '),
  );
}

const sourceClean = stripComments(css);
const tokenRanges = findBlockRanges(sourceClean);

/**
 * Keywords that look like colors but are not extractable literals.
 */
const COLOR_KEYWORD_ALLOWLIST = new Set([
  'transparent',
  'currentColor',
  'currentcolor',
  'inherit',
  'initial',
  'unset',
  'revert',
  'none',
]);

// ---------------------------------------------------------------------------
// R1 — No raw color literal appears outside a palette block.
// ---------------------------------------------------------------------------

/**
 * Ranges of `box-shadow:` declarations. Colour literals embedded in shadow
 * strings are extracted separately in B4 — until then, they're allowlisted
 * here so R1 can enforce strict extraction everywhere else.
 */
const shadowDeclRegex = /box-shadow\s*:[^;]*/g;
const shadowRanges: Range[] = [];

for (const m of sourceClean.matchAll(shadowDeclRegex)) {
  shadowRanges.push({ start: m.index, end: m.index + m[0].length });
}

describe('R1 — colors must live in palette blocks', () => {
  const colorPatterns = [
    { kind: 'hex', regex: /#[0-9a-fA-F]{3,8}\b/g },
    { kind: 'rgba', regex: /\brgba?\s*\([^)]*\)/g },
    { kind: 'hsla', regex: /\bhsla?\s*\([^)]*\)/g },
  ];

  for (const { kind, regex } of colorPatterns) {
    it(`no raw ${kind} literal outside palette / token blocks`, () => {
      const violations: Array<{ line: number; match: string }> = [];

      for (const m of sourceClean.matchAll(regex)) {
        const idx = m.index;
        if (inAnyRange(idx, tokenRanges)) continue;
        // TODO(B4): drop shadowRanges allowlist once shadows reference colour vars.
        if (inAnyRange(idx, shadowRanges)) continue;

        // Allowlist: literal lives inside a `var(--x, <literal>)` fallback.
        // Fallbacks are acceptable short-term but flagged by R3/R4 later.
        const pre = sourceClean.slice(Math.max(0, idx - 40), idx);
        if (/var\(\s*--[\w-]+\s*,\s*$/.test(pre)) continue;

        violations.push({ line: lineOf(sourceClean, idx), match: m[0] });
      }

      expect(
        violations,
        `Expected 0 ${kind} violations, found ${violations.length}:\n${violations
          .map((v) => `  line ${v.line}: ${v.match}`)
          .join('\n')}`,
      ).toEqual([]);
    });
  }

  it('no named color keyword (black/white/etc) used as value outside palette', () => {
    const namedRegex =
      /:\s*(black|white|red|blue|green|gray|grey|silver|purple|yellow|orange|pink|aqua|fuchsia|lime|maroon|navy|olive|teal)\b/g;
    const violations: Array<{ line: number; match: string }> = [];

    for (const m of sourceClean.matchAll(namedRegex)) {
      const idx = m.index;
      if (inAnyRange(idx, tokenRanges)) continue;
      if (COLOR_KEYWORD_ALLOWLIST.has(m[1])) continue;
      violations.push({ line: lineOf(sourceClean, idx), match: m[0].trim() });
    }

    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R2 — No non-zero length literal appears >= 2 times outside var definitions.
// ---------------------------------------------------------------------------

describe('R2 — repeated length literals in themeable properties must be tokenised', () => {
  /**
   * Scope: enforces on `padding`, `margin`, `gap`, `border-radius`,
   * `border-width`, and the four `border-*-width` properties. These are the
   * properties a theme consumer typically wants to rescale.
   *
   * Out of scope (allowed to remain literal):
   *   - `box-shadow` offsets and blur radii (visual-effect composition, B4).
   *   - Pixel-exact layout primitives (widths, heights, positions).
   *   - Pseudo-element `top` / `left` / `margin-left` positioning.
   */
  const THEMEABLE_PROPERTIES = [
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'padding-inline', 'padding-inline-start', 'padding-inline-end',
    'padding-block', 'padding-block-start', 'padding-block-end',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'margin-inline', 'margin-inline-start', 'margin-inline-end',
    'margin-block', 'margin-block-start', 'margin-block-end',
    'gap', 'row-gap', 'column-gap',
    'border-radius',
    'border-top-left-radius', 'border-top-right-radius',
    'border-bottom-left-radius', 'border-bottom-right-radius',
    'border-width',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  ];
  const themeablePattern = new RegExp(
    `(?<![-\\w])(${THEMEABLE_PROPERTIES.join('|')})\\s*:\\s*([^;]+)`,
    'g',
  );

  it('no non-zero length repeats across themeable-property declarations', () => {
    const lengthRegex = /\b-?\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|ch)\b/g;
    const buckets = new Map<string, number[]>();

    for (const m of sourceClean.matchAll(themeablePattern)) {
      // Skip declarations that are already a single var() call — the
      // end-state we're chasing.
      if (/^\s*var\(/.test(m[2])) continue;

      const valueStart = m.index + m[0].indexOf(m[2]);
      for (const lm of m[2].matchAll(lengthRegex)) {
        const literal = lm[0];
        if (/^-?0+(?:\.0+)?(?:px|rem|em|%|vh|vw|vmin|vmax|ch)$/.test(literal)) continue;

        const absIdx = valueStart + lm.index;
        if (inAnyRange(absIdx, tokenRanges)) continue;

        if (!buckets.has(literal)) buckets.set(literal, []);
        buckets.get(literal).push(lineOf(sourceClean, absIdx));
      }
    }

    const repeated = [...buckets.entries()]
      .filter(([, lines]) => lines.length >= 2)
      .map(([lit, lines]) => ({ literal: lit, count: lines.length, lines: lines.slice(0, 5) }))
      .sort((a, b) => b.count - a.count);

    expect(
      repeated,
      `Expected 0 repeated themeable length literals, found ${repeated.length}. Top 10:\n${repeated
        .slice(0, 10)
        .map((r) => `  ${r.literal} × ${r.count} (first lines: ${r.lines.join(', ')})`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R3 — Every declared --blok-* var must be used at least once.
// ---------------------------------------------------------------------------

describe('R3 — declared vars must be referenced', () => {
  it('every --blok-* declaration has at least one var(--blok-*) reference', () => {
    const declRegex = /^\s*(--blok-[\w-]+)\s*:/gm;
    const declared = new Set<string>();
    for (const m of sourceClean.matchAll(declRegex)) declared.add(m[1]);

    const usedRegex = /var\(\s*(--blok-[\w-]+)/g;
    const used = new Set<string>();
    for (const m of sourceClean.matchAll(usedRegex)) used.add(m[1]);

    const unreferenced = [...declared].filter((name) => !used.has(name)).sort();

    expect(
      unreferenced,
      `Expected every declared --blok-* var to be referenced. Unreferenced (${unreferenced.length}):\n${unreferenced
        .slice(0, 20)
        .map((n) => `  ${n}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// R4 — No --blok-* var is redefined outside the known palette blocks.
// ---------------------------------------------------------------------------

describe('R4 — var redefinitions restricted to palette blocks', () => {
  it('no --blok-* declaration appears outside palette / token blocks', () => {
    const declRegex = /(^|\n|\{)\s*(--blok-[\w-]+)\s*:/g;
    const violations: Array<{ line: number; name: string }> = [];

    for (const m of sourceClean.matchAll(declRegex)) {
      // Locate the start of the declaration (the `--blok-*` identifier).
      const declStart = m.index + m[0].indexOf('--blok-');
      if (inAnyRange(declStart, tokenRanges)) continue;
      violations.push({ line: lineOf(sourceClean, declStart), name: m[2] });
    }

    expect(
      violations,
      `Expected no --blok-* declarations outside palette blocks. Violations (${violations.length}):\n${violations
        .slice(0, 20)
        .map((v) => `  line ${v.line}: ${v.name}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
