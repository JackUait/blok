/**
 * LAW: every Tailwind class name written in src/ and packages/ must actually
 * compile to CSS under the installed Tailwind.
 *
 * Why this exists: `eslint-plugin-tailwindcss`'s `no-unnecessary-arbitrary-value`
 * rule pushes authors from `leading-[1.4]` to a bare-number utility, but in
 * Tailwind 4 a bare number is a SPACING MULTIPLE (`calc(var(--spacing) * n)`)
 * and must sit on the 0.25 grid — so `leading-1.4` matches nothing and emits
 * ZERO CSS. The counter-rule `no-custom-classname` is configured at severity
 * `warn`, and `yarn lint` runs `eslint . --cache` with no `--max-warnings`, so
 * that warning could never fail the gate. That is exactly how a dead
 * `leading-1.4` shipped in the Node 26 / Angular 22 upgrade sweep.
 *
 * The eslint rule is also unreliable in both directions (it missed
 * `text-primary` and `font-inherit`, and false-positives on the hand-authored
 * `max-w-blok-content`). So this gate asks the real compiler instead:
 * `__unstable__loadDesignSystem(...).candidatesToCss([token])` returns `null`
 * when a candidate resolves to nothing. No build, no PostCSS, no dist.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { __unstable__loadDesignSystem } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');
const STYLES_ENTRY = resolve(REPO_ROOT, 'src/styles/main.css');

/**
 * Class names that are Tailwind-dead on purpose. Key = the token, value = the
 * reason. Seeded EMPTY on purpose: every entry is a hole in the law, so adding
 * one must be a deliberate, reviewed act with a written justification.
 */
const EXEMPTIONS: Record<string, string> = {};

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', 'build']);

function visit(entry: { name: string; isDirectory: () => boolean }, dir: string, pattern: RegExp, acc: string[]): void {
  if (SKIP_DIRS.has(entry.name)) return;

  const full = join(dir, entry.name);

  if (entry.isDirectory()) collect(full, pattern, acc);
  else if (pattern.test(entry.name)) acc.push(full);
}

function collect(dir: string, pattern: RegExp, acc: string[] = []): string[] {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) visit(entry, dir, pattern, acc);
  } catch {
    return acc;
  }

  return acc;
}

/**
 * Class names hand-authored in the repo's own CSS (`@layer utilities`,
 * `@utility`, plain selectors). Tailwind does not know them, but they are real
 * — this is what keeps `max-w-blok-content` (src/styles/colors.css) green.
 */
function collectDeclaredClassNames(): Set<string> {
  const declared = new Set<string>();
  const add = (source: string, pattern: RegExp): void => {
    for (const match of source.matchAll(pattern)) declared.add(match[1]);
  };

  for (const file of collect(resolve(REPO_ROOT, 'src'), /\.css$/)) {
    const source = readFileSync(file, 'utf-8');

    add(source, /\.(-?[A-Za-z_][\w-]*)/g);
    add(source, /@utility\s+([\w-]+)/g);
  }

  return declared;
}

