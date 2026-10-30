import { englishDictionary } from '../../components/i18n/lightweight-i18n';
import englishDatabase from '../../components/i18n/locales/english-database';

/** What the Database tools add to the editor's English. */
export const DATABASE_MESSAGES = englishDatabase;

/**
 * The English a database string falls back to when it has no i18n API.
 * A function, not a merged object: a top-level spread is a side effect to
 * esbuild, which would then keep the database English in every consumer.
 */
export const databaseEnglish = (key: string): string | undefined => englishDatabase[key] ?? englishDictionary[key];
