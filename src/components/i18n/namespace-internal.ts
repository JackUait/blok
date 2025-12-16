import defaultDictionary from './locales/en/messages.json';

/**
 * Type for the flat namespace object containing all translation keys
 */
export type I18nKeys = keyof typeof defaultDictionary;

/**
 * Object containing all translation keys for type-safe access
 * Each key maps to itself for use with I18n.ui() and I18n.t()
 * @example I18n.ui(I18nInternalNS['ui.blockTunes.toggler.Drag to move']);
 */
export const I18nInternalNS = Object.keys(defaultDictionary).reduce<Record<I18nKeys, string>>(
  (result, key) => {
    return {
      ...result,
      [key as I18nKeys]: key,
    };
  },
  {} as Record<I18nKeys, string>
);
