/**
 * Architectural enforcement: the Radius Law
 * (docs/plans/2026-09-30-radius-design-system.md).
 *
 * Every corner radius in src/ comes from a radius ROLE token, from the nesting
 * channel a rounded container publishes (--blok-radius-inner) or from the
 * frame channel core writes for the selection fill (--blok-radius-frame).
 * Primitives (--blok-radius-2 … -16) are for colors.css and the Tailwind
 * re-pin only, so a component can never drift off its role.
 *
 * Scans tracked files only: untracked build scratch (server runtime bundles)
 * is not source.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../..');

const tracked = (...globs: string[]): string[] => execFileSync('git', ['ls-files', '--', ...globs], { cwd: REPO_ROOT, encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.length > 0);

/** Files where the scale itself lives. */
const SCALE_FILES = new Set(['src/styles/colors.css', 'src/styles/isolation.css']);

interface Exemption {
  file: string;
  reason: string;
}

/** Every entry says why the file may break the law. */
const EXEMPT_FILES: Exemption[] = [
  { file: 'src/components/utils/logger.ts', reason: 'dev console badge styling, never rendered in the editor' },
  { file: 'src/tools/database/database-view.ts', reason: 'not rendered by the product; only unit tests import it' },
  { file: 'src/playground/radius-gallery.ts', reason: 'the rounding page draws any radius and every primitive to explain the rule' },
  { file: 'src/playground/page-tree.css', reason: 'playground chrome outside every Blok root, where the radius roles are not defined and resolve to 0' },
];

const exempt = new Set(EXEMPT_FILES.map((e) => e.file));

const isStory = (file: string): boolean => file.startsWith('src/stories/') || file.includes('.stories.');

const CSS_FILES = tracked('src/**/*.css').filter((f) => !SCALE_FILES.has(f) && !exempt.has(f));
const TS_FILES = tracked('src/**/*.ts').filter((f) => !exempt.has(f) && !isStory(f));

const blank = (m: string): string => m.replace(/[^\n]/g, ' ');

const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)));

const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length;

const OLD_TOKENS = /--blok-radius-(?:xs|sm|md|lg|xl|md-plus|hairline|none)\b/;
const PRIMITIVE = /--blok-radius-(?:\d+|full)\b/;
const RADIUS_DECL = /(?<![-\w])border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius\s*:\s*([^;}]+)/g;

/**
 * A radius value built only from role/channel vars, 0, 50%, inherit or revert.
 * `channels` are component radius variables (e.g. --blok-image-island-merged-radius)
 * whose own declarations are lawful; referencing one counts as a radius var.
 */
