import type { I18nDictionary } from '../../../../types/configs/i18n-dictionary';

import en from './en.json';

/**
 * All of en.json, in its key order. The build swaps this module for a merge
 * of the core and database parts, so `/locales` reuses both chunks instead of
 * shipping English a second time (see scripts/english-parts.mjs).
 */
const englishFull: I18nDictionary = en;

export default englishFull;
