/**
 * Tests that all 68 locales contain the Quote tool's i18n keys.
 *
 * The Quote tool uses these keys:
 *   - toolNames.quote           (toolbox title)
 *   - tools.quote.size          (size submenu label)
 *   - tools.quote.placeholder   (empty block placeholder)
 *   - tools.quote.defaultSize   (size setting)
 *   - tools.quote.largeSize     (size setting)
 *   - searchTerms.quote         (toolbox search alias)
 *   - searchTerms.blockquote    (toolbox search alias)
 *   - searchTerms.citation      (toolbox search alias)
 */
import { describe, test, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');

const QUOTE_KEYS = [
  'toolNames.quote',
  'tools.quote.size',
  'tools.quote.placeholder',
  'tools.quote.defaultSize',
  'tools.quote.largeSize',
  'searchTerms.quote',
  'searchTerms.blockquote',
  'searchTerms.citation',
] as const;

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

describe('Quote tool translations', () => {
  const locales = getLocaleDirs();

  describe('all locales contain Quote keys', () => {
    for (const locale of locales) {
      test(`${locale} has all Quote translation keys`, () => {
        const messages = loadMessages(locale);
        const missing = QUOTE_KEYS.filter(key => !(key in messages));

        expect(
          missing,
          `${locale}: missing Quote keys:\n  ${missing.join('\n  ')}`
        ).toHaveLength(0);
      });
    }
  });

  describe('Quote keys have non-empty values', () => {
    for (const locale of locales) {
      test(`${locale} has non-empty Quote values`, () => {
        const messages = loadMessages(locale);
        const empty = QUOTE_KEYS.filter(key => key in messages && messages[key].trim() === '');

        expect(
          empty,
          `${locale}: empty Quote values:\n  ${empty.join('\n  ')}`
        ).toHaveLength(0);
      });
    }
  });
});
