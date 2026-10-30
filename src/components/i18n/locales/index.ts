import type { LocaleConfig } from '../../../../types/configs/i18n-config';

import { buildConfig, seedLocale } from './catalog';
import englishFull from './english-full';

export {
  ALL_LOCALE_CODES,
  DEFAULT_LOCALE,
  buildRegistry,
  clearLocaleCache,
  getDirection,
  getLocaleSync,
  loadLocale,
  normalizeLocale,
  preloadLocales,
} from './catalog';

/**
 * English locale config - always available (statically imported), with every
 * key, database ones included.
 */
export const enLocale: LocaleConfig = buildConfig('en', englishFull);

seedLocale('en', enLocale);
