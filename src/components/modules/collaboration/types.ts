import type { CollaborationTerminalReason } from '../../events/CollaborationStatusChanged';
import type { AwarenessChange } from '../yjs/types';

/**
 * Identity of a persisted working set, mirrored from the server's
 * CollabWorkingSetTag. Format names the CRDT schema the update frames were
 * produced against (1 = client schema v2), epoch counts resets, and lineage
 * (32 lower-hex chars) is compared by equality: a different lineage means
 * "drop what you cached, this is not your history".
 */
export interface WorkingSetTag {
  format: number;
  epoch: number;
  lineage: string;
}

/**
 * One y-protocols message as carried by one WebSocket frame — the frames this
 * codec can put on the wire and hand back to the provider.
 *
 * - `syncStep1` carries a state vector; `syncStep2`/`update` carry a yjs update.
 * - `awareness` bytes are relayed verbatim; this codec never parses their interior.
 * - `permissionDenied` is the only auth sub-message.
 * - `control` is the Blok-only working-set announcement (message type 100).
 * - `limits` is the Blok-only message-size announcement (message type 101): the
 *   server's cap in bytes, sent right after the control frame so the client can
 *   refuse an oversized frame before writing it instead of learning from a 1009.
 */
export type SyncWireFrame =
  | { type: 'syncStep1'; stateVector: Uint8Array }
  | { type: 'syncStep2'; update: Uint8Array }
  | { type: 'update'; update: Uint8Array }
  | { type: 'awareness'; update: Uint8Array }
  | { type: 'queryAwareness' }
  | { type: 'permissionDenied'; reason: string }
  | { type: 'control'; tag: WorkingSetTag }
  | { type: 'limits'; maxMessageBytes: number };

/**
 * What {@link decode} returns. Either a frame this codec understands, an
 * ignorable frame of an unknown OUTER message type (the payload is left
 * unread), or a malformed frame with a human reason.
 *
 * decode NEVER throws: hostile or truncated input becomes `malformed`, not an
 * exception, so a bad frame can never take a WebSocket handler down with it.
 */
export type SyncWireDecodeResult =
  | SyncWireFrame
  | { type: 'unknown'; messageType: number }
  | { type: 'malformed'; reason: string };

/**
 * The slice of YjsManager the provider talks to — the binary doc seam plus the
 * awareness seam, with the SAME method names, so binding it is a pass-through
 * with no adapter. Declared here so the Collaboration module (and any test
 * harness) can see exactly what it must satisfy.
 *
 * PRE-ENABLE CONTRACT: `onAwarenessChange` and `encodeAwarenessUpdate` THROW
 * until `enableAwareness()` has been called; the other awareness methods no-op.
 * The provider calls `enableAwareness()` once a connection is negotiated, before
 * it touches either of those two.
 *
 * ECHO CONTRACT: the origin handed to `applyRemoteUpdate` is remembered forever
 * (the suppression set is never pruned), so the provider passes ONE long-lived
 * object per connection generation and never mints one per message.
 */
export interface CollabDocSeam {
  applyRemoteUpdate(update: Uint8Array, origin?: unknown): void;
  onDocUpdate(callback: (update: Uint8Array, origin: unknown) => void): () => void;

  /**
   * Every update, remote ones included — what the offline cache persists.
   * `onDocUpdate` hides exactly those, so a cache riding it would reload a
   * document missing every peer's work.
   */
  onAnyDocUpdate(callback: (update: Uint8Array, origin: unknown) => void): () => void;
  getStateVector(): Uint8Array;
  encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array;
  enableAwareness(): void;
  setAwarenessField(field: string, value: unknown): void;
  getAwarenessStates(): Map<number, Record<string, unknown>>;
  onAwarenessChange(callback: (changes: AwarenessChange, origin: unknown) => void): () => void;

  /**
   * Every presence emission, keepalive renewals included. A provider MUST
   * broadcast from this rather than `onAwarenessChange`: y-protocols renews the
   * local state with equal content every 3s, that renewal is filtered out of
   * the 'change' delta, and a peer that never hears it prunes this client after
   * its 30s outdated timeout — an idle collaborator's presence would vanish.
   */
  onAwarenessUpdate(callback: (changes: AwarenessChange, origin: unknown) => void): () => void;
  encodeAwarenessUpdate(clients?: number[]): Uint8Array;
  applyAwarenessUpdate(update: Uint8Array, origin: unknown): void;
  clearRemoteAwarenessStates(): void;

