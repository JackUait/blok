import type { I18n } from '../../../../types/api';
import I18nInternal from '../../i18n';
import Module from '../../__module';

/**
 * Provides methods for working with i18n
 */
export default class I18nAPI extends Module {
  /**
   * Memoized methods object to avoid allocation on every access
   */
  private cachedMethods: I18n | null = null;

  /**
   * Build flat translation key for tool or block tune
   * @param toolName - tool name
   * @param isTune - is tool a block tune
   * @param dictKey - the translation key
   */
  private static buildKey(toolName: string, isTune: boolean, dictKey: string): string {
    const namespace = isTune ? 'blockSettings' : 'tools';

    // For tunes, if dictKey matches toolName, use simpler key format (e.g., blockSettings.delete)
    if (isTune && dictKey === toolName) {
      return `${namespace}.${toolName}`;
    }

    return `${namespace}.${toolName}.${dictKey}`;
  }

  /**
   * Return I18n API methods with global dictionary access
   */
  public get methods(): I18n {
    if (this.cachedMethods === null) {
      this.cachedMethods = {
        t: (dictKey: string): string => {
          if (I18nInternal.hasTranslation(dictKey)) {
            return I18nInternal.t(dictKey as Parameters<typeof I18nInternal.t>[0]);
          }

          return dictKey;
        },
      };
    }

    return this.cachedMethods;
  }

  /**
   * Return I18n API methods with tool namespaced dictionary.
   * Falls back to the original dictKey if no translation exists,
   * so tool developers get their key back (e.g., "label" not "tools.myTool.label").
   * @param toolName - tool name
   * @param isTune - is tool a block tune
   */
  public getMethodsForTool(toolName: string, isTune: boolean): I18n {
    return {
      t: (dictKey: string): string => {
        const fullKey = I18nAPI.buildKey(toolName, isTune, dictKey);

        if (I18nInternal.hasTranslation(fullKey)) {
          return I18nInternal.t(fullKey as Parameters<typeof I18nInternal.t>[0]);
        }

        return dictKey;
      },
    };
  }
}
