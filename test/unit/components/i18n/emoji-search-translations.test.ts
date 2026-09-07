import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALL_LOCALE_CODES, clearLocaleCache, loadLocale } from '../../../../src/components/i18n/locales';

const SEARCH_KEYS = [
  'tools.callout.clearEmojiSearch',
  'tools.callout.emojiSearchHint',
] as const;

const ENGLISH_MESSAGES = {
  'tools.callout.clearEmojiSearch': 'Clear search',
  'tools.callout.emojiSearchHint': 'Try a different word or clear the search.',
};

const RUSSIAN_MESSAGES = {
  'tools.callout.clearEmojiSearch': 'Очистить поиск',
  'tools.callout.emojiSearchHint': 'Попробуйте другое слово или очистите поиск.',
};

describe('Emoji search translations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocaleCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearLocaleCache();
  });

  it.each([
    { locale: 'en', messages: ENGLISH_MESSAGES },
    { locale: 'ru', messages: RUSSIAN_MESSAGES },
  ] as const)('loads the $locale clear action and empty-search hint', async ({ locale, messages }) => {
    const { dictionary } = await loadLocale(locale);

    expect(dictionary).toMatchObject(messages);
  });

  it.each(ALL_LOCALE_CODES)('%s provides localized emoji search messages without English fallback', async (locale) => {
    const { dictionary } = await loadLocale(locale);

    for (const key of SEARCH_KEYS) {
      expect(dictionary[key], `${locale}: ${key}`).toEqual(expect.any(String));
      expect(dictionary[key].trim(), `${locale}: ${key}`).not.toBe('');

      if (locale !== 'en') {
        expect(dictionary[key], `${locale}: ${key}`).not.toBe(ENGLISH_MESSAGES[key]);
      }
    }
  });
});
