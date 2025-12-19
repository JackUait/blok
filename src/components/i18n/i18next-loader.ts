import type { i18n as I18nextInstance, InitOptions } from 'i18next';
import type { I18nDictionary } from '../../../types/configs/i18n-dictionary';
import type { SupportedLocale } from '../../../types/configs/i18n-config';
import { englishDictionary } from './lightweight-i18n';

/**
 * i18next instance type after initialization
 */
export type InitializedI18next = I18nextInstance;

/**
 * Result of initializing i18next
 */
export interface I18nextInitResult {
  instance: InitializedI18next;
  t: (key: string, vars?: Record<string, string | number>) => string;
  has: (key: string) => boolean;
  setDictionary: (dictionary: I18nDictionary) => void;
  changeLanguage: (locale: SupportedLocale) => Promise<void>;
}

/**
 * Dynamically load and initialize i18next.
 * This is only called when a non-English locale is needed.
 *
 * @param initialLocale - The locale to initialize with
 * @param localeConfig - The loaded locale configuration
 * @returns Initialized i18next wrapper
 */
export const loadI18next = async (
  initialLocale: SupportedLocale,
  localeConfig: { dictionary: I18nDictionary }
): Promise<I18nextInitResult> => {
  // Dynamic import of i18next - this is the key to tree-shaking it out
  const i18next = await import('i18next');

  // Create a new instance (not the global one) for isolation
  const instance = i18next.default.createInstance();

  const initOptions: InitOptions = {
    lng: initialLocale,
    fallbackLng: 'en',
    resources: {
      en: {
        translation: englishDictionary,
      },
      [initialLocale]: {
        translation: localeConfig.dictionary,
      },
    },
    interpolation: {
      // Use single braces {var} to match existing format
      prefix: '{',
      suffix: '}',
      escapeValue: false, // React/DOM handles escaping
    },
    // Return key if translation is missing (consistent behavior)
    returnNull: false,
    returnEmptyString: false,
    // Don't parse keys as nested objects - we use flat keys with dots
    keySeparator: false,
    nsSeparator: false,
  };

  await instance.init(initOptions);

  return {
    instance,
    t: (key: string, vars?: Record<string, string | number>): string => {
      return instance.t(key, vars);
    },
    has: (key: string): boolean => {
      return instance.exists(key);
    },
    setDictionary: (dictionary: I18nDictionary): void => {
      const currentLang = instance.language;

      instance.addResourceBundle(currentLang, 'translation', dictionary, true, true);
    },
    changeLanguage: async (locale: SupportedLocale): Promise<void> => {
      await instance.changeLanguage(locale);
    },
  };
}