const isLawfulRadius = (value: string, channels: ReadonlySet<string> = new Set()): boolean => {
  const v = value
    .replace(/!important/, '')
    .trim()
    .replace(/var\((--[\w-]+)/g, (m, name: string) => (channels.has(name) ? 'var(--blok-radius-channel' : m));

  // Arithmetic is only lawful around a radius var (e.g. frame + gap).
  const arithmeticIsAroundRadius = !/\b(?:calc|max|min)\(/.test(v) || /var\(--blok-radius-/.test(v);
  const rest = v
    .replace(/var\(--[\w-]+(?:\s*,\s*var\(--[\w-]+\))?\s*\)/g, '')
    .replace(/\b(?:calc|max|min)\(/g, '')
    .replace(/(?<![\w.])(?:0|50%|inherit|revert|initial)(?![\w.%])/g, '')
    .replace(/[\s()+\-*/,]/g, '');

  return !PRIMITIVE.test(v) && !OLD_TOKENS.test(v) && arithmeticIsAroundRadius
    && rest === '' && (/var\(--blok-radius-/.test(v) || /^(?:0|50%|inherit|revert|initial)(?:\s+(?:0|50%))*$/.test(v));
};

// A Tailwind class that bypasses the roles: a step, bare `rounded` or an arbitrary value.
const UNLAWFUL_CLASS = /^(?:[\w-]+:)*rounded(?:-[trblse]{1,2})?(?:-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)|-\[[^\]]*\])?!?$/;

/** Class-like tokens: every whitespace-separated word inside a TS string literal or an @apply line. */
const classTokens = (file: string, source: string): { token: string; index: number }[] => {
  const containers = file.endsWith('.css')
    ? [...source.matchAll(/@apply\s+([^;]+);/g)].map((m) => ({ text: m[1], index: (m.index ?? 0) + m[0].indexOf(m[1]) }))
    : [...source.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => ({ text: m[2], index: (m.index ?? 0) + 1 }));

  return containers.flatMap(({ text, index }) => [...text.matchAll(/\S+/g)].map((t) => ({ token: t[0], index: index + (t.index ?? 0) })));
};

interface Violation {
  file: string;
  line: number;
  text: string;
}

const scan = (files: string[], pattern: RegExp, pick: (match: RegExpMatchArray) => boolean = () => true): Violation[] => files.flatMap((file) => {
  const source = stripComments(readFileSync(resolve(REPO_ROOT, file), 'utf8'));

  return [...source.matchAll(pattern)]
    .filter(pick)
    .map((m) => ({ file, line: lineOf(source, m.index ?? 0), text: m[0].trim() }));
});

/** Component radius variables: a --blok-*radius* name declared in CSS with a lawful value. */
const collectChannels = (): Set<string> => {
  const declarations = CSS_FILES.flatMap((file) => [
    ...stripComments(readFileSync(resolve(REPO_ROOT, file), 'utf8')).matchAll(/(--blok-[\w-]*radius[\w-]*)\s*:\s*([^;}]+)/g),
  ]);

  return new Set(declarations.filter((m) => isLawfulRadius(m[2])).map((m) => m[1]));
};

const CHANNELS = collectChannels();

const report = (violations: Violation[]): string => violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join('\n');

describe('Radius law', () => {
  it('CSS border-radius values use a role or a nesting channel, never a literal or a spacing token', () => {
    const violations = scan(CSS_FILES, RADIUS_DECL, (m) => !isLawfulRadius(m[1], CHANNELS));

    expect(violations, `Unlawful radii:\n${report(violations)}`).toEqual([]);
  });

  it('component radius variables hold lawful values', () => {
    const violations = scan(CSS_FILES, /(--blok-[\w-]*radius[\w-]*)\s*:\s*([^;}]+)/g, (m) => !isLawfulRadius(m[2], CHANNELS));

    expect(violations, `Unlawful radius variables:\n${report(violations)}`).toEqual([]);
  });

  it('TS arbitrary-property classes that set a radius variable hold lawful values', () => {
    const violations = TS_FILES.flatMap((file) => {
      const source = stripComments(readFileSync(resolve(REPO_ROOT, file), 'utf8'));

      return classTokens(file, source)
        .map(({ token, index }) => ({ match: token.match(/^\[(--blok-[\w-]*radius[\w-]*):(.+)\]$/), index }))
        .filter(({ match }) => match !== null && !isLawfulRadius((match?.[2] ?? '').replace(/_/g, ' '), CHANNELS))
        .map(({ match, index }) => ({ file, line: lineOf(source, index), text: match?.[0] ?? '' }));
    });

    expect(violations, `Unlawful radius variables in classes:\n${report(violations)}`).toEqual([]);
  });

  it('TS sets no literal borderRadius', () => {
    const violations = scan(TS_FILES, /borderRadius\s*[:=]\s*(['"`])((?:(?!\1).)*)\1/g, (m) => !isLawfulRadius(m[2]));

    expect(violations, `Literal borderRadius:\n${report(violations)}`).toEqual([]);
  });

  it('no Tailwind radius step, bare rounded or arbitrary rounded-[…] class in TS or @apply', () => {
    const violations = [...TS_FILES, ...CSS_FILES].flatMap((file) => {
      const source = stripComments(readFileSync(resolve(REPO_ROOT, file), 'utf8'));

      return classTokens(file, source)
        .filter(({ token }) => UNLAWFUL_CLASS.test(token))
        .map(({ token, index }) => ({ file, line: lineOf(source, index), text: token }));
    });

    expect(violations, `Use rounded-(--blok-radius-<role>) instead:\n${report(violations)}`).toEqual([]);
  });

  it('the removed radius names are referenced nowhere in src', () => {
    const violations = scan([...tracked('src/**/*.css', 'src/**/*.ts')], new RegExp(OLD_TOKENS.source, 'g'));

    expect(violations, report(violations)).toEqual([]);
  });

  it('primitives are referenced only by the scale files', () => {
    const violations = scan([...CSS_FILES, ...TS_FILES], new RegExp(`(?:var\\(|\\()${PRIMITIVE.source}`, 'g'));

    expect(violations, report(violations)).toEqual([]);
  });

  it('a container never derives --blok-radius-inner from itself (a cycle resolves to 0)', () => {
    const violations = scan(CSS_FILES, /--blok-radius-inner\s*:\s*([^;}]+)/g, (m) => m[1].includes('--blok-radius-inner'));

    expect(violations, report(violations)).toEqual([]);
  });

  it('every exemption names a tracked file and a reason', () => {
    const all = tracked('src/**');

    for (const e of EXEMPT_FILES) {
      expect(all, e.file).toContain(e.file);
      expect(e.reason.length, e.file).toBeGreaterThan(10);
    }
  });
});

describe('isLawfulRadius', () => {
  it.each([
    'var(--blok-radius-surface)',
    'var(--blok-radius-inner, var(--blok-radius-control))',
    'calc(var(--blok-radius-frame) + var(--blok-space-0-5))',
    '0',
    '50%',
    'inherit',
    'var(--blok-radius-control) var(--blok-radius-control) 0 0',
  ])('accepts %s', (value) => {
    expect(isLawfulRadius(value)).toBe(true);
  });

  it.each([
    '6px',
    'var(--blok-space-2)',
    'var(--blok-radius-md)',
    'var(--blok-radius-6)',
    'var(--radius-xl)',
    'calc(var(--blok-space-2) + 1px)',
    '9999px',
    'var(--blok-image-island-merged-radius)',
  ])('rejects %s', (value) => {
    expect(isLawfulRadius(value)).toBe(false);
  });

  it('accepts a declared component channel', () => {
    expect(isLawfulRadius('var(--blok-x-radius)', new Set(['--blok-x-radius']))).toBe(true);
  });
});
