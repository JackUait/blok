/**
 * Architectural enforcement: the Placeholder Layout-Inert Law.
 *
 * An empty-state placeholder drawn with `::before { content: attr(…) }` sits at
 * the START of the host's first line box. If that pseudo-element is left in
 * normal flow it consumes real inline advance, and every caret whose anchor has
 * a layout box is pushed past it — the caret paints at the END of the
 * placeholder text, exactly as if the placeholder were real content.
 *
 * Measured on the built bundle (Chromium, Firefox and WebKit alike): a block
 * holding a single zero-width space while its placeholder is shown put the
 * caret at `content-box left + placeholder width`. That DOM state is not
 * exotic — `Dom.isNodeEmpty` deliberately strips `​`, so a block holding
 * the mark engine's pending-format ZWSP still counts as empty and still shows
 * its placeholder.
 *
 * The symptom is intermittent because it needs the caret's anchor to own a
 * layout box: a truly childless host has none, so engines park the caret at the
 * line start and the bug hides. That is why this must be enforced structurally
 * rather than fixed per report.
 *
 * The law: a placeholder `::before` must contribute ZERO inline advance. Take
 * the host pattern used across the editor — `inline-block` + `w-0` +
 * `whitespace-nowrap` (see the `blok-input` utility in `styles/main.css`) — or
 * take it out of flow with `position: absolute`. Either way the caret keeps the
 * line start and the placeholder text still paints, overflowing its zero-width
 * box.
 *
 * Mechanically enforced two ways:
 *
 * 1. Tailwind class strings in src/**\/*.ts. Every literal carrying
 *    `<variant>before:content-[attr(…)]` requires the same file to declare
 *    `<variant>before:inline-block`, `<variant>before:w-0` and
 *    `<variant>before:whitespace-nowrap` — same variant prefix, so a rule that
 *    only shows the placeholder in one state cannot be made inert in another.
 * 2. Leaf rules in src/**\/*.css. A `::before` rule whose declarations set
 *    `content: attr(…placeholder…)` must also declare `display: inline-block`
 *    + `width: 0` + `white-space: nowrap`, or `position: absolute`.
 *
 * `::after` placeholders (e.g. the slash-search pill) are out of scope: they
 * trail the content, so they cannot displace the caret.
 *
 * If this test fails on your change: add the inert trio next to the `content`
 * declaration. Genuine exceptions need an entry in EXEMPTIONS with a reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(__dirname, '../../../src');

/**
 * Known-intentional in-flow placeholders. Key: `<relative file>::<selector or variant>`.
 * Every entry MUST carry a reason.
 */
const EXEMPTIONS = new Map<string, string>([]);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|css)$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }

  return out;
};

const files = walk(SRC_DIR);

interface Violation {
  file: string;
  where: string;
  detail: string;
}

/** Utilities that must accompany a placeholder `::before`, keyed by variant prefix. */
const INERT_UTILITIES = ['inline-block', 'w-0', 'whitespace-nowrap'];

/** `<prefix>before:content-[attr(<attribute>)]` inside a quoted class string. */
const TW_PLACEHOLDER_CONTENT = /before:content-\[attr\((data-[a-z-]+)\)\]/;

const extractStringLiterals = (source: string): string[] => {
  const literals: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(source)) !== null) {
    literals.push(match[1] ?? match[2] ?? match[3] ?? '');
  }

  return literals;
};

const CONTENT_TOKEN = 'before:content-[attr(';

/** Variant prefixes (e.g. `empty:focus:`) that paint a placeholder in this file. */
const placeholderPrefixes = (tokens: string[]): string[] => {
  const prefixes = tokens
    .filter(token => token.includes(CONTENT_TOKEN) && TW_PLACEHOLDER_CONTENT.test(token))
    .map(token => token.slice(0, token.indexOf(CONTENT_TOKEN)));

  return [...new Set(prefixes)];
};

const findTsViolations = (file: string, source: string): Violation[] => {
  const tokens = extractStringLiterals(source).flatMap(literal => literal.split(/\s+/));
  const declared = new Set(tokens);

  return placeholderPrefixes(tokens).flatMap((prefix) => {
    const missing = INERT_UTILITIES
      .map(utility => `${prefix}before:${utility}`)
      .filter(utility => !declared.has(utility));

    return missing.length === 0
      ? []
      : [ {
        file,
        where: `${prefix}${CONTENT_TOKEN}…)]`,
        detail: `placeholder pseudo stays in flow — missing ${missing.join(', ')}`,
      } ];
  });
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

/** True when the rule paints placeholder text through generated content. */
const declaresPlaceholderContent = (decls: string): boolean =>
  /content\s*:\s*attr\(\s*data-[a-z-]*placeholder[a-z-]*\s*\)/i.test(decls);

/** True when the pseudo-element is taken out of the inline flow entirely. */
const isOutOfFlow = (decls: string): boolean => /position\s*:\s*absolute/.test(decls);

/** True when the pseudo-element keeps its place but claims no inline advance. */
const isZeroAdvance = (decls: string): boolean =>
  /display\s*:\s*inline-block/.test(decls) &&
  /width\s*:\s*0/.test(decls) &&
  /white-space\s*:\s*nowrap/.test(decls);

const findCssViolations = (file: string, source: string): Violation[] => {
  const violations: Violation[] = [];

  for (const rule of parseLeafRules(source)) {
    if (!rule.selector.includes('::before') || !declaresPlaceholderContent(rule.decls)) {
      continue;
    }

    if (isOutOfFlow(rule.decls) || isZeroAdvance(rule.decls)) {
      continue;
    }

    violations.push({
      file,
      where: rule.selector,
      detail: 'placeholder ::before stays in flow — add display:inline-block + width:0 + white-space:nowrap, or position:absolute',
    });
  }

  return violations;
};

describe('Placeholder Layout-Inert Law', () => {
  it('no placeholder ::before consumes inline advance at the line start', () => {
    const violations: Violation[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      const rel = relative(SRC_DIR, file);
      const found = file.endsWith('.css')
        ? findCssViolations(rel, source)
        : findTsViolations(rel, source);

      violations.push(
        ...found.filter(violation => !EXEMPTIONS.has(`${violation.file}::${violation.where}`))
      );
    }

    expect(
      violations.map(violation => `${violation.file} — ${violation.where}: ${violation.detail}`)
    ).toEqual([]);
  });
});
