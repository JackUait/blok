import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFLIGHT_PATH = resolve(__dirname, '../../../src/styles/preflight.css');
const rawCss = readFileSync(PREFLIGHT_PATH, 'utf-8');

/**
 * Per the CSS cascade-layer spec, an unlayered rule ALWAYS beats a layered one
 * regardless of specificity or source order. Blok's own spacing/color/etc.
 * utility classes are imported into `@layer utilities` (main.css), so any
 * unlayered, non-`!important` reset in this file permanently overrides them —
 * no host page required. This is exactly what happened with the margin reset
 * (`mt-[26px]` and friends silently collapsing to 0).
 *
 * The architectural rule going forward: every plain reset here lives in
 * `@layer base` so it still loses to Blok's own utilities. The only rules
 * allowed to stay unlayered are ones that use `!important` on every single
 * declaration — that's the deliberate, opt-in exception for rules meant to
 * beat HOST-page styles unconditionally (see the file's own top comment).
 *
 * This test parses every top-level rule in preflight.css and enforces that
 * invariant generically, so ANY future rule — not just the one that broke —
 * gets caught if it's added unlayered without `!important`.
 */

interface TopLevelBlock {
  prelude: string;
  body: string;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitTopLevelBlocks(css: string): TopLevelBlock[] {
  const blocks: TopLevelBlock[] = [];
  let depth = 0;
  let blockStart = -1;
  let preludeStart = 0;

  for (let i = 0; i < css.length; i++) {
    const ch = css[i];

    if (ch === '{') {
      blockStart = depth === 0 ? i : blockStart;
      depth++;
      continue;
    }

    if (ch !== '}') continue;

    depth--;
    if (depth !== 0 || blockStart === -1) continue;

    blocks.push({
      prelude: css.slice(preludeStart, blockStart).trim(),
      body: css.slice(blockStart + 1, i),
    });
    preludeStart = i + 1;
    blockStart = -1;
  }

  return blocks;
}

function declarationsMissingImportant(body: string): string[] {
  const declarationPattern = /([a-zA-Z-]+)\s*:\s*[^;{}]+;/g;
  const offenders: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = declarationPattern.exec(body)) !== null) {
    if (!match[0].includes('!important')) {
      offenders.push(match[0].trim());
    }
  }

  return offenders;
}

const css = stripComments(rawCss);
const topLevelBlocks = splitTopLevelBlocks(css);

describe('preflight.css cascade-layer safety', () => {
  it('parses at least one @layer base block and one unlayered rule (sanity check on the parser itself)', () => {
    expect(topLevelBlocks.some((b) => b.prelude.startsWith('@layer base'))).toBe(true);
    expect(topLevelBlocks.some((b) => !b.prelude.startsWith('@layer'))).toBe(true);
  });

  it.each(
    topLevelBlocks
      .filter((b) => !b.prelude.startsWith('@layer'))
      .map((b) => ({ label: b.prelude.slice(0, 80), body: b.body }))
  )('every unlayered top-level rule ($label) is fully !important-guarded', ({ body }) => {
    // A rule outside @layer base always beats Blok's own @layer utilities
    // regardless of specificity — so it must either move into @layer base,
    // or (if it's deliberately meant to beat the host) mark every declaration
    // !important, same as the heading font-family/letter-spacing carve-out.
    expect(declarationsMissingImportant(body)).toEqual([]);
  });
});
