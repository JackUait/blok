/**
 * Public payloads and name map for editor lifecycle events observable via
 * `blok.events.on(...)`.
 *
 * These complement the mutation events delivered through the `onChange`
 * config callback ({@link ./block}). Use together with the exported event-name
 * constants `BlockRendered` (`'block:rendered'`) and `BlocksRendered`
 * (`'blocks:rendered'`).
 */

/**
 * Payload for the `block:rendered` event.
 */
export interface BlockRenderedPayload {
  /**
   * Id of the block that has just been rendered into the DOM.
   * Use `blok.blocks.getById(blockId)` to access it.
   */
  blockId: string;
}

/**
 * Payload for the `blocks:rendered` event.
 */
export interface BlocksRenderedPayload {
  /**
   * Number of top-level blocks rendered in the completed batch.
   */
  count: number;
}

/**
 * Payload for the `block:childrenMounted` event.
 */
export interface BlockChildrenMountedPayload {
  /**
   * Id of the CONTAINER block whose child slot has just been reconciled.
   */
  blockId: string;

  /**
   * Ids of that container's children, in model order — the blocks whose
   * holders now live inside the slot.
   */
  childIds: string[];
}

/**
 * Payload for the `i18n:changed` event.
 */
export interface I18nChangedPayload {
  /**
   * Locale in effect after the update.
   */
  locale: string;

  /**
   * Text direction of that locale, after any explicit override.
   */
  direction: 'ltr' | 'rtl';
}

/**
 * Map of editor lifecycle event name -> payload.
 *
 * Subscribers get fully typed payloads for these well-known events while the
 * `Events` API still accepts arbitrary string event names for custom events.
 */
export interface BlokEditorEventMap {
  'block:rendered': BlockRenderedPayload;
  'blocks:rendered': BlocksRenderedPayload;
  'block:childrenMounted': BlockChildrenMountedPayload;
  'i18n:changed': I18nChangedPayload;
}
