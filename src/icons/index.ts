/**
 * @module Icons
 * Public entry for the `@blok/core/icons` subpath.
 *
 * Re-exports the SVG string constants used by the first-party tools so a
 * third-party block author can match the editor's toolbox/settings visuals
 * without copying SVG markup.
 *
 * @example
 * import { IconText, IconQuote } from '@blok/core/icons';
 *
 * static get toolbox() {
 *   return { title: 'My Tool', icon: IconText };
 * }
 */
export * from '../components/icons';
