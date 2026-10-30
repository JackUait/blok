import type { I18nDictionary } from '../../../../types/configs/i18n-dictionary';

import en from './en.json';

/**
 * The English messages core itself uses. The build swaps this module for
 * en.json without the keys a tool declares under `blok.toolMessages` (see
 * scripts/english-parts.mjs). Tests and the dev server get all of en.json.
 */
const englishCore: I18nDictionary = en;

export default englishCore;
