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
 * One person visible in the shared session, as surfaced to the host.
 *
 * One entry per PERSON, not per connection: two browser tabs signed in as the
 * same user collapse into one entry with two `clientIds`. Without a verified
 * identity from the room the two cannot be recognised as one, so each keys on
 * its own client id.
 */
export interface CollaborationParticipant {
  /**
   * Server-verified identity of this person, or null when the room could not
   * verify one. NEVER what the peer claims about itself.
   */
  userId: string | null;

  /** In the document right now. Always true today; Blok reports nobody absent. */
  present: boolean;

  /** This editor's own reader. */
  self: boolean;

  /** Awareness client ids behind this entry, ascending. At least one. */
  clientIds: number[];

  /**
   * When this person last did something, in epoch ms on THIS browser's clock
   * after clamping for the peer's clock. Null when they published none.
   *
   * Blok does not decide who counts as idle and carries no threshold: compare
   * against your own clock with whatever window your product wants.
   */
  lastActiveAt: number | null;

  /**
   * The block this person's caret is in, or null when they have none. For an
   * entry that collapsed two tabs, the block of the more recently active one.
   */
  blockId: string | null;

  /** Display identity. Host-rendered, so treat every field as untrusted text. */
  user: {
    /** Published display name, trimmed and capped. Empty when they published none. */
    name: string;
    /** Cursor and avatar colour. Empty when the peer published none. */
    color: string;
    /** Space silhouette for a nameless participant, else null. */
    glyph: string | null;
    /** Localized anonymous phrase for that silhouette, else null. */
    label: string | null;
  };
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
 * - `apply-failed` — an incoming DOCUMENT frame could not be applied, so the
 *   document never materialised. A presence frame that fails to apply is
 *   dropped with a warning and is never terminal.
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
   * People in the session, the reader included. Blok reports nobody who has
   * left: presence is ephemeral, and durable activity is the host's own record.
   */
  participants: CollaborationParticipant[];

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

  /**
   * Whether this browser's edits are safely with the server, INDEPENDENT of
   * `status`: a `connected` session can still be holding work nobody has taken,
   * and an `offline` one can have nothing left to send.
   *
   * - `saved` — nothing is waiting and nothing is being written.
   * - `pending` — edits are journalled locally and not acknowledged yet.
   * - `blocked` — the local copy is broken, so nothing more may be sent.
   * - `quarantined` — edits were moved out of the queue and will never be sent;
   *   `quarantinedOperations` counts them. With `offline` on they stay in this
   *   browser's copy; in memory mode only the count survives, and nothing reads
   *   either of them back out today.
   * - `unavailable` — no durable save can be reported at all: the server speaks
   *   the legacy protocol, or nothing has been negotiated yet.
   *
   * Persistence reasons live HERE, never in `error`: that union means "the
   * editor will not reconnect", and a broken local store or a refused edit does
   * not stop the socket.
   *
   * DELIVERY. This is published whether or not the connection changed: a save
   * state that moves on its own emits an event, and an identical payload emits
   * none. A reconnect attempt still reports its own `offline` and `connecting`
   * states, each carrying the current save state; what it does not do is invent
   * a save change per retry. One replay lands shortly after the
   * editor is ready, so a host that subscribes once `isReady` resolves still
   * hears the state it is already in.
   *
   * The counts are a report, not a verdict. A local queue that cannot be read
   * at all answers zero rows, so zero under `blocked` means unknown rather than
   * nothing waiting.
   */
  save?: {
    state: 'saved' | 'pending' | 'blocked' | 'quarantined' | 'unavailable';
    reason?: 'local-storage-failed' | 'operation-rejected' | 'legacy-protocol';
    pendingOperations: number;
    pendingBytes: number;
    quarantinedOperations: number;

    /**
     * Where the server journalled the last acknowledged edit. A DECIMAL
     * STRING: the ceiling is 2^64 - 1, which no `number` holds exactly.
     */
    serverSequence?: string;
  };
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
