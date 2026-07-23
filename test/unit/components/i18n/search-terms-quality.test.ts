/**
 * Translation quality tests for searchTerms.* i18n entries.
 *
 * These tests enforce three rules:
 *   1. Within each tool's searchTermKeys group, no two keys may resolve to the
 *      same translated value (duplicates waste search-alias slots).
 *   2. All searchTerms values must use the locale's correct script.
 *   3. No known mistranslations or guideline violations remain.
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

function getLocaleCodes(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => name.slice(0, -'.json'.length))
    .sort();
}

function loadMessages(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf-8')) as Record<string, string>;
}

/** Find duplicate values within a group of searchTerms keys */
function findGroupDuplicates(
  messages: Record<string, string>,
  groupName: string,
  keys: string[]
): string[] {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];

  for (const key of keys) {
    const value = messages[`searchTerms.${key}`];

    if (!value) continue;
    const normalized = value.toLowerCase().trim();
    const existing = seen.get(normalized);

    if (existing) {
      duplicates.push(`[${groupName}] searchTerms.${existing} = searchTerms.${key} = "${value}"`);
    } else {
      seen.set(normalized, key);
    }
  }

  return duplicates;
}

// ---------------------------------------------------------------------------
// Tool-level searchTermKeys groups — values within each MUST be unique
// ---------------------------------------------------------------------------

const TOOL_GROUPS: Record<string, string[]> = {
  divider: ['divider', 'separator', 'delimiter', 'splitter'],
  heading: ['title', 'header', 'heading'],
  toggleHeading: ['toggle', 'heading', 'collapsible'],
  bulletedList: ['bullet', 'unordered', 'list'],
  numberedList: ['ordered', 'number'],
  todoList: ['checkbox', 'task', 'todo', 'check'],
  toggleList: ['toggle', 'collapse', 'expand', 'accordion'],
  table: ['table', 'grid', 'spreadsheet'],
  callout: ['callout', 'note', 'info', 'warning', 'tip', 'alert'],
  quote: ['quote', 'blockquote', 'citation'],
};

// ---------------------------------------------------------------------------
// Known-bad values: { locale: { key: badValue } }
// If the locale still has this exact value, the test fails.
// ---------------------------------------------------------------------------

const KNOWN_BAD_VALUES: Record<string, Record<string, string>> = {
  // Critical: wrong script (Latin Kurmanci instead of Sorani Arabic)
  ku: {
    'searchTerms.divider': 'dabeşker',
    'searchTerms.separator': 'veqetandî',
    'searchTerms.delimiter': 'sînordar',
    'searchTerms.splitter': 'parçeker',
    'searchTerms.plain': 'ساکار',
    'searchTerms.checkbox': 'چاوبەندک',
  },
  // Critical: mistranslations
  dv: { 'searchTerms.tip': 'ކުރުގޮތް' },           // "shortcut" not "tip"
  lo: { 'searchTerms.paragraph': 'ຫຍໍ້ໜ້າ' },       // "indent" not "paragraph"
  mr: { 'searchTerms.toggle': 'संकुचित' },           // "collapsed" not "toggle"
  mk: { 'searchTerms.check': 'штиклирање' },        // slang

  // High-priority: invented word / semantic errors
  fr: { 'searchTerms.splitter': 'scindeur' },        // not a real French word
  it: {
    'searchTerms.accordion': 'fisarmonica',           // musical instrument
    'searchTerms.alert': 'avviso urgente',            // overlaps warning
  },
  zh: {
    'searchTerms.header': '页眉',                     // "page header" (Word)
    'searchTerms.accordion': '手风琴',                 // musical instrument
  },
  vi: { 'searchTerms.header': 'đầu trang' },         // "page header"
  km: { 'searchTerms.header': 'បឋមកថា' },            // "foreword"
  cs: { 'searchTerms.title': 'titul' },              // academic title
  sk: { 'searchTerms.title': 'titul' },              // academic title
  pl: { 'searchTerms.alert': 'alert' },              // untranslated English
  bg: { 'searchTerms.header': 'горен колонтитул' },  // MS Word jargon
};

// ---------------------------------------------------------------------------
// Script validation — non-Latin locales must use their native script
// ---------------------------------------------------------------------------

/**
 * Locales that use non-Latin scripts.
 * Each search term must contain at least one character from the locale's
 * expected script unless it is an explicitly accepted technical loanword.
 */
