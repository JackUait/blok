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
     *
     * EMPTY STRING when that peer configured no `collaboration.user` — which is
     * the default, since `user` is optional. They are still in the room and
     * still get an avatar; render them anonymously, in `color`.
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
 * Why a collaboration session stopped for good. Every value means the same
 * thing operationally: the editor will NOT reconnect on its own, and it stays
 * read-only until the host recreates it.
 *
 * - `bad-request` — the document id or the connection request is unusable.
 * - `unauthorized` — the connection ticket was refused twice; it is not accepted.
 * - `forbidden` — this user may not open this document.
 * - `unsupported-format` — the document is stored in a schema this editor cannot read.
 * - `handshake-timeout` — repeated connections went unanswered; not a Blok sync endpoint.
 * - `oversized-update` — the document cannot be shipped: a frame the editor must
 *   send is larger than the server accepts. The content is still in the tab, so
 *   offer the user a copy before the page is closed.
 * - `apply-failed` — an incoming change could not be applied, so the document
 *   never materialised.
 *
 * A reset room is deliberately NOT here: the editor drops its copy and
 * reconnects, reporting `offline` while it does.
 */
export type CollaborationTerminalReason =
  | 'bad-request'
  | 'unauthorized'
  | 'forbidden'
  | 'unsupported-format'
  | 'handshake-timeout'
  | 'oversized-update'
  | 'apply-failed';

/**
 * Payload for the `collaboration:status` event.
 */
export interface CollaborationStatusChangedPayload {
  /**
   * Connection state of the collaboration session.
   *
   * - `connecting` — establishing the session, before the first sync.
   * - `connected` — synced and live with the server.
   * - `offline` — disconnected, and RETRYING: local edits (if the doc has
   *   server lineage) stay pending until it reconnects. `retryInMs` says when
   *   the next attempt is.
   * - `error` — stopped for good; nothing is pending because nothing will be
   *   sent. The editor stays read-only until the host recreates it. `error`
   *   says why.
   */
  status: 'connecting' | 'connected' | 'offline' | 'error';

  /**
   * Peers currently present in the session (excludes the local client).
   */
  peers: CollaborationPeer[];

  /**
   * Set on `error` only: why the session stopped for good.
   */
  error?: CollaborationTerminalReason;

  /**
   * WebSocket close code behind the transition, when there was one.
   */
  code?: number;

  /**
   * Human-readable explanation of the transition. Server-supplied close reasons
   * reach this field verbatim, so treat it as untrusted text — log it, do not
   * render it as markup.
   */
  reason?: string;

  /**
   * Set on `offline` only: milliseconds until the next reconnect attempt.
   */
  retryInMs?: number;
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
