import en from './en.json';
import ru from './ru.json';

export type Locale = 'en' | 'ru';

export interface Translations {
  [key: string]: string | Translations;
}

export const translations: Record<Locale, Translations> = {
  en,
  ru,
};

export const localeNames: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
};

export const defaultLocale: Locale = 'en';

/**
 * Get a nested translation value from a dot-notation key
 */
const getTranslation = (locale: Locale, key: string): string => {
  const keys = key.split('.');
  const result = keys.reduce<Translations | string>((acc, k) => {
    if (typeof acc === 'string') {
      return acc;
    }
    const next = acc[k];
    return next === undefined ? acc : next;
  }, translations[locale]);

  if (typeof result === 'string') {
    return result;
  }

  // Fallback to English if key not found
  if (locale !== 'en') {
    return getTranslation('en', key);
  }

  return key;
};

export { getTranslation };
