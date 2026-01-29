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
export function getTranslation(locale: Locale, key: string): string {
  const keys = key.split('.');
  let current: Translations | string = translations[locale];
  
  for (const k of keys) {
    if (typeof current === 'string') {
      return key; // Key not found, return the key itself
    }
    current = current[k] as Translations | string;
    if (current === undefined) {
      // Fallback to English if key not found
      if (locale !== 'en') {
        return getTranslation('en', key);
      }
      return key;
    }
  }
  
  return typeof current === 'string' ? current : key;
}
