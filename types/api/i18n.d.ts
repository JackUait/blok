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
}
