import type { I18n } from '../../../../types/api';
import I18nInternal from '../../i18n';
import { logLabeled } from '../../utils';
import Module from '../../__module';

/**
 * Provides methods for working with i18n
 */
export default class I18nAPI extends Module {
  /**
   * Build flat translation key for tool or block tune
   * @param toolName - tool name
   * @param isTune - is tool a block tune
   * @param dictKey - the translation key
   */
  private static buildKey(toolName: string, isTune: boolean, dictKey: string): string {
    const namespace = isTune ? 'blockTunes' : 'tools';

    return `${namespace}.${toolName}.${dictKey}`;
  }

  /**
   * Return I18n API methods with global dictionary access
   */
  public get methods(): I18n {
    return {
      t: (_dictKey?: string): string => {
        logLabeled('I18n.t() method can be accessed only from Tools', 'warn');

        return '';
      },
    };
  }

  /**
   * Return I18n API methods with tool namespaced dictionary
   * @param toolName - tool name
   * @param isTune - is tool a block tune
   */
  public getMethodsForTool(toolName: string, isTune: boolean): I18n {
    return Object.assign(
      this.methods,
      {
        t: (dictKey: string): string => {
          const fullKey = I18nAPI.buildKey(toolName, isTune, dictKey);
          const translation = I18nInternal.t(fullKey);

          /**
           * If the translation lookup returned a fallback (extracted from the key),
           * prefer the original dictKey. This handles cases where dictKey contains
           * dots (e.g., "Start typing here...") which would break the fallback parsing.
           */
          if (translation === dictKey) {
            return dictKey;
          }

          /**
           * Check if I18n.t() returned a parsed fallback rather than an actual translation.
           * The internal _t() extracts text after the last dot when no translation exists.
           * If that extraction doesn't match dictKey, it means parsing was corrupted
           * (e.g., dictKey had internal dots), so use dictKey directly.
           */
          if (!I18nInternal.hasTranslation(fullKey)) {
            return dictKey;
          }

          return translation;
        },
      });
  }
}
