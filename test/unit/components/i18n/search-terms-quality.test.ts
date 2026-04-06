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
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

function getLocaleDirs(): string[] {
  return readdirSync(LOCALES_DIR)
    .filter(f => {
      try {
        return statSync(join(LOCALES_DIR, f)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function loadMessages(locale: string): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf-8')) as Record<string, string>;
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

/** Returns true if the string contains ONLY ASCII letters (a-z, A-Z) and common punctuation */
function isAsciiOnly(s: string): boolean {
  return /^[a-zA-Z\s\-'.]+$/.test(s);
}

/**
 * Locales that use non-Latin scripts.
 * If a searchTerms value is pure ASCII in one of these, it is likely untranslated.
 */
const NON_LATIN_LOCALES = new Set([
  'ar', 'fa', 'he', 'yi',                       // Semitic / RTL
  'ku', 'ug', 'ur', 'ps', 'dv', 'sd',           // Other RTL
  'ru', 'uk', 'sr', 'bg', 'mk', 'mn',           // Cyrillic
  'el',                                           // Greek
  'hy',                                           // Armenian
  'ka',                                           // Georgian
  'am',                                           // Ethiopic
  'hi', 'mr', 'ne',                              // Devanagari
  'bn',                                           // Bengali
  'gu',                                           // Gujarati
  'pa',                                           // Gurmukhi
  'ta',                                           // Tamil
  'te',                                           // Telugu
  'kn',                                           // Kannada
  'ml',                                           // Malayalam
  'si',                                           // Sinhala
  'th',                                           // Thai
  'km',                                           // Khmer
  'lo',                                           // Lao
  'my',                                           // Myanmar
  'ja',                                           // Japanese
  'ko',                                           // Korean
  'zh',                                           // Chinese
]);

/**
 * Accepted ASCII loanwords that are standard UI terms even in non-Latin locales.
 * These get a pass on the "must use native script" rule.
 */
const ACCEPTED_ASCII_LOANWORDS = new Set(['info', 'ok', 'pre']);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchTerms translation quality', () => {
  const locales = getLocaleDirs();

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

  // 3. Non-Latin locales should not have pure-ASCII searchTerms values
  describe('non-Latin locales use native script', () => {
    for (const locale of locales) {
      if (!NON_LATIN_LOCALES.has(locale)) continue;

      test(`${locale}`, () => {
        const messages = loadMessages(locale);
        const asciiValues: string[] = [];

        for (const [key, value] of Object.entries(messages)) {
          if (!key.startsWith('searchTerms.')) continue;
          if (ACCEPTED_ASCII_LOANWORDS.has(value.toLowerCase().trim())) continue;
          if (isAsciiOnly(value)) {
            asciiValues.push(`${key} = "${value}"`);
          }
        }

        expect(
          asciiValues,
          `${locale}: pure-ASCII searchTerms (likely untranslated):\n  ${asciiValues.join('\n  ')}`
        ).toHaveLength(0);
      });
    }
  });
});
