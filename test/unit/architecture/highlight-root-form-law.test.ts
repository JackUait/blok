import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { describe, expect, it } from 'vitest';

/**
 * A `::highlight()` rule that matches every element (bare, or after a
 * descendant step) makes Chromium resolve that highlight's style once per
 * element on every style recalc. On a 100x100 table that is hundreds of ms.
 *
 * The law: outside highlight-fallback.css, every `::highlight()` selector is a
 * single compound (`[data-blok-interface]::highlight(x)`,
 * `:where(:root)::highlight(x)`). Descendants get the style by highlight
 * inheritance. Engines without highlight inheritance (Firefox) get the
 * descendant form from highlight-fallback.css, so each root-form rule needs a
 * matching descendant-form rule there with the same declarations.
 */

const STYLES = resolve(__dirname, '../../../src/styles');
const FALLBACK = join(STYLES, 'highlight-fallback.css');

const listCss = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);

  if (entry.isDirectory()) {
    return listCss(full);
  }

  return entry.name.endsWith('.css') ? [ full ] : [];
});

interface HighlightRule {
  file: string;
  selector: string;
  declarations: string;
}

const highlightRules = (file: string): HighlightRule[] => {
  const rules: HighlightRule[] = [];

  postcss.parse(readFileSync(file, 'utf-8')).walkRules((rule) => {
    const declarations = rule.nodes
      .filter((node): node is postcss.Declaration => node.type === 'decl')
      .map((decl) => `${decl.prop}:${decl.value}`)
      .join(';');

    rule.selectors
      .filter((selector) => selector.includes('::highlight('))
      .forEach((selector) => rules.push({ file: relative(STYLES, file), selector: selector.trim(), declarations }));
  });

  return rules;
};

const hasCombinator = (selector: string): boolean => {
  let found = false;

  selectorParser((root) => {
    root.each((sel) => {
      found ||= sel.nodes.some((node) => node.type === 'combinator');
    });
  }).processSync(selector);

  return found;
};

/**
 * Root form -> the descendant form it stands in for. A bare `::highlight()` keeps
 * the token roots too: var() resolves where the rule matches, so a root without
 * the colour tokens (`:root`) would hand descendants an empty colour.
 */
const TWINS = new Map([
  [ '[data-blok-interface]', '[data-blok-interface]' ],
  [ ':where(:root, [data-blok-interface], [data-blok-popover], [data-blok-top-layer]:not([data-blok-interface] *))', ':where(:root)' ],
]);

const rootOf = (selector: string): string | undefined => [ ...TWINS.keys() ].find((root) => selector.startsWith(`${root}::highlight(`));

const sourceRules = (): HighlightRule[] => listCss(STYLES).filter((file) => file !== FALLBACK).flatMap(highlightRules);

describe('highlight root-form law', () => {
  it('every ::highlight() selector outside the fallback is one compound, not bare and not on :root alone', () => {
    const offenders = sourceRules()
      .filter((rule) => hasCombinator(rule.selector) || rule.selector.startsWith('::') || /^(:root|:where\(:root\))::/.test(rule.selector))
      .map((rule) => `${rule.file}: ${rule.selector}`);

    expect(offenders).toEqual([]);
  });

  it('every root-form rule has a descendant-form twin in highlight-fallback.css with the same declarations', () => {
    const fallback = highlightRules(FALLBACK);
    const missing = sourceRules()
      .filter((rule) => rootOf(rule.selector) !== undefined)
      .filter((rule) => {
        const root = rootOf(rule.selector) ?? '';
        const twin = `${TWINS.get(root) ?? ''} ${rule.selector.slice(root.length)}`;

        return !fallback.some((candidate) => candidate.selector === twin && candidate.declarations === rule.declarations);
      })
      .map((rule) => `${rule.file}: ${rule.selector}`);

    expect(sourceRules().filter((rule) => rootOf(rule.selector) !== undefined).length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('the fallback holds only descendant-form ::highlight() rules', () => {
    const stray = highlightRules(FALLBACK)
      .filter((rule) => ![ ...TWINS.values() ].some((root) => rule.selector.startsWith(`${root} ::highlight(`)))
      .map((rule) => rule.selector);

    expect(stray).toEqual([]);
  });
});