const EXPECTED_SEARCH_SCRIPTS: Readonly<Record<string, RegExp>> = {
  ar: /\p{Script=Arabic}/u,
  fa: /\p{Script=Arabic}/u,
  ku: /\p{Script=Arabic}/u,
  ps: /\p{Script=Arabic}/u,
  sd: /\p{Script=Arabic}/u,
  ug: /\p{Script=Arabic}/u,
  ur: /\p{Script=Arabic}/u,
  dv: /\p{Script=Thaana}/u,
  he: /\p{Script=Hebrew}/u,
  yi: /\p{Script=Hebrew}/u,
  bg: /\p{Script=Cyrillic}/u,
  mk: /\p{Script=Cyrillic}/u,
  mn: /\p{Script=Cyrillic}/u,
  ru: /\p{Script=Cyrillic}/u,
  sr: /\p{Script=Cyrillic}/u,
  uk: /\p{Script=Cyrillic}/u,
  el: /\p{Script=Greek}/u,
  hy: /\p{Script=Armenian}/u,
  ka: /\p{Script=Georgian}/u,
  am: /\p{Script=Ethiopic}/u,
  hi: /\p{Script=Devanagari}/u,
  mr: /\p{Script=Devanagari}/u,
  ne: /\p{Script=Devanagari}/u,
  bn: /\p{Script=Bengali}/u,
  gu: /\p{Script=Gujarati}/u,
  pa: /\p{Script=Gurmukhi}/u,
  ta: /\p{Script=Tamil}/u,
  te: /\p{Script=Telugu}/u,
  kn: /\p{Script=Kannada}/u,
  ml: /\p{Script=Malayalam}/u,
  si: /\p{Script=Sinhala}/u,
  th: /\p{Script=Thai}/u,
  km: /\p{Script=Khmer}/u,
  lo: /\p{Script=Lao}/u,
  my: /\p{Script=Myanmar}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  ko: /\p{Script=Hangul}/u,
  zh: /\p{Script=Han}/u,
  'zh-TW': /\p{Script=Han}/u,
};

/**
 * Accepted ASCII loanwords that are standard UI terms even in non-Latin locales.
 * These get a pass on the "must use native script" rule.
 */
const ACCEPTED_ASCII_LOANWORDS = new Set(['info', 'ok', 'pre']);
const LETTER = /\p{Letter}/u;
const COMMON_OR_INHERITED_SCRIPT =
  /[\p{Script=Common}\p{Script=Inherited}]/u;

function findNativeScriptViolations(
  messages: Record<string, string>,
  locale: string
): string[] {
  const expectedScript = EXPECTED_SEARCH_SCRIPTS[locale];

  if (!expectedScript) {
    return [];
  }

  const violations: string[] = [];

  for (const [key, value] of Object.entries(messages)) {
    if (!key.startsWith('searchTerms.')) continue;
    if (ACCEPTED_ASCII_LOANWORDS.has(value.toLowerCase().trim())) continue;
    const usesExpectedScript = expectedScript.test(value);
    const containsForeignScriptLetter = [...value].some(
      character =>
        LETTER.test(character) &&
        !expectedScript.test(character) &&
        !COMMON_OR_INHERITED_SCRIPT.test(character)
    );

    if (!usesExpectedScript || containsForeignScriptLetter) {
      violations.push(`${key} = "${value}"`);
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchTerms translation quality', () => {
  const locales = getLocaleCodes();
  const nonLatinLocales = locales.filter(
    locale => locale in EXPECTED_SEARCH_SCRIPTS
  );

  // 1. No duplicate values within any tool's searchTermKeys group
  describe('no duplicate values within tool searchTermKeys groups', () => {
    for (const locale of locales) {
      if (locale === 'en') continue;

      test(`${locale}`, () => {
        const messages = loadMessages(locale);
        const duplicates = Object.entries(TOOL_GROUPS).flatMap(
          ([groupName, keys]) => findGroupDuplicates(messages, groupName, keys)
        );

        expect(
          duplicates,
          `${locale}: duplicate searchTerms within tool groups:\n  ${duplicates.join('\n  ')}`
        ).toHaveLength(0);
      });
    }
  });

  // 2. Known bad values must not be present
  describe('no known mistranslations', () => {
    for (const [locale, badEntries] of Object.entries(KNOWN_BAD_VALUES)) {
      for (const [key, badValue] of Object.entries(badEntries)) {
        test(`${locale}: ${key} is not "${badValue}"`, () => {
          const messages = loadMessages(locale);

          expect(messages[key], `${locale} ${key} still contains the known-bad value`).not.toBe(badValue);
        });
      }
    }
  });

  // 3. Non-Latin locales should use their expected native script
  describe('non-Latin locales use native script', () => {
    test('rejects Latin transliteration even when it contains diacritics', () => {
      expect(
        findNativeScriptViolations(
          { 'searchTerms.divider': 'dabeşker' },
          'ku'
        )
      ).toEqual(['searchTerms.divider = "dabeşker"']);
    });

    test('rejects mixed native-script and foreign-script letters', () => {
      expect(
        findNativeScriptViolations(
          { 'searchTerms.divider': 'دابەشکەر test' },
          'ku'
        )
      ).toEqual(['searchTerms.divider = "دابەشکەر test"']);
    });

    for (const locale of nonLatinLocales) {
      test(`${locale}`, () => {
        const messages = loadMessages(locale);
        const scriptViolations = findNativeScriptViolations(messages, locale);

        expect(
          scriptViolations,
          `${locale}: searchTerms outside the locale's native script:\n  ${scriptViolations.join('\n  ')}`
        ).toHaveLength(0);
      });
    }
  });
});
