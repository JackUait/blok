/**
 * The keyboard/mouse switch must not restyle the whole page.
 *
 * input-modality.ts flips `data-blok-modality` on <html> on every key and
 * pointer gesture. Chrome then restyles only the elements its invalidation
 * sets name. Two selector shapes make that set "every element" (measured on a
 * 100×30 table: ~300ms per switch, against ~0.4ms for a good rule):
 *
 * - The attribute inside `:is()`/`:where()` on the subject itself, as in
 *   `.x:focus-visible:where(:root:not([data-blok-modality=pointer]) *)`. Write
 *   `:where(:root:not([data-blok-modality=pointer])) .x:focus-visible` instead.
 *   Tailwind's `group-*` and `peer-*` wrap the variant in `:is(... *)`, so they
 *   always hit this.
 * - A subject with no class, id, tag or attribute, as in a bare
 *   `:focus-visible`.
 *
 * One such rule anywhere is enough, so every sheet and every compiled class is
 * checked.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { __unstable__loadDesignSystem } from '@tailwindcss/node';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const STYLES_ENTRY = join(SRC_ROOT, 'styles/main.css');
const GATE = 'data-blok-modality';
const CLASS_FILE = /\.(ts|tsx|vue|html)$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);

    return statSync(path).isDirectory() ? walk(path) : [ path ];
  });

/** Splits at `separator` outside (), [] and escapes. */
const splitTopLevel = (selector: string, isSeparator: (char: string) => boolean): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];

    if (char === '\\') {
      i++;
    } else if (char === '(' || char === '[') {
      depth++;
    } else if (char === ')' || char === ']') {
      depth--;
    } else if (depth === 0 && isSeparator(char)) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }

  return [ ...parts, selector.slice(start) ];
};

const listItems = (selector: string): string[] => splitTopLevel(selector, char => char === ',').map(part => part.trim());

const subjectOf = (complex: string): string => {
  const compounds = splitTopLevel(complex.trim(), char => /[\s>+~]/.test(char)).filter(part => part !== '');

  return compounds[compounds.length - 1] ?? '';
};

/** Removes `:name(...)` groups, keeping the rest of the compound. */
const dropFunctional = (compound: string, names: RegExp): string => {
  const match = names.exec(compound);

  if (match === null) {
    return compound;
  }
  let depth = 0;
  let end = match.index + match[0].length - 1;

  for (; end < compound.length; end++) {
    if (compound[end] === '\\') {
      end++;
    } else if (compound[end] === '(') {
      depth++;
    } else if (compound[end] === ')' && --depth === 0) {
      break;
    }
  }

  return dropFunctional(compound.slice(0, match.index) + compound.slice(end + 1), names);
};

/** Whether Chrome can build a class/id/tag/attribute invalidation set for the compound. */
const hasFeature = (compound: string): boolean => {
  const own = dropFunctional(compound, /:(?:not|has)\(/);
  const outer = dropFunctional(own, /::?[\w-]+\(/);

  const ownFeature = /^[a-zA-Z]/.test(outer) || /(?:^|[^\\])[.#[]/.test(outer);
  const lists = [ ...own.matchAll(/:(?:is|where)\(/g) ];

  return ownFeature || lists.some(({ index }) => {
    const inner = own.slice(index).replace(/^:(?:is|where)\(/, '');
    const body = splitTopLevel(inner, char => char === ')')[0];

    return listItems(body).every(item => hasFeature(subjectOf(item)));
  });
};

/** Why a selector would restyle the whole page on a modality switch, or null. */
const whyWholePage = (complex: string): string | null => {
  if (!complex.includes(GATE)) {
    return null;
  }
  const subject = subjectOf(complex);

  if (subject.includes(GATE)) {
    return 'gate inside the subject';
  }

  return hasFeature(subject) ? null : 'featureless subject';
};

const offendersIn = (css: string, label: string): string[] => {
  const found: string[] = [];

  postcss.parse(css).walkRules((rule) => {
    for (const item of listItems(rule.selector)) {
      const why = whyWholePage(item);

      if (why !== null) {
        found.push(`${label}: ${why}: ${item}`);
      }
    }
  });

  return found;
};

const loadCompiler = async (): Promise<(candidates: string[]) => string[]> => {
  const design = await __unstable__loadDesignSystem(readFileSync(STYLES_ENTRY, 'utf-8'), { base: dirname(STYLES_ENTRY) });

  return candidates => design.candidatesToCss(candidates).filter((css): css is string => css !== null);
};

describe('modality gate invalidation law', () => {
  it('tells a whole-page selector from a cheap one', () => {
    const gate = `:root:not([${GATE}="pointer"])`;

    expect(whyWholePage(`.x:focus-visible:where(${gate} *)`)).toBe('gate inside the subject');
    expect(whyWholePage(`.x:is(:where(${gate}) :where(.group):focus-visible *)`)).toBe('gate inside the subject');
    expect(whyWholePage(`:root[${GATE}="pointer"] [data-blok-interface] :focus-visible:not(:is(input, textarea))`)).toBe('featureless subject');
    expect(whyWholePage(`:root[${GATE}="pointer"] [data-blok-interface] :is(:focus, *):focus-visible`)).toBe('featureless subject');
    expect(whyWholePage(`:where(${gate}) .x:focus-visible`)).toBeNull();
    expect(whyWholePage(`:where(${gate}) .focus-visible\\:\\[\\&\\>span\\]:focus-visible > .y`)).toBeNull();
    expect(whyWholePage(`:root[${GATE}="pointer"] [data-blok-interface] :is(a, button, [tabindex]):focus-visible:not(:is(input, textarea))`)).toBeNull();
    expect(whyWholePage(`:root:not([${GATE}="pointer"]) [data-blok-keyboard-navigated] [data-blok-popover-item][data-blok-focused='true']`)).toBeNull();
    expect(whyWholePage('.x:focus-visible')).toBeNull();
  });

  it('keeps every source sheet off the whole page', () => {
    const offenders = walk(SRC_ROOT)
      .filter(file => file.endsWith('.css'))
      .flatMap(file => offendersIn(readFileSync(file, 'utf-8'), relative(REPO_ROOT, file)));

    expect(offenders).toEqual([]);
  });

  it('keeps every compiled focus-visible class off the whole page', async () => {
    const candidates = new Set(walk(SRC_ROOT)
      .filter(file => CLASS_FILE.test(file) && !TEST_FILE.test(file))
      .flatMap(file => [ ...readFileSync(file, 'utf-8').matchAll(/[^\s'"`]*focus-visible(?:\/[\w-]+)?:[^\s'"`]*/g) ].map(([ token ]) => token)));
    const compile = await loadCompiler();
    const compiled = compile([ ...candidates ]);

    // The harvest must reach Tailwind's output, or this case checks nothing.
    expect(compiled.some(css => css.includes(GATE))).toBe(true);
    expect(compiled.flatMap(css => offendersIn(css, 'tailwind'))).toEqual([]);
  });
});
