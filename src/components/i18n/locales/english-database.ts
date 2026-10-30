import type { I18nDictionary } from '../../../../types/configs/i18n-dictionary';

import en from './en.json';

/**
 * The English messages only the Database tools use. The build swaps this
 * module for those keys alone (see scripts/english-parts.mjs); tests and the
 * dev server get all of en.json, which is a superset.
 */
const englishDatabase: I18nDictionary = en;

export default englishDatabase;
