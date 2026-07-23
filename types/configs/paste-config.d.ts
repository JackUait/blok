import { SanitizerConfig } from './sanitizer-config';

/**
 * Tool onPaste configuration object
 */
interface PasteConfigSpecified {
  /**
   * Array of tags Tool can substitute.
   *
   * Could also contain a sanitize-config if you need to save some tag's attribute.
   * For example:
   * [
   *   {
   *     img: { src: true },
   *   }
   * ],
   * @type string[]
   */
  tags?: (string | SanitizerConfig)[];

  /**
   * Object of string patterns Tool can substitute.
   * Key is your internal key and value is RegExp
   *
   * @type {{[key: string]: RegExp}}
   */
  patterns?: {[key: string]: RegExp};

  /**
   * Optional per-pattern resolution priority, keyed by the same keys as
   * {@link patterns}. Higher runs first; the default is `0`.
   *
   * Paste resolution picks the FIRST pattern that fully matches. Without
   * priorities that order is the order tools are registered, so a catch-all
   * pattern (e.g. a generic URL) only yields to a more specific one if it
   * happens to be registered last. Give a catch-all a negative priority to sink
   * it below specific patterns regardless of registration order.
   *
   * @example
   * // A generic-URL fallback that must lose to every specific embed pattern:
   * { patterns: { bookmark: /https?:\/\/\S+/ }, patternPriority: { bookmark: -100 } }
   */
  patternPriority?: {[key: string]: number};

  /**
   * Object with arrays of extensions and MIME types Tool can substitute
   */
  files?: {extensions?: string[], mimeTypes?: string[]};
}

/**
 * Alias for PasteConfig with false
 */
export type PasteConfig = PasteConfigSpecified | false;
