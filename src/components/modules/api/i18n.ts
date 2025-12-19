import type { I18n } from '../../../../types/api';
import { Module } from '../../__module';

/**
 * API module exposing i18n methods to tools.
 *
 * This module follows the standard API module pattern (extend Module, expose `methods` getter).
 * It provides a stable interface for tools while the internal I18n module can evolve.
 *
 * Tools should use full translation keys (e.g., 'tools.link.addLink', 'blockSettings.delete').
 */
export class I18nAPI extends Module {
  /**
   * Cached methods object to avoid creating new closures on every access.
   */
  private cachedMethods: I18n | null = null;

  /**
   * Returns the I18n API methods for tools.
   *
   * The methods object is cached to avoid allocating new closures on each property access,
   * which would happen frequently as tools call api.i18n.t() during rendering.
   */
  public get methods(): I18n {
    if (this.cachedMethods === null) {
      this.cachedMethods = {
        t: (dictKey: string): string => this.Blok.I18n.t(dictKey),
      };
    }

    return this.cachedMethods;
  }
}
