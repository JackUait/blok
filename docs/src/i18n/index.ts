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
  // A missing segment — or a segment that walks past a leaf string — is a hard
  // miss. Keeping the parent node and continuing let a later segment resolve
  // against a shallower ancestor, so e.g. `api.<section>.properties.<p>.description`
  // silently returned the section's own `description`.
  const result = keys.reduce<Translations | string | undefined>(
    (acc, k) => (acc === undefined || typeof acc === 'string' ? undefined : acc[k]),
    translations[locale] as Translations | string | undefined,
  );

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
