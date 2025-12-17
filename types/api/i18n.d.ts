/**
 * Describes Blok`s I18n API
 */
export interface I18n {
  /**
   * Perform translation with automatically added namespace like `tools.${toolName}` or `blockSettings.${tuneName}`
   *
   * @param dictKey - what to translate
   */
  t(dictKey: string): string;
}
