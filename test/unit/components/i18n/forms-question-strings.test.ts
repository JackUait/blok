import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALL_LOCALE_CODES } from '../../../../src/components/i18n/locales';

const LOCALES_DIR = resolve(__dirname, '../../../../src/components/i18n/locales');
const FORM_MESSAGES = {
  'tools.database.formQuestionName': 'Question',
  'tools.database.formQuestionDescription': 'Description',
  'tools.database.formSyncPropertyName': 'Sync with property name',
  'tools.database.formLongAnswer': 'Long answer',
  'tools.database.formMaxSelections': 'Maximum selections',
  'tools.database.formAddQuestion': 'Add question',
  'tools.database.formChooseAnswer': 'Choose an answer',
} as const;

const loadMessages = (locale: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(
    readFileSync(join(LOCALES_DIR, `${locale}.json`), 'utf8')
  );

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${locale}: expected a flat locale dictionary`);
  }

  return parsed as Record<string, unknown>;
};

const extractPlaceholders = (value: string): string[] =>
  (value.match(/\{[^}]+\}/g) ?? []).sort();

describe('Forms question translations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(ALL_LOCALE_CODES)('%s supplies all seven Forms question strings', locale => {
    const messages = loadMessages(locale);
    const expected = Object.entries(FORM_MESSAGES);
    const missing = expected
      .filter(([key]) => !Object.prototype.hasOwnProperty.call(messages, key))
      .map(([key]) => key);

    expect(missing).toEqual([]);

    for (const [key, source] of expected) {
      const value = messages[key];

      expect(typeof value, `${locale}/${key}`).toBe('string');

      if (typeof value !== 'string') {
        throw new Error(`${locale}/${key}: expected a translated string`);
      }

      expect(value.trim(), `${locale}/${key}`).not.toBe('');
      expect(extractPlaceholders(value), `${locale}/${key}`)
        .toEqual(extractPlaceholders(source));
    }
  });

  it('supplies the exact English Forms question wording', () => {
    const messages = loadMessages('en');
    const actual = Object.fromEntries(
      Object.keys(FORM_MESSAGES).map(key => [key, messages[key]])
    );

    expect(actual).toEqual(FORM_MESSAGES);
  });
});
