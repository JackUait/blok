import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGE_COUNT } from './Features';

/**
 * Every "N locales" claim on the site must be the editor's real count.
 *
 * The number is stated in prose in several places — the language tile, the
 * comparison table, the codemod copy — in two languages, and none of them is
 * derived from the editor. Deriving it at build time would mean the docs app
 * reaching into the editor's source tree, which buys nothing this test does
 * not: the count changes a couple of times a year, and the fix is to edit a few
 * strings. What matters is that shipping a locale cannot leave a stale number
 * behind, in either catalogue.
 *
 * Checked against the corpus rather than a constant, so the test has no number
 * of its own to go stale.
 */
const DOCS = process.cwd();
const LOCALE_DIR = resolve(DOCS, '..', 'src', 'components', 'i18n', 'locales');
const shippedLocales = readdirSync(LOCALE_DIR).filter((file) => file.endsWith('.json')).length;

/** "69 locales", "69 локалей", "(69 locales)" — any count applied to a locale noun. */
const CLAIM = /(\d+)\s*(locales|локал[а-яё]*)/gi;

/**
 * "the other 68 locales" counts the corpus minus the bundled English one, so it
 * is one less than the total and still has to move when a locale is added.
 */
// No `\b`: JS word boundaries are ASCII-only, so `\bостальны` never matches.
const EXCLUDES_BUNDLED = /(\bother|остальны)/i;

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|json)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });

const claims = sourceFiles(join(DOCS, 'src')).flatMap((file) => {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(CLAIM)].map((match) => {
    const lead = source.slice(Math.max(0, match.index - 24), match.index);
    return {
      file: relative(DOCS, file),
      count: Number(match[1]),
      text: match[0],
      expected: EXCLUDES_BUNDLED.test(lead) ? shippedLocales - 1 : shippedLocales,
    };
  });
});

describe('locale count', () => {
  it('counts a real locale corpus', () => {
    expect(shippedLocales).toBeGreaterThan(50);
  });

  it('finds the claims it is meant to police', () => {
    expect(claims.length).toBeGreaterThan(0);
  });

  it('states the editor\'s real locale count everywhere it is claimed', () => {
    const stale = claims
      .filter((claim) => claim.count !== claim.expected)
      .map((claim) => `${claim.file}: "${claim.text}" should be ${claim.expected}`);

    expect(stale, `stale locale counts: ${stale.join(' | ')}`).toEqual([]);
  });

  it('rolls a greeting through every locale the editor ships', () => {
    expect(LANGUAGE_COUNT).toBe(shippedLocales);
  });
});
