/**
 * Describes Blok's I18n API for tools
 */
export interface I18n {
  /**
   * Translate a key from the global dictionary.
   * Keys should be fully qualified (e.g., 'tools.link.addLink', 'blockSettings.delete').
   *
   * @param dictKey - Full translation key to look up
   * @returns Translated string, or the key itself if translation is missing
   */
  t(dictKey: string): string;

  /**
   * Check if a translation exists for the given key.
   *
   * @param dictKey - Full translation key to check
   * @returns True if translation exists, false otherwise
   */
  has(dictKey: string): boolean;

  /**
   * Get the English translation for a key.
   * Used for multilingual search - always searches against English terms.
   *
   * @param key - Translation key (e.g., 'toolNames.heading')
   * @returns English translation string, or empty string if not found
   */
  getEnglishTranslation(key: string): string;
}
