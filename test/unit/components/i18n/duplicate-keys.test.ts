/**
 * Regression test: locale `messages.json` files must not contain duplicate
 * JSON keys.
 *
 * `JSON.parse` silently keeps the last occurrence of a repeated key, so a
 * duplicated entry is invisible to completeness/value checks yet still ships an
 * invalid, lossy file. Every translation locale historically carried a
 * duplicated `tools.file.previewOpenInNewTab` line (lines 386-387); this test
 * scans the raw text so any future duplication fails loudly.
 *
 * Written red-first: it FAILS until every duplicate key is removed.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const LOCALES_DIR = resolve(REPO_ROOT, 'src/components/i18n/locales');

const listLocaleCodes = (): string[] =>
  readdirSync(LOCALES_DIR)
    .filter(name => {
      try {
        return statSync(join(LOCALES_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

/**
 * Collect top-level keys that appear more than once in the raw JSON text.
 * Locale files are flat string maps, so a line-oriented scan for `"key":`
 * is sufficient and avoids depending on a JSON parser that would discard
 * the duplicates.
 */
const findDuplicateKeys = (raw: string): string[] => {
  const counts = new Map<string, number>();
  const keyMatcher = /^\s*"((?:\\.|[^"\\])+)"\s*:/;

  for (const line of raw.split('\n')) {
    const match = line.match(keyMatcher);
    if (!match) continue;
    const key = match[1];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key);
};

describe('locale files have no duplicate JSON keys', () => {
  it.each(listLocaleCodes())('%s has every key exactly once', locale => {
    const raw = readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf-8');
    const duplicates = findDuplicateKeys(raw);

    expect(
      duplicates,
      `${locale} has duplicate key(s): ${duplicates.join(', ')}`
    ).toEqual([]);
  });
});
