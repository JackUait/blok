/**
 * Architectural enforcement: the Ellipsis Line-Height Clip Law.
 *
 * `text-overflow: ellipsis` only works with `overflow: hidden`, and `overflow`
 * clips at the PADDING box. A single-line field that pairs that triad with
 * `--blok-line-height-tight` (1) therefore gets a clip box exactly `font-size`
 * tall — shorter than the font's content area (~1.21em for Inter) — so the
 * shear cuts glyph ascenders/descenders and the caret. This is how the audio
 * player's title rendered "Song" with the `g` sliced flat.
 *
 * The law: a rule declaring the full single-line ellipsis triad
 * (`white-space: nowrap` + `overflow: hidden` + `text-overflow: ellipsis`)
 * must not set a line-height below the font's content area. Use
 * `--blok-line-height-option` (1.3) — what `.blok-file-name` already does with
 * the same triad.
 *
 * The triad, not `overflow: hidden` alone, is the key: `overflow: hidden` for
 * border-radius clipping on a padded container (e.g. the xlsx preview table)
 * is unaffected because the glyphs sit inside the padding.
 *
 * If this test fails on your change: raise the line-height. Genuine exceptions
 * need an entry in EXEMPTIONS with a reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(__dirname, '../../../src');

/** Line-height values whose box is shorter than the font's content area. */
const CLIPPING_LINE_HEIGHTS = /line-height\s*:\s*(?:var\(\s*--blok-line-height-tight[^)]*\)|1(?:\.0+)?)\s*(?:;|$)/;

/**
 * Known-intentional pairings. Key: `<relative file>::<selector>`.
 * Every entry MUST carry a reason.
 */
const EXEMPTIONS = new Map<string, string>([]);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith('.css')) {
      out.push(full);
    }
  }

  return out;
};

interface CssRule {
  selector: string;
  decls: string;
}

const parseLeafRules = (source: string): CssRule[] => {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(noComments)) !== null) {
    const decls = match[2];
    const selectors = match[1]
      .split(',')
      .map(selector => selector.trim())
      .filter(selector => selector !== '' && !selector.startsWith('@'));

    rules.push(...selectors.map(selector => ({ selector, decls })));
  }

  return rules;
};

const declaresEllipsisTriad = (decls: string): boolean =>
  /white-space\s*:\s*nowrap\s*(?:;|$)/.test(decls) &&
  /overflow\s*:\s*hidden\s*(?:;|$)/.test(decls) &&
  /text-overflow\s*:\s*ellipsis\s*(?:;|$)/.test(decls);

describe('Ellipsis Line-Height Clip Law', () => {
  const files = walk(SRC_DIR);

  it('scans the editor stylesheets', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  const clippingRulesIn = (rel: string, source: string): string[] =>
    parseLeafRules(source)
      .filter(rule => declaresEllipsisTriad(rule.decls) && CLIPPING_LINE_HEIGHTS.test(rule.decls))
      .filter(rule => !EXEMPTIONS.has(`${rel}::${rule.selector}`))
      .map(
        rule =>
          `${rel} :: ${rule.selector} — single-line ellipsis field with a line-height ` +
          'below the font content area; ascenders/descenders and the caret get sheared. ' +
          'Use var(--blok-line-height-option).'
      );

  it('never clips a single-line ellipsis field with a tight line-height', () => {
    const violations = files.flatMap(file =>
      clippingRulesIn(relative(SRC_DIR, file), readFileSync(file, 'utf8'))
    );

    expect(violations).toEqual([]);
  });
});
