import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

// Latin is left out: native affixes on Latin terms are normal ("ለAI", "وEnter").
// Kana and kanji count as one script, since Japanese words mix them.
const NON_LATIN_SCRIPTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Ethiopic', /\p{Script=Ethiopic}/u],
  ['Thaana', /\p{Script=Thaana}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Bengali', /\p{Script=Bengali}/u],
  ['Gujarati', /\p{Script=Gujarati}/u],
  ['Gurmukhi', /\p{Script=Gurmukhi}/u],
  ['Tamil', /\p{Script=Tamil}/u],
  ['Telugu', /\p{Script=Telugu}/u],
  ['Kannada', /\p{Script=Kannada}/u],
  ['Malayalam', /\p{Script=Malayalam}/u],
  ['Sinhala', /\p{Script=Sinhala}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Khmer', /\p{Script=Khmer}/u],
  ['Lao', /\p{Script=Lao}/u],
  ['Myanmar', /\p{Script=Myanmar}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['CJK', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u],
];

const scriptOf = (character: string): string | undefined =>
  NON_LATIN_SCRIPTS.find(([, pattern]) => pattern.test(character))?.[0];

const findMixedScriptWords = (value: string): string[] =>
  (value.match(/\p{L}+/gu) ?? []).filter(word => {
    const scripts = new Set([...word].map(scriptOf).filter(script => script !== undefined));

    return scripts.size > 1;
  });

const localeCodes = readdirSync(LOCALES_DIR)
  .filter(name => name.endsWith('.json'))
  .map(name => name.replace(/\.json$/u, ''));

describe('locale words use one non-Latin script each', () => {
  it('flags a word that mixes look-alike letters from two scripts', () => {
    expect(findMixedScriptWords('ساندانни كۆرۈش')).toEqual(['ساندانни']);
    expect(findMixedScriptWords('ساندانني كۆرۈش')).toEqual([]);
  });

  it.each(localeCodes)('%s', locale => {
    const messages = JSON.parse(
      readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')
    ) as Record<string, string>;
    const mixed = Object.entries(messages).flatMap(([key, value]) =>
      findMixedScriptWords(value).map(word => `${key}: ${word}`)
    );

    expect(mixed).toEqual([]);
  });
});