const QUOTED = /(['"`])([^'"`\n]{3,400})\1/g;
/** Helpers whose string-literal arguments together form ONE class string. */
const TW_HELPERS = /\b(?:twMerge|twJoin|clsx|classNames|cn)\s*\(/g;
/** Conservative shape of a Tailwind candidate (variants, arbitrary values, opacity…). */
const CANDIDATE_SHAPE = /^[-a-zA-Z0-9_:./[\]()%#!*,&<>+~@?'"=|$;{}^-]+$/;

interface ClassStringSite {
  file: string;
  line: number;
  value: string;
}

/**
 * Blank out comments while preserving byte offsets (so reported line numbers
 * stay accurate). Prose in comments routinely backtick-quotes class fragments
 * (`` `h-*` ``, `` `height: auto` ``) which are not real class strings.
 * @param {string} source - file contents
 * @returns {string} source with comment bodies replaced by spaces
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (match, prefix: string) => prefix + ' '.repeat(match.length - prefix.length));
}

/**
 * Grab the balanced `(...)` body starting at `openIndex` (index of the `(`).
 * @param {string} source - file contents
 * @param {number} openIndex - index of the opening paren
 * @returns {string} the call body, or '' when unbalanced
 */
function readCallBody(source: string, openIndex: number): string {
  let depth = 0;

  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '(') depth++;
    if (source[i] !== ')') continue;
    depth--;
    if (depth === 0) return source.slice(openIndex + 1, i);
  }

  return '';
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * `twMerge('border-t', 'border-border-primary', …)` — each argument is a single
 * token, so only the JOINED string looks like a class string. Without this the
 * plain-literal heuristic misses whole call sites (it missed the divider's dead
 * `border-border-primary`).
 * @param {string} file - path being scanned
 * @param {string} source - comment-stripped contents
 * @returns {ClassStringSite[]} one site per helper call
 */
function collectHelperCalls(file: string, source: string): ClassStringSite[] {
  const sites: ClassStringSite[] = [];

  TW_HELPERS.lastIndex = 0;

  let call: RegExpExecArray | null = TW_HELPERS.exec(source);

  while (call !== null) {
    const openIndex = call.index + call[0].length - 1;
    const parts = [...readCallBody(source, openIndex).matchAll(QUOTED)].map((match) => match[2]);

    if (parts.length > 0) sites.push({ file, line: lineOf(source, openIndex), value: parts.join(' ') });
    call = TW_HELPERS.exec(source);
  }

  return sites;
}

/** Plain multi-token string literals, one site per literal. */
function collectPlainLiterals(file: string, source: string): ClassStringSite[] {
  return source.split('\n').flatMap((text, index) =>
    [...text.matchAll(QUOTED)]
      .map((match) => match[2])
      .filter((value) => !/[<>{}=;]/.test(value))
      .map((value) => ({ file, line: index + 1, value }))
  );
}

function collectClassStrings(): ClassStringSite[] {
  const roots = [resolve(REPO_ROOT, 'src'), resolve(REPO_ROOT, 'packages')];

  return roots
    .flatMap((root) => collect(root, /\.(ts|tsx|mjs|html)$/))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file))
    .flatMap((file) => {
      const source = stripComments(readFileSync(file, 'utf-8'));

      return [...collectHelperCalls(file, source), ...collectPlainLiterals(file, source)];
    });
}

/**
 * Tokens of `site` that resolve to no CSS — but only when the site is
 * *confidently* a class string (>=2 tokens resolve AND >=60% of them do). That
 * filter is what keeps TS identifiers, i18n keys and prose out of the gate.
 * @param {ClassStringSite} site - candidate class string
 * @param {(token: string) => boolean} emits - compiler oracle
 * @param {Set<string>} declared - hand-authored CSS class names
 * @returns {string[]} dead tokens
 */
function deadTokensOf(site: ClassStringSite, emits: (token: string) => boolean, declared: Set<string>): string[] {
  const tokens = site.value.trim().split(/\s+/).filter(Boolean);

  if (tokens.length < 2 || !tokens.every((token) => CANDIDATE_SHAPE.test(token))) return [];

  const living = tokens.filter(emits);

  if (living.length < 2 || living.length / tokens.length < 0.6) return [];

  return tokens.filter((token) => {
    const bare = token.replace(/^.*:/, '').replace(/^-/, '').replace(/\/.*$/, '');

    if (emits(token) || token in EXEMPTIONS) return false;
    if (declared.has(token) || declared.has(bare)) return false;

    // Must at least look like a utility (lowercase, hyphenated or variant-prefixed).
    return /^-?[a-z]/.test(token) && (token.includes('-') || token.includes(':'));
  });
}

async function loadOracle(): Promise<(token: string) => boolean> {
  // `@tailwindcss/node` destructures only `{ base }` — no `onDependency` hook exists here.
  const design = await __unstable__loadDesignSystem(readFileSync(STYLES_ENTRY, 'utf-8'), {
    base: dirname(STYLES_ENTRY),
  });
  const cache = new Map<string, boolean>();

  return (token: string): boolean => {
    const cached = cache.get(token);

    if (cached !== undefined) return cached;

    let result = false;

    try {
      result = design.candidatesToCss([token])[0] !== null;
    } catch {
      result = false;
    }
    cache.set(token, result);

    return result;
  };
}

describe('Tailwind class emits law', () => {
  it('every class name used in src/ and packages/ compiles to CSS', async () => {
    const emits = await loadOracle();
    const declared = collectDeclaredClassNames();
    const dead = new Map<string, Set<string>>();

    for (const site of collectClassStrings()) {
      const where = `${relative(REPO_ROOT, site.file)}:${site.line}`;

      for (const token of deadTokensOf(site, emits, declared)) {
        dead.set(token, (dead.get(token) ?? new Set()).add(where));
      }
    }

    const report = [...dead.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([token, where]) => `  ${token}  →  ${[...where].slice(0, 5).join(', ')}`)
      .join('\n');

    expect(
      report,
      `These class names emit ZERO CSS under the installed Tailwind:\n${report}\n` +
        'Use the arbitrary form (e.g. `leading-[1.4]`) or a real theme token. ' +
        'Bare-number utilities are spacing multiples on a 0.25 grid, not raw values — ' +
        'do NOT trust the tailwindcss/no-unnecessary-arbitrary-value autofix here.'
    ).toBe('');
  });

  it('the compiler oracle really can tell a dead class from a live one', async () => {
    const emits = await loadOracle();

    // Mutation guard: if these ever flip, the gate above is vacuous.
    expect(emits('leading-1.4')).toBe(false);
    expect(emits('leading-[1.4]')).toBe(true);
    expect(emits('border-border-primary')).toBe(false);
    expect(emits('border-(--blok-border-primary)')).toBe(true);
  });
});
