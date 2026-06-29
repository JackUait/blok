import type { I18nInstance } from '../../components/utils/tools';

/**
 * Resolve a translation key, falling back to an inline English string when the
 * host editor has not registered the key. Keeps the audio tool usable before
 * locale messages are wired and gives the i18n regression scan a single place
 * to find the source copy.
 */
export function tr(i18n: I18nInstance | undefined, key: string, fallback: string): string {
  if (i18n?.has(key)) return i18n.t(key);

  return fallback;
}