  /**
   * Throw this document away for a genuinely FRESH one, because the room was
   * reset and our history no longer belongs to it.
   *
   * MUST NOT be implemented as an in-place wipe: emptying the document keeps
   * its CRDT history, which the next sync merges straight back into the reset
   * room. After this call the seam's state vector is empty, `encodeStateAsUpdate`
   * carries nothing, and the client id is new — so the reconnect that follows
   * can leak no pre-reset history.
   *
   * Every subscription taken through this seam (`onDocUpdate`, `onAwarenessUpdate`)
   * survives the swap; the implementation re-binds them.
   */
  resetForRelineage(): void;
}

/**
 * The transport the provider drives. Deliberately the small mock-shaped subset
 * of the DOM `WebSocket` rather than the DOM type itself, so a test can supply a
 * plain object and a node tier can supply `ws`.
 */
export interface WebSocketLike {
  binaryType: string;
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

/**
 * Opens one transport. Injected so the provider has a mock tier and a node tier;
 * production passes the global `WebSocket`.
 */
export type CollabSocketFactory = (url: string, protocols: string[]) => WebSocketLike;

/**
 * Hands back a raw connection ticket. `createTicketSource` from
 * `utils/access-pass` satisfies this.
 *
 * `forceRefresh` is what the provider asks for after a 4401: the cached ticket
 * was rejected. A source caches by expiry alone, so without honouring the flag a
 * ticket refused for any other reason — revoked, signing key rotated, server
 * restarted, scope re-granted — is re-offered unchanged and the retry is
 * guaranteed to fail. Every layer between the provider and the mint MUST forward
 * this argument.
 */
export type CollabTicketSource = (options?: { forceRefresh?: boolean }) => Promise<string>;

/**
 * Coarse connection state for the host. `error` is TERMINAL: the provider has
 * stopped and will not reconnect on its own.
 */
export type CollabStatus = 'connecting' | 'connected' | 'offline' | 'error';

/**
 * Why the provider stopped for good — the wire-level reading of the published
 * {@link CollaborationTerminalReason}, which is where the union is DECLARED so
 * the host-facing name and this one can never drift apart.
 *
 * - `bad-request` — close 4400; the document id or the request is unusable.
 * - `unauthorized` — close 4401 twice since the last sync; the ticket is not accepted.
 * - `forbidden` — close 4403; this user may not open this document.
 * - `unsupported-format` — the control frame names a CRDT format we cannot read.
 * - `handshake-timeout` — three connections in a row opened and were never sent
 *   a control frame; this endpoint does not speak the protocol.
 * - `oversized-update` — a frame we must send is bigger than the server takes:
 *   either close 1009 twice since the last sync, or a resync answer we refused
 *   to write because it repeats a size already refused.
 * - `apply-failed` — the seam threw on an inbound frame; the document did not
 *   materialise, and the same frame would throw again.
 *
 * A stale lineage is deliberately NOT here: close 4409 and a changed lineage are
 * recoverable through {@link CollabDocSeam.resetForRelineage} plus a reconnect.
 */
export type CollabTerminalError = CollaborationTerminalReason;

/** Extra context for a status change; every field is best-effort. */
export interface CollabStatusDetail {
  /** WebSocket close code, when the transition came from a close. */
  code?: number;
  /** Close reason or a human explanation. */
  reason?: string;
  /** Set on `error` only. */
  error?: CollabTerminalError;
  /** Set on `offline` only: how long until the next attempt. */
  retryInMs?: number;
}

export type CollabStatusCallback = (status: CollabStatus, detail?: CollabStatusDetail) => void;

/** Everything {@link createCollabProvider} needs. */
export interface CollabProviderOptions {
  /** Absolute sync URL, e.g. `wss://host/sync/my-doc`. */
  url: string;
  /** Document id — used in messages only; the URL already carries it. */
  docId: string;
  /** The doc + awareness seam this provider synchronises. */
  yjs: CollabDocSeam;
  /** Mints connection tickets; omit for a server that needs none. */
  ticketSource?: CollabTicketSource;
  /** Opens the transport; defaults to the global `WebSocket`. */
  socketFactory?: CollabSocketFactory;
  /** Connection state sink. */
  onStatus?: CollabStatusCallback;
  /** How long to wait for the control frame before giving up (default 10s). */
  handshakeTimeoutMs?: number;
  /** Awareness send window, including queryAwareness replies (default 100ms). */
  awarenessThrottleMs?: number;
  /** Injectable randomness for backoff jitter; defaults to `Math.random`. */
  random?: () => number;
}

/** What {@link createCollabProvider} hands back. */
export interface CollabProvider {
  /** Start connecting. Idempotent while a connection is live or pending. */
  connect(): void;
  /** Stop for good: close the socket, unhook the seam, cancel every timer. */
  destroy(): void;
  /** Last reported status. */
  readonly status: CollabStatus;
  /** The working-set tag from the last validated control frame. */
  readonly tag: WorkingSetTag | null;
}
