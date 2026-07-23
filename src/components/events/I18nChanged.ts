export type { I18nChangedPayload } from '../../../types/events/editor-events';

/**
 * Fired after `blok.i18n.update()` has applied a new locale and/or message
 * overrides, once the editor chrome has been relabelled.
 *
 * Subscribers use it to relabel their own UI built against the editor (custom
 * tool chrome, host-rendered toolbars) in the same tick as Blok's own.
 *
 * Public event name: `i18n:changed`.
 */
export const I18nChanged = 'i18n:changed';
