/**
 * Architectural enforcement: the Input Focus Double-Border Law.
 *
 * A focused text field must show exactly ONE focus indicator. Pairing a
 * border(-color) with an additional outer `box-shadow: 0 0 0 Npx …` halo (or
 * a Tailwind `focus*:ring-*` / `focus*:shadow-[0_0_0_…]` utility) renders as
 * two concentric borders around the input — the "double border" artifact
 * first reported on the popover search field, where a 1px accent border sat
 * inside a 2px pale-blue halo.
 *
 * The law: any style that reacts to focus (`:focus`, `:focus-within`,
 * `:focus-visible`) on an input-bearing element may change the border OR draw
 * a halo ring — never both. Borderless controls using a ring as their sole
 * focus indicator (e.g. the emoji-picker filter input) are compliant.
 *
 * Mechanically enforced two ways:
 *
 * 1. Every string literal in src/**\/*.ts is scanned. A literal that contains
 *    a focus halo utility (`focus*:shadow-[0_0_0_…]` or `focus*:ring-N`)
 *    together with any border utility is a violation.
 * 2. Every leaf rule in src/**\/*.css is scanned. A rule whose selector has a
 *    focus pseudo-class and targets an input context (`:focus-within` on a
 *    wrapper, or `input` / `textarea` / `[aria-invalid…]` / searchbox
 *    selectors) must not declare an outer 0-0-0 box-shadow halo while a
 *    border is set — either in the same rule or in the base rule for the
 *    same selector (the selector with focus pseudos stripped).
 *
 * If this test fails on your change: pick one indicator. Keep the
 * border-color change and drop the halo (the editor-wide convention), or make
 * the control borderless and keep only the ring. Genuine exceptions need an
 * entry in EXEMPTIONS with a reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = resolve(__dirname, '../../../src');

/**
 * Known-intentional pairings. Key: `<relative file>::<selector or literal snippet>`.
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

/** Matches Tailwind focus halo utilities: focus*:shadow-[0_0_0_…] or focus*:ring-N. */
const TW_FOCUS_HALO = /(?:^|\s)(?:focus|focus-within|focus-visible):(?:shadow-\[0_0_0|ring-\d)/;
/** Matches any border utility except explicit resets (border-0, border-none). */
const TW_BORDER = /(?:^|\s)(?:(?:focus|focus-within|focus-visible|hover|theme-dark):)*border(?:-(?!0(?:\s|$)|none(?:\s|$))[\w[\]./-]+)?(?:\s|$)/;

const extractStringLiterals = (source: string): string[] => {
  const literals: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(source)) !== null) {
    literals.push(match[1] ?? match[2] ?? match[3] ?? '');
  }

  return literals;
};

const findTsViolations = (file: string, source: string): Violation[] => {
  const violations: Violation[] = [];

  for (const literal of extractStringLiterals(source)) {
    if (TW_FOCUS_HALO.test(literal) && TW_BORDER.test(literal)) {
      violations.push({
        file,
        where: `${literal.slice(0, 80)}…`,
        detail: 'class string pairs a focus halo (ring/shadow-[0_0_0_…]) with a border utility',
      });
    }
  }

  return violations;
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

/** True if declarations draw an outer (non-inset) `0 0 0 N…` box-shadow halo. */
const declaresOuterHalo = (decls: string): boolean => {
  const shadowMatch = decls.match(/box-shadow\s*:([^;]*)/);

  if (shadowMatch === null) {
    return false;
  }

  return shadowMatch[1]
    .split(',')
    .some(segment => /^\s*0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+\d/.test(segment.trim()));
};

/** True if declarations set a visible border (not none/0/transparent). */
const declaresVisibleBorder = (decls: string): boolean => {
  const borders = decls.match(/(?:^|;|\s)border(?:-color|-top|-right|-bottom|-left)?\s*:[^;]*/g);

  if (borders === null) {
    return false;
  }

  return borders.some(decl => !/:\s*(?:0|none|transparent)\s*(?:;|$)/.test(decl));
};

const FOCUS_PSEUDO = /:focus(?:-within|-visible)?/;
const INPUT_CONTEXT = /:focus-within|input|textarea|aria-invalid|searchbox/i;

const findCssViolations = (file: string, source: string): Violation[] => {
  const rules = parseLeafRules(source);
  const violations: Violation[] = [];

  const stemOf = (selector: string): string =>
    selector.replace(/:focus(?:-within|-visible)?/g, '').trim();

  for (const rule of rules) {
    if (!FOCUS_PSEUDO.test(rule.selector) || !INPUT_CONTEXT.test(rule.selector)) {
      continue;
    }

    if (!declaresOuterHalo(rule.decls)) {
      continue;
    }

    const stem = stemOf(rule.selector);
    const borderInSameRule = declaresVisibleBorder(rule.decls);
    const borderInBaseRule = rules.some(
      other => other.selector === stem && declaresVisibleBorder(other.decls)
    );

    if (borderInSameRule || borderInBaseRule) {
      violations.push({
        file,
        where: rule.selector,
        detail: borderInSameRule
          ? 'focus rule draws an outer 0-0-0 halo while also setting a border'
          : `focus rule draws an outer 0-0-0 halo while base rule "${stem}" sets a border`,
      });
    }
  }

  return violations;
};

describe('Input Focus Double-Border Law', () => {
  it('no input pairs a border with an outer focus halo ring', () => {
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

    const report = violations
      .map(v => `- ${v.file} :: ${v.where}\n    ${v.detail}`)
      .join('\n');

    expect(
      violations,
      `Focused inputs must show ONE indicator — border OR halo, never both (renders as a double border):\n${report}\n`
    ).toEqual([]);
  });
});
