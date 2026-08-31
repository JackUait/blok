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
 * One collaborator visible in the shared session, as surfaced to the host for
 * rendering a presence stack / sync pill.
 */
export interface CollaborationPeer {
  /**
   * Awareness client id of the peer. Unique per live connection, not per user.
   */
  clientId: number;

  /**
   * Display identity of the peer. Host-rendered, so treat as untrusted text.
   */
  user: {
    /**
     * Display name shown in the presence stack.
     */
    name: string;

    /**
     * CSS color used for the peer's cursor / avatar outline.
     */
    color: string;
  };

  /**
   * Id of the block the peer's caret is in, or `null` when the peer has no
   * caret in the document (e.g. focus is elsewhere).
   */
  blockId: string | null;

  /**
   * RESERVED — never populated today, so it is always `undefined`.
   *
   * Peers are built from the awareness state each browser broadcasts, and that
   * state carries no write claim: only the server knows a member's grant, and
   * it does not publish other members' grants to the room. Do not branch on
   * it; a `false`-y read means "not reported", not "cannot write".
   */
  canWrite?: boolean;
}

/**
 * Payload for the `collaboration:status` event.
 */
export interface CollaborationStatusChangedPayload {
  /**
   * Connection state of the collaboration session.
   *
   * - `connecting` — establishing the session, before the first sync.
   * - `connected` — synced and live with the server.
   * - `offline` — disconnected; local edits (if the doc has server lineage)
   *   stay pending until reconnect.
   */
  status: 'connecting' | 'connected' | 'offline';

  /**
   * Peers currently present in the session (excludes the local client).
   */
  peers: CollaborationPeer[];
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
  'collaboration:status': CollaborationStatusChangedPayload;
}
