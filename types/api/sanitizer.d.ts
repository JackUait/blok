import {SanitizerConfig} from '../index';

/**
 * Describes Blok`s sanitizer API
 */
export interface Sanitizer {
  /**
   * Clean taint string with html and returns clean string.
   * `on*` event handler attributes, `srcdoc` and script URLs in URL attributes
   * are always removed, whatever the config says.
   *
   * @param {string} taintString
   * @param {SanitizerConfig} config - configuration for sanitizer
   */
  clean(taintString: string, config: SanitizerConfig): string;
}
