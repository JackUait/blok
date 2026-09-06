import { logLabeled } from '../../utils/logger';

import { decode, encode } from './sync-wire';
import type {
  CollabOutbox,
  CollabOutboxRow,
  CollabProvider,
  CollabProviderOptions,
  CollabSocketFactory,
  CollabStatus,
  CollabStatusDetail,
  CollabTerminalError,
  SessionProtocol,
  SyncWireFrame,
  WebSocketLike,
  WorkingSetTag,
} from './types';

/**
 * The client half of Blok's sync protocol: one WebSocket per document, the
 * y-protocols message set over {@link encode}/{@link decode}, and every byte of
 * document traffic passing through the binary seam (`CollabDocSeam`).
 *
 * Two rules carry the whole design:
 *
 * 1. HANDSHAKE ORDER. The only frame that may leave before the server's control
 *    frame is validated is SyncStep1 — a state vector is inert. SyncStep2 and
 *    Update carry history, and a document whose lineage no longer matches the
 *    room must never leak that history into a room that was reset. So the
 *    provider opens in `awaiting-control`, sends SyncStep1, BUFFERS every
 *    inbound frame, and only wires the seam once the control frame passes.
 * 2. ONE ORIGIN PER GENERATION. The seam remembers every origin handed to
 *    `applyRemoteUpdate` forever (its echo-suppression set is never pruned), so
 *    the provider mints exactly one origin object per connection and reuses it
 *    for every message on that connection.
 *
 * No DOM, no module wiring: the Collaboration module owns those.
 */

/** The token every server selects when it has no durable operation store. */
const SYNC_SUBPROTOCOL_V1 = 'blok-sync.v1';

/** The token a server with a durable operation store selects. */
const SYNC_SUBPROTOCOL_V2 = 'blok-sync.v2';

/**
 * Version tokens this client offers, in order, before the ticket (if any).
 *
 * v2 is offered ONLY with an outbox, because that is the whole v2 write path:
 * without one the seam drops every local edit (`hookSeam` returns under v2) and
 * the drain that replaces it returns before it can ask for the residual state
 * vector, so a v2 selection would leave the client unable to send anything at
 * all after its opening SyncStep1.
 * @param outbox - the durable outbox, when this provider has one
 */
const subprotocolOffers = (outbox: CollabOutbox | undefined): string[] =>
  outbox === undefined ? [SYNC_SUBPROTOCOL_V1] : [SYNC_SUBPROTOCOL_V2, SYNC_SUBPROTOCOL_V1];

/** CRDT schema this client speaks. A control frame naming another is terminal. */
const SUPPORTED_FORMAT = 1;

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_AWARENESS_THROTTLE_MS = 100;

/**
 * Silent handshakes since the last completed sync before the session is called
 * dead. A timeout is an INFERENCE, not a verdict: a cold-starting server and a
 * buffering proxy look exactly like an endpoint that does not speak the
 * protocol, so a single one may not end the session — a server that refuses the
 * connection outright retries forever, and a slow one must not fare worse. Two
 * attempts land inside ~11s, which is not long enough to tell those apart;
 * three span ~33s, which is.
 */
const MAX_HANDSHAKE_TIMEOUTS_SINCE_SYNC = 3;

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

/** A planned restart is back within moments; do not make the user wait a second. */
const SHORT_RECONNECT_MS = 250;

/**
 * How long one operation may stay unacknowledged before the connection is
 * dropped and the SAME id redriven on the next one. Nothing is deleted: an
 * unanswered operation's commit outcome is unknown, and re-sending the same id
 * with the same bytes is what resolves it (protocol section 7.2).
 */
const ACK_TIMEOUT_MS = 15_000;

/**
 * A Yjs v1 update carrying nothing: `varUint(0)` for the structs and
 * `varUint(0)` for the delete set. Anything longer holds something the peer's
 * state vector does not account for.
 */
const EMPTY_UPDATE_BYTES = 2;

/** Rejection codes that are not final. `not-synced` is the only one. */
const TRANSIENT_REJECTION_CODE = 'not-synced';

/** The rejection that says our history belongs to a lineage the server dropped. */
const LINEAGE_MISMATCH_CODE = 'lineage-mismatch';

/** Recorded with rows a lineage reset quarantines. Never free text from a peer. */
const RELINEAGE_REASON = 'lineage-reset';

/** Recorded with a row this client refused to write because it exceeds the cap. */
const OVERSIZED_REASON = 'oversized-update';

/** Recorded with a row left behind by a quarantine that did not commit. */
const STALE_LINEAGE_REASON = 'stale-lineage';

/** Enough to hold a whole first sync ahead of the control frame, not enough to flood us. */
const MAX_BUFFERED_INBOUND = 64;

const CLOSE_NORMAL = 1000;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_POLICY_VIOLATION = 1008;
const CLOSE_MESSAGE_TOO_BIG = 1009;
const CLOSE_UNAUTHORIZED = 4401;

/** The room was reset: our history does not belong to it. Recoverable, not terminal. */
const CLOSE_LINEAGE_RESET = 4409;

/** Close codes that end the session outright — reconnecting would only repeat them. */
const TERMINAL_CLOSE_CODES: Record<number, CollabTerminalError> = {
  4400: 'bad-request',
  4403: 'forbidden',
};

/** Identifies the transactions this connection applied, for echo suppression. */
interface ProviderOrigin {
  readonly provider: 'blok-collab';
}

type Phase = 'idle' | 'connecting' | 'awaiting-control' | 'ready' | 'offline' | 'relineage' | 'terminal';

interface ProviderState {
  /** Bumped per connection attempt; every async continuation checks it. */
  generation: number;
  phase: Phase;
  status: CollabStatus;
  socket: WebSocketLike | null;
  origin: ProviderOrigin | null;
  tag: WorkingSetTag | null;
  /**
   * What the server selected on the connection that last validated a control
   * frame. Read from the socket rather than inferred from the offers — a proxy
   * or an older server may select nothing at all — because the whole
   * local-write route hangs off it.
   */
  protocol: SessionProtocol;
  /**
   * Lineage this document's history belongs to. Normally learned from the
   * first control frame; PRE-SEEDED when the document was adopted from the
   * offline cache, so the first frame is compared rather than believed.
   */
  lineage: string | null;
  buffered: SyncWireFrame[];
  unhookDoc: (() => void) | null;
  unhookAwareness: (() => void) | null;
  handshakeTimer: ReturnType<typeof setTimeout> | null;
  /** Armed once the control frame validates; a first sync is what disarms it. */
  firstSyncTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  awarenessTimer: ReturnType<typeof setTimeout> | null;
  awarenessClients: Set<number>;
  /** A queryAwareness reply (or a reconnect) needs every state, not just the deltas. */
  awarenessFull: boolean;
  attempt: number;
  /** Counters run since the LAST COMPLETED SYNC, not since the last close. */
  unauthorizedSinceSync: number;
  /**
   * Since the last resync answer that SHIPPED, not since the last sync: the
   * server's SyncStep2 lands before its SyncStep1, so a sync completing
   * proves nothing about the answer that follows it. See `answerResync`.
   */
  oversizedSinceSync: number;
  handshakeTimeoutsSinceSync: number;
  /** Largest frame written on the CURRENT connection, in encoded bytes. */
  largestSentBytes: number;
  /**
   * Smallest frame size the server has refused as too big, if it has. Cleared
   * with `oversizedSinceSync`, by a shipped resync answer.
   */
  refusedFrameBytes: number | null;
  /**
   * The cap the server ANNOUNCED in its limits frame, in bytes — fact, not
   * inference, so unlike `refusedFrameBytes` a completed sync does not clear
   * it. It belongs to the connection that announced it: reset per connection
   * so another server's cap never leaks across a reconnect.
   */
  announcedMaxBytes: number | null;
  forceTicketRefresh: boolean;
  synced: boolean;
  destroyed: boolean;
  /** The one operation on the wire, or none. Never two at a time per provider. */
  inFlight: { operationId: string; lineage: string } | null;
  /** Fires when an operation goes unanswered: reconnect and redrive the same id. */
  ackTimer: ReturnType<typeof setTimeout> | null;
  /** One drain pass at a time; a pass is asynchronous. */
  draining: boolean;
  /** A server SyncStep1 we deferred because operations were still pending. */
  resyncOwed: boolean;
  /**
   * The once-per-connection residual round of protocol section 7.1 step 4. Once
   * per connection because the server answers every SyncStep1 with one of its
   * own, and a second round would ping-pong for the life of the socket.
   */
  residual: 'none' | 'requested' | 'done';
}

/**
 * The DOM WebSocket's handler properties are typed with `MessageEvent` /
 * `CloseEvent`; under `strictFunctionTypes` those parameters are checked
 * contravariantly, so the class does not structurally satisfy the mock-shaped
 * {@link WebSocketLike}. The runtime shapes are identical — this cast is the
 * entire adapter, and keeping the interface mock-shaped is what gives us the
 * mock tier and a node tier.
 * @param url - the sync URL
 * @param protocols - the subprotocols to offer
 */
const defaultSocketFactory: CollabSocketFactory = (url, protocols) =>
  new WebSocket(url, protocols) as unknown as WebSocketLike;

/**
 * Normalizes whatever the transport hands us into bytes. We ask for
 * `arraybuffer`, so anything else is not a frame we can read.
 * @param data - the message payload as the transport delivered it
 */
function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }

  return null;
}

/**
 * Builds a collaboration provider for one document. It does NOT connect on its
 * own — the caller decides when, and calls {@link CollabProvider.destroy} when
 * the editor goes away.
 * @param options - the sync URL, the document id, the seam, and the injectables
 */
export function createCollabProvider(options: CollabProviderOptions): CollabProvider {
  const { url, docId, yjs, ticketSource, onStatus } = options;
  const socketFactory = options.socketFactory ?? defaultSocketFactory;
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  const awarenessThrottleMs = options.awarenessThrottleMs ?? DEFAULT_AWARENESS_THROTTLE_MS;
  const random = options.random ?? ((): number => Math.random());

  const state: ProviderState = {
    generation: 0,
    phase: 'idle',
    status: 'offline',
    socket: null,
    origin: null,
    protocol: 'v1',
    tag: null,
    lineage: options.initialLineage ?? null,
    buffered: [],
    unhookDoc: null,
    unhookAwareness: null,
    handshakeTimer: null,
    firstSyncTimer: null,
    reconnectTimer: null,
    awarenessTimer: null,
    awarenessClients: new Set<number>(),
    awarenessFull: false,
    attempt: 0,
    unauthorizedSinceSync: 0,
    oversizedSinceSync: 0,
    handshakeTimeoutsSinceSync: 0,
    largestSentBytes: 0,
    refusedFrameBytes: null,
    announcedMaxBytes: null,
    forceTicketRefresh: false,
    synced: false,
    destroyed: false,
    inFlight: null,
    ackTimer: null,
    draining: false,
    resyncOwed: false,
    residual: 'none',
  };

  /** True once this continuation belongs to a connection nobody is waiting for. */
  const isStale = (generation: number): boolean => state.destroyed || generation !== state.generation;

  const report = (status: CollabStatus, detail?: CollabStatusDetail): void => {
    if (state.destroyed) {
      return;
    }

    state.status = status;
    onStatus?.(status, detail);
  };

  const clearTimer = (timer: ReturnType<typeof setTimeout> | null): null => {
    if (timer !== null) {
      clearTimeout(timer);
    }

    return null;
  };

  /**
   * Writes bytes already on the wire format, remembering the largest frame this
   * connection has written: a 1009 names no frame, so the largest one we wrote
   * is the only estimate we have of what tripped the server's message cap.
   *
   * A socket that died between the check and the write throws; the close
   * handler owns recovery, so there is nothing useful to do here.
   * @param socket - the live transport
   * @param bytes - the encoded frame
   */
  const sendBytes = (socket: WebSocketLike, bytes: Uint8Array): void => {
    state.largestSentBytes = Math.max(state.largestSentBytes, bytes.byteLength);

    try {
      socket.send(bytes);
    } catch {
      // Intentionally inert: `onclose` drives reconnection.
    }
  };

  /**
   * Writes one frame.
   * @param socket - the live transport
   * @param frame - the frame to write
   */
  const send = (socket: WebSocketLike, frame: SyncWireFrame): void => {
    sendBytes(socket, encode(frame));
  };

  const flushAwareness = (): void => {
    const socket = state.socket;
    const full = state.awarenessFull;
    const clients = Array.from(state.awarenessClients);

    state.awarenessFull = false;
    state.awarenessClients.clear();

    if (socket === null || state.phase !== 'ready') {
      return;
    }

    if (!full && clients.length === 0) {
      return;
    }

    // `undefined` means "every state we know", which is what a queryAwareness
    // asks for and what a reconnect must re-announce.
    const update = yjs.encodeAwarenessUpdate(full ? undefined : clients);

    send(socket, { type: 'awareness', update });
  };

  /**
   * Coalesces presence traffic into one frame per window — including the reply
   * to queryAwareness, so a peer spamming type-3 cannot push us past the
   * server's own inbound budget.
   * @param full - whether the pending send must carry every known state
   */
  const scheduleAwareness = (full: boolean): void => {
    state.awarenessFull = state.awarenessFull || full;

    if (state.awarenessTimer !== null) {
      return;
    }

    state.awarenessTimer = setTimeout(() => {
      state.awarenessTimer = null;
      flushAwareness();
    }, awarenessThrottleMs);
  };

  /**
   * Wires the seam for one connection. Both directions filter on the connection's
   * own origin: what we applied FROM the server must never be sent back to it.
   * @param origin - this generation's origin object
   */
  const hookSeam = (origin: ProviderOrigin): void => {
    state.unhookDoc = yjs.onDocUpdate((update, updateOrigin) => {
      if (updateOrigin === origin || state.socket === null) {
        return;
      }

      // Under v2 the send path is the outbox drain (Task 4.4): an operation
      // leaves only once the store has committed it, so writing a raw type-0
      // here would put the edit on the wire before that.
      if (state.protocol === 'v2') {
        return;
      }

      const bytes = encode({ type: 'update', update });
      const announced = state.announcedMaxBytes;

      // Refuse BEFORE the write: the server told us its cap, so shipping a
      // bigger frame buys nothing but a 1009. One update alone past the cap
      // can never be shipped — same terminal verdict as a refused resync.
      if (announced !== null && bytes.byteLength > announced) {
        terminate('oversized-update', {
          reason:
            `${docId} cannot be sent: a local update takes ${bytes.byteLength} bytes, ` +
            `and the server takes at most ${announced} bytes per message`,
        });

        return;
      }

      sendBytes(state.socket, bytes);
    });

    state.unhookAwareness = yjs.onAwarenessUpdate((changes, changeOrigin) => {
      if (changeOrigin === origin) {
        return;
      }

      for (const client of [...changes.added, ...changes.updated, ...changes.removed]) {
        state.awarenessClients.add(client);
      }

      scheduleAwareness(false);
    });
  };

  /**
   * Ends one connection generation: unhook the seam, cancel its timers, drop
   * remote presence, and detach (optionally close) the socket. The seam is
   * unhooked BEFORE presence is cleared so the local removals are not broadcast
   * onto a connection that is going away.
   * @param closeSocket - whether to send a normal close (client-initiated ends)
   */
  const teardownGeneration = (closeSocket: boolean): void => {
    state.unhookDoc?.();
    state.unhookDoc = null;
    state.unhookAwareness?.();
    state.unhookAwareness = null;

    state.handshakeTimer = clearTimer(state.handshakeTimer);
    state.firstSyncTimer = clearTimer(state.firstSyncTimer);
    state.awarenessTimer = clearTimer(state.awarenessTimer);
    state.ackTimer = clearTimer(state.ackTimer);
    // Per connection: the in-flight slot, a deferred resync and the once-only
    // residual round all belong to the socket that opened them. `draining` is
    // deliberately NOT reset here — `runDrain`'s own `finally` always restores
    // it, so a second reset would be a line nothing can tell apart.
    state.inFlight = null;
    state.resyncOwed = false;
    state.residual = 'none';
    state.awarenessClients.clear();
    state.awarenessFull = false;

    const socket = state.socket;

    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
    }

    if (socket !== null && closeSocket) {
      try {
        socket.close(CLOSE_NORMAL);
      } catch {
        // Already closed — nothing to do.
      }
    }

    state.socket = null;
    state.origin = null;
    state.buffered = [];
    state.synced = false;
    state.phase = 'offline';

    yjs.clearRemoteAwarenessStates();
  };

  const terminate = (error: CollabTerminalError, detail: CollabStatusDetail = {}): void => {
    teardownGeneration(true);
    state.reconnectTimer = clearTimer(state.reconnectTimer);
    state.phase = 'terminal';
    report('error', { ...detail, error });
  };

  /**
   * Exponential backoff with jitter, capped at 30s. A policy close (1008) costs
   * two steps instead of one — the server is telling us we are too loud.
   * @param code - the close code that triggered the retry, if any
   */
  const nextDelayMs = (code: number | undefined): number => {
    state.attempt += code === CLOSE_POLICY_VIOLATION ? 2 : 1;

    if (code === CLOSE_GOING_AWAY && state.attempt === 1) {
      return SHORT_RECONNECT_MS;
    }

    const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (state.attempt - 1));

    return Math.round(ceiling * (0.5 + random() * 0.5));
  };

  // Forward reference: the reconnect timer restarts the connect cycle.
  const cycle: { open: () => void } = { open: (): void => undefined };

  const scheduleReconnect = (code: number | undefined, reason: string | undefined): void => {
    const delay = nextDelayMs(code);

    report('offline', { code, reason, retryInMs: delay });

    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      cycle.open();
    }, delay);
  };

  /**
   * Moves every pending row of `lineage` out of the outbox, with a recovery
   * snapshot beside them, because nothing stamped with it can be sent any more.
   *
   * The FLUSH comes first. The coalescing write buffer may still hold the last
   * thing typed, and the Collaboration module's lifetime capture tap turns that
   * flush into an `appendLocal`. Quarantining before it would leave that edit
   * behind, stamped with a lineage nothing will ever drain — and the outbox's
   * write queue is serial, so the append the flush provokes is already ahead of
   * this call. The snapshot is taken after the flush for the same reason: it is
   * the recovery copy, and it has to contain what was just typed.
   * @param lineage - the lineage to empty
   * @param reason - a fixed string, or a codec-validated rejection code; never
   * text a peer wrote
   * @returns whether the move committed — a caller that goes on to read the
   * outbox has to know, because a failure leaves the rows in place
   */
  const quarantineTail = async (lineage: string, reason: string): Promise<boolean> => {
    const outbox = options.outbox;

    if (outbox === undefined) {
      return false;
    }

    try {
      yjs.flushPendingWrites?.();
      await outbox.quarantineLineage(lineage, reason, yjs.encodeStateAsUpdate());

      return true;
    } catch (thrown) {
      logLabeled(`collaboration could not quarantine the pending operations of ${docId}`, 'error', thrown);
      options.onOutboxFailure?.(thrown);

      return false;
    }
  };

  /**
   * Discards the document and asks for the room again — the second half of a
   * relineage, once nothing of the old lineage is left to strand.
   * @param code - the close code that triggered it, if any
   * @param reason - human explanation for the status detail
   */
  const finishRelineage = (code: number | undefined, reason: string): void => {
    yjs.resetForRelineage();

    // Load-bearing: the next control frame announces the NEW lineage, and a
    // remembered old one would mismatch against it and reset forever.
    state.lineage = null;
    state.tag = null;

    scheduleReconnect(code, reason);
  };

  /**
   * The room's history is not ours any more — a control frame announcing a new
   * lineage, or the server closing with 4409.
   *
   * Discard our document for a genuinely fresh one and reconnect. It is NEVER
   * continued on the same socket: this connection already sent a SyncStep1 for
   * the state vector we just threw away, so the server's answer would be a diff
   * against history that no longer exists here. A new connection re-does the
   * handshake from an empty state vector and receives the room whole.
   *
   * Always through `scheduleReconnect`, never `openGeneration` — a server that
   * announces a fresh lineage every time would otherwise spin without backoff.
   * @param code - the close code that triggered it, if any
   * @param reason - human explanation for the status detail
   */
  const relineage = (code: number | undefined, reason: string): void => {
    const lineage = state.lineage;

    // No outbox (a v1 session), or a boot that never learned a lineage: nothing
    // is journalled under it, so the reset stays exactly as synchronous as it
    // has always been. NOT gated on `state.protocol`: a control frame that
    // mismatches is compared BEFORE the selected subprotocol is read, so a
    // cache-adopted boot holding v2 rows would still read 'v1' here.
    if (options.outbox === undefined || lineage === null) {
      finishRelineage(code, reason);

      return;
    }

    // The reconnect waits for the preparation. The phase keeps `connect()` out
    // while it runs: 'offline' would let a host open a generation on a document
    // that is still being discarded.
    state.phase = 'relineage';

    const generation = state.generation;

    // Unconditional on the outcome, deliberately. Refusing to finish would park
    // the provider in 'relineage' with no socket and no reconnect — a silent
    // wedge. A quarantine that did not commit leaves old-lineage rows behind
    // (the store ends the session before its transaction and does not roll that
    // back), and `runDrain`'s stale-lineage guard is what stops those reaching
    // the wire.
    void quarantineTail(lineage, RELINEAGE_REASON).then(() => {
      if (isStale(generation)) {
        return;
      }

      finishRelineage(code, reason);
    });
  };

  /**
   * Writes one operation frame (type 102) and starts its acknowledgement
   * deadline.
   * @param socket - the live transport
   * @param row - the oldest pending outbox row
   */
  const sendOperation = (socket: WebSocketLike, row: CollabOutboxRow): void => {
    const bytes = encode({
      type: 'operation',
      lineage: row.lineage,
      operationId: row.operationId,
      update: row.bytes,
    });
    const announced = state.announcedMaxBytes;

    // Measured on the FRAMED operation, not on the bare update: the metadata
    // section and the two length prefixes ride the same message, and the
    // server's cap counts the message.
    if (announced !== null && bytes.byteLength > announced) {
      // Quarantined, not terminal, and not retried: the row is DURABLE, so a
      // session that ended here would adopt it on the next boot and end again.
      // Same verdict the server's own `oversized-update` rejection carries.
      void quarantineTail(row.lineage, OVERSIZED_REASON);

      return;
    }

    sendBytes(socket, bytes);
    state.inFlight = { operationId: row.operationId, lineage: row.lineage };
    state.ackTimer = setTimeout(() => {
      state.ackTimer = null;
      teardownGeneration(true);
      scheduleReconnect(undefined, `${docId} did not acknowledge an operation`);
    }, ACK_TIMEOUT_MS);
  };

  /**
   * Protocol section 7.1 step 4: the outbox is empty, so ask for a fresh server
   * state vector and envelope whatever local history it turns out to be
   * missing. Once per connection — the server answers every SyncStep1 with one
   * of its own, and a second round would ping-pong for the life of the socket.
   * @param socket - the live transport
   */
  const requestResidualSync = (socket: WebSocketLike): void => {
    if (!state.resyncOwed || state.residual !== 'none') {
      return;
    }

    state.resyncOwed = false;
    state.residual = 'requested';
    send(socket, { type: 'syncStep1', stateVector: yjs.getStateVector() });
  };

  /**
   * One drain pass: re-read the oldest pending row and put it on the wire.
   *
   * The row is re-read every time rather than held in a queue, because another
   * tab writes into the same store and may have added or deleted rows since the
   * last pass.
   */
  const runDrain = async (): Promise<void> => {
    const outbox = options.outbox;

    if (
      outbox === undefined ||
      state.draining ||
      state.socket === null ||
      state.phase !== 'ready' ||
      state.protocol !== 'v2' ||
      // An operation before our own first sync draws `not-synced`.
      !state.synced ||
      state.inFlight !== null
    ) {
      return;
    }

    state.draining = true;

    const generation = state.generation;

    try {
      const row = await outbox.oldestPending();
      const socket = state.socket;

      // Everything below belongs to the connection that started the pass.
      if (isStale(generation) || state.phase !== 'ready' || socket === null) {
        return;
      }

      if (row === null) {
        requestResidualSync(socket);

        return;
      }

      // A row of a lineage this session no longer serves. It exists only after a
      // quarantine that did not commit, and sending it is an unbounded loop: the
      // server answers `lineage-mismatch`, that relineage quarantines the
      // CURRENT lineage and moves nothing, reconnect, repeat — with no terminal
      // state and nothing the user can see. A bare `return` is NOT the fix
      // either: the row stays `oldestPending`'s answer and wedges the drain for
      // the session. Its OWN lineage has to go.
      if (row.lineage !== state.lineage) {
        void quarantineTail(row.lineage, STALE_LINEAGE_REASON).then((moved) => {
          // Only on a move that committed: re-waking after a failure would read
          // the same row back and spin.
          if (moved && !isStale(generation)) {
            drain();
          }
        });

        return;
      }

      sendOperation(socket, row);
    } catch (thrown) {
      logLabeled(`collaboration could not drain the outbox of ${docId}`, 'error', thrown);
    } finally {
      state.draining = false;
    }
  };

  const drain = (): void => {
    void runDrain();
  };

  /**
   * A server SyncStep1 on a v2 connection. The client NEVER answers one with a
   * raw SyncStep2 (protocol section 7): that frame carries no operation id, so
   * the server can neither acknowledge nor reject it, and it would put pending
   * offline work on the wire outside its envelope. While operations are pending
   * the frame is ignored and the outbox drains instead; once none are left the
   * client asks again and envelopes the residual diff as one more operation.
   * @param stateVector - what the server says it already has
   */
  const handleResync = (stateVector: Uint8Array): void => {
    const outbox = options.outbox;

    if (state.residual !== 'requested') {
      state.resyncOwed = true;
      drain();

      return;
    }

    state.residual = 'done';

    const residual = yjs.encodeStateAsUpdate(stateVector);

    // Everything the server already has encodes as varUint(0) twice; enveloping
    // that would journal an empty operation on every v2 connection.
    if (outbox === undefined || residual.byteLength <= EMPTY_UPDATE_BYTES) {
      return;
    }

    const generation = state.generation;

    // The ONLY path by which edits cached under an earlier v1 session — stored
    // with no outbox row — reach a server that has since gained a durable store.
    void outbox.appendLocal(residual).then(
      () => {
        if (isStale(generation)) {
          return;
        }

        drain();
      },
      (thrown: unknown) => {
        logLabeled(`collaboration could not journal the residual state of ${docId}`, 'error', thrown);
        options.onOutboxFailure?.(thrown);
      }
    );
  };

  /**
   * Frame 103. The lineage must be ours; the id may name any row in the store,
   * because another tab submits from the same outbox — so the deletion is by
   * exact id and an id no row carries is a no-op. Only an acknowledgement of the
   * operation WE have on the wire releases the in-flight slot: releasing it on
   * another tab's would put a second operation out while the first is unanswered.
   *
   * `serverSequence` needs nothing more from us: the codec already refuses
   * anything but a decimal string of at least 1 (decoder rule 12). It is
   * deliberately NOT required to increase — a re-sent operation is answered with
   * its ORIGINAL acknowledgement (section 7.2), so a monotonicity rule would
   * refuse a legitimate duplicate.
   *
   * Gated on the negotiated protocol, unlike `relineage`: a v1 session claimed
   * no durability (section 2) and may retire nothing, and reading the protocol
   * here is safe because `onmessage` drops 103/104 arriving BEFORE the control
   * frame, which is the frame that reads it.
   * @param frame - the decoded acknowledgement
   */
  const handleAcknowledgement = (frame: Extract<SyncWireFrame, { type: 'acknowledgement' }>): void => {
    const outbox = options.outbox;

    if (outbox === undefined || state.protocol !== 'v2' || state.lineage === null || frame.lineage !== state.lineage) {
      return;
    }

    if (state.inFlight?.operationId === frame.operationId) {
      state.inFlight = null;
      state.ackTimer = clearTimer(state.ackTimer);
    }

    const generation = state.generation;

    // The next operation waits for the deletion to COMMIT: draining first would
    // re-read a row this acknowledgement has already retired.
    void outbox.acknowledge(frame.operationId).then(
      () => {
        if (isStale(generation)) {
          return;
        }

        drain();
      },
      (thrown: unknown) => {
        logLabeled(`collaboration could not delete an acknowledged operation of ${docId}`, 'error', thrown);
      }
    );
  };

  /**
   * Frame 104. The codes are an OPEN set (protocol section 6): an unrecognised
   * one is FINAL, because treating it as malformed would leave the row in the
   * outbox to be redriven and refused forever. The code is the only thing
   * branched on — it is the codec-validated kebab-case token, and a rejection
   * carries no free text at all.
   *
   * Protocol-gated for the same reason frame 103 is: a v1 session sent no
   * operation, so it may act on no verdict about one.
   * @param frame - the decoded rejection
   */
  const handleRejection = (frame: Extract<SyncWireFrame, { type: 'rejection' }>): void => {
    const lineage = state.lineage;

    if (options.outbox === undefined || state.protocol !== 'v2' || lineage === null || frame.lineage !== lineage) {
      return;
    }

    if (state.inFlight?.operationId === frame.operationId) {
      state.inFlight = null;
      state.ackTimer = clearTimer(state.ackTimer);
    }

    if (frame.code === LINEAGE_MISMATCH_CODE) {
      teardownGeneration(true);
      relineage(undefined, `${docId} was reset; its history is not ours`);

      return;
    }

    if (frame.code === TRANSIENT_REJECTION_CODE) {
      // The room was not ready and nothing was judged invalid. We only drain
      // after our OWN first sync, so this is a server-side race: keep every row
      // and let reconnect backoff bound the retry.
      teardownGeneration(true);
      scheduleReconnect(undefined, `${docId} was not ready for an operation`);

      return;
    }

    // Final. The tail goes with it: later updates in this lineage may depend on
    // the rejected one, so sending them alone would apply a dependent edit the
    // server has no base for.
    void quarantineTail(lineage, frame.code);
  };

  const markSynced = (): void => {
    if (state.synced) {
      return;
    }

    // A completed sync is the proof that the ticket is accepted and that this
    // endpoint speaks the protocol, so those counters and the backoff clear
    // here. NOT the size memory: the server sends SyncStep2 BEFORE its own
    // SyncStep1, so clearing the refused bound on the sync let the answer
    // that followed re-ship the refused bytes every time — 1009, reconnect,
    // repeat, never terminal. `answerResync` clears it once an answer ships.
    // The ANNOUNCED cap is never cleared: it is the server's stated fact.
    state.synced = true;
    state.firstSyncTimer = clearTimer(state.firstSyncTimer);
    state.attempt = 0;
    state.unauthorizedSinceSync = 0;
    state.handshakeTimeoutsSinceSync = 0;
    report('connected');

    // A completed sync is what makes a v2 write legal: an operation sent before
    // it is answered `not-synced`.
    drain();
  };

  /**
   * Answers the server's SyncStep1 with everything it is missing — unless that
   * answer is bigger than the cap the server announced, or at least as big as
   * a frame the server has already refused.
   *
   * Without the checks one oversized write ends the session in two rounds with
   * nothing to show for it: the 1009 drops the connection, the reconnect's
   * SyncStep1 draws the server's own SyncStep1, and answering it re-ships the
   * very bytes that were just refused — a second 1009, terminal, and no word
   * about what was too big. The wire carries one y-protocols message per frame
   * (so a large answer cannot be split across frames the server would
   * reassemble), which leaves refusing to write it, and SAYING SO, as the only
   * honest move.
   *
   * The ANNOUNCED cap (the server's limits frame) is consulted first: it is the
   * server's own number, checked with the server's own comparison (strictly
   * larger is refused). A server that announces nothing leaves the LEARNED
   * bound, which is deliberately porous — it is the largest frame we wrote on
   * the refused connection, not the server's real cap, so a frame between the
   * two still ships and still draws the second 1009 through the ordinary path.
   * It is a loop-breaker, not a limit oracle.
   *
   * An answer that ships is what clears the bound and the 1009 count: the
   * stranded bytes either went out or were refused here, and either way the
   * memory has done its job.
   * @param socket - the connection it arrived on
   * @param stateVector - what the server says it already has
   */
  const answerResync = (socket: WebSocketLike, stateVector: Uint8Array): void => {
    const bytes = encode({ type: 'syncStep2', update: yjs.encodeStateAsUpdate(stateVector) });
    const announced = state.announcedMaxBytes;

    if (announced !== null && bytes.byteLength > announced) {
      terminate('oversized-update', {
        reason:
          `${docId} cannot be sent: answering the server's resync takes ${bytes.byteLength} bytes, ` +
          `and the server takes at most ${announced} bytes per message`,
      });

      return;
    }

    const refused = state.refusedFrameBytes;

    if (refused !== null && bytes.byteLength >= refused) {
      terminate('oversized-update', {
        reason:
          `${docId} cannot be sent: answering the server's resync takes ${bytes.byteLength} bytes, ` +
          `and it already refused a frame of ${refused} bytes as too big`,
      });

      return;
    }

    sendBytes(socket, bytes);
    state.refusedFrameBytes = null;
    state.oversizedSinceSync = 0;
  };

  /**
   * Runs one presence frame, dropping it if it throws. Never terminal: the
   * server relays awareness after reading only the client count, so a
   * malformed frame from any pass-holder would otherwise end every other
   * member's session — and a host listener that throws on the peer list rides
   * this same path. Nothing later depends on a presence frame, so a drop
   * stalls nothing.
   * @param apply - the presence work to run
   */
  const dropOnThrow = (apply: () => void): void => {
    try {
      apply();
    } catch (thrown) {
      logLabeled(`collaboration dropped a presence frame for ${docId}`, 'warn', thrown);
    }
  };

  /**
   * Handles one validated frame on a negotiated connection. Only the doc
   * frames may end the session by throwing (see the `onmessage` catch).
   * @param socket - the connection it arrived on
   * @param origin - this generation's origin object
   * @param frame - the decoded frame
   */
  const handleFrame = (socket: WebSocketLike, origin: ProviderOrigin, frame: SyncWireFrame): void => {
    switch (frame.type) {
      case 'syncStep2':
        yjs.applyRemoteUpdate(frame.update, origin);
        markSynced();
        break;
      case 'update':
        yjs.applyRemoteUpdate(frame.update, origin);
        break;
      case 'syncStep1':
        if (state.protocol === 'v2') {
          handleResync(frame.stateVector);
        } else {
          answerResync(socket, frame.stateVector);
        }
        break;
      case 'awareness':
        dropOnThrow(() => yjs.applyAwarenessUpdate(frame.update, origin));
        break;
      case 'queryAwareness':
        dropOnThrow(() => scheduleAwareness(true));
        break;
      case 'permissionDenied':
        // Inert by design: the server simply drops a read-only member's writes,
        // and read-only arbitration is the Collaboration module's job.
        break;
      case 'control':
        // Handled before buffering; a repeat here would already have been validated.
        break;
      case 'limits':
        state.announcedMaxBytes = frame.maxMessageBytes;
        break;
      // blok-sync.v2 (packages/server/protocol/blok-sync-v2.md).
      case 'acknowledgement':
        handleAcknowledgement(frame);
        break;
      case 'rejection':
        handleRejection(frame);
        break;
      case 'operation':
        // Client → server only, and `onmessage` drops it before this; the case
        // stays so a new frame type cannot fall into a silent default.
        break;
    }
  };

  /**
   * Validates the server's first frame, then opens the connection for business.
   * @param socket - the connection it arrived on
   * @param origin - this generation's origin object
   * @param tag - the announced working-set tag
   */
  const handleControl = (socket: WebSocketLike, origin: ProviderOrigin, tag: WorkingSetTag): void => {
    state.handshakeTimer = clearTimer(state.handshakeTimer);

    if (tag.format !== SUPPORTED_FORMAT) {
      terminate('unsupported-format', { reason: `${docId} is stored in format ${tag.format}` });

      return;
    }

    // Lineage only: epoch is captured but never compared here — epoch counts
    // resets, and a peer that missed one still recognises the lineage it holds.
    if (state.lineage !== null && state.lineage !== tag.lineage) {
      // Close first: this connection is negotiated against the history we are
      // about to drop, and the reconnect re-does the handshake from empty.
      teardownGeneration(true);
      relineage(undefined, `${docId} was reset; its history is not ours`);

      return;
    }

    state.lineage = tag.lineage;
    state.tag = tag;
    // Read from the socket, not inferred from the offers: a proxy or an older
    // server may select nothing at all, and that is v1.
    state.protocol = socket.protocol === SYNC_SUBPROTOCOL_V2 ? 'v2' : 'v1';

    // A repeat control frame on a live connection must not hook the seam twice —
    // that would broadcast every local edit once per hook.
    if (state.phase === 'ready') {
      return;
    }

    state.phase = 'ready';

    hookSeam(origin);

    const buffered = state.buffered;

    state.buffered = [];

    for (const frame of buffered) {
      // A refused resync answer ends the session by RETURNING, not by throwing,
      // so the loop has to notice: the rest of the buffer belongs to a
      // connection that no longer exists, and applying a syncStep2 from it
      // would report 'connected' after 'error' — un-latching a terminal state
      // the module treats as the provider's last word.
      if (state.phase !== 'ready') {
        break;
      }

      handleFrame(socket, origin, frame);
    }

    // Everything below belongs to a LIVE connection, and the drain may have
    // ended this one — arming a deadline on a terminated provider would raise
    // it from the dead ten seconds later.
    if (state.phase !== 'ready') {
      return;
    }

    // Re-announce our own presence to a server that has never heard it.
    if (yjs.getAwarenessStates().size > 0) {
      scheduleAwareness(true);
    }

    // AFTER the drain: a buffered SyncStep2 completes the sync right here, and
    // `markSynced` is what disarms this. Validating a control frame is not a
    // sync — nothing else re-arms a deadline once the handshake timer is
    // cleared, so without this the client sits in `connecting` forever when the
    // first sync never lands: read-only, empty, no reconnect, and no degrade
    // view (that runs on offline/error only).
    // Distinct from the phase guard above: a drain that COMPLETED the sync
    // leaves the phase 'ready', so only this check stops a deadline being armed
    // on a connection that is already live.
    if (!state.synced) {
      state.firstSyncTimer = setTimeout(() => {
        state.firstSyncTimer = null;
        teardownGeneration(true);

        // Offline, not terminal: the control frame PROVED this is a Blok sync
        // endpoint, so silence after it is a server fault that may heal — the
        // same reading as a dropped connection, and it shows the degrade view.
        scheduleReconnect(undefined, `${docId} validated the handshake but sent no first sync`);
      }, handshakeTimeoutMs);
    }
  };

  /**
   * Holds one frame that arrived before the control frame.
   *
   * At the cap the connection is DROPPED rather than the frame: Yjs parks every
   * later update on a missing dependency, so a silent drop leaves a document
   * that stalls with nothing to show for it. The reconnect re-does the handshake
   * from a state vector, which the server answers whole — the stall heals.
   * @param frame - the frame to hold until the control frame validates
   */
  const bufferInbound = (frame: SyncWireFrame): void => {
    if (state.buffered.length >= MAX_BUFFERED_INBOUND) {
      teardownGeneration(true);
      scheduleReconnect(undefined, `${docId} sent more than ${MAX_BUFFERED_INBOUND} frames before its control frame`);

      return;
    }

    state.buffered.push(frame);
  };

  /**
   * Applies the close-code policy. The counters here run since the last
   * proof that clears them — a completed sync for the ticket count
   * ({@link markSynced}), a shipped resync answer for the size count and the
   * refused-frame bound beside it ({@link answerResync}). An unrelated close
   * in between (a dropped connection, a restart) says nothing about whether
   * the ticket is accepted or our frames fit, and clearing the count on one
   * let a flapping server hide a permanently rejected ticket forever.
   * @param code - the WebSocket close code
   * @param reason - the close reason, for the status detail
   */
  const handleClose = (code: number, reason: string): void => {
    teardownGeneration(false);

    if (code === CLOSE_MESSAGE_TOO_BIG) {
      state.oversizedSinceSync += 1;

      // The close names no frame, so the largest one we wrote is the estimate.
      // `> 0` is load-bearing: a 1009 on a connection we never wrote to says
      // nothing about our frames, and a bound of zero would refuse every
      // resync answer for the rest of the session.
      if (state.largestSentBytes > 0) {
        state.refusedFrameBytes = Math.min(state.refusedFrameBytes ?? Infinity, state.largestSentBytes);
      }
    }

    if (code === CLOSE_UNAUTHORIZED) {
      state.unauthorizedSinceSync += 1;
    }

    const terminalError = TERMINAL_CLOSE_CODES[code];

    if (terminalError !== undefined) {
      terminate(terminalError, { code, reason });

      return;
    }

    if (code === CLOSE_LINEAGE_RESET) {
      relineage(code, reason);

      return;
    }

    if (code === CLOSE_UNAUTHORIZED && state.unauthorizedSinceSync > 1) {
      terminate('unauthorized', { code, reason });

      return;
    }

    if (code === CLOSE_MESSAGE_TOO_BIG && state.oversizedSinceSync > 1) {
      terminate('oversized-update', { code, reason });

      return;
    }

    if (code === CLOSE_UNAUTHORIZED) {
      state.forceTicketRefresh = true;
    }

    scheduleReconnect(code, reason);
  };

  /**
   * The control frame never came — the socket never opened, or it opened and
   * the server sent nothing.
   *
   * Retried like any other transient failure rather than ended outright: this
   * is an inference from silence, not the server's verdict, and a cold start or
   * a buffering proxy is indistinguishable from an endpoint that does not speak
   * the protocol. A server that refuses the connection altogether is retried
   * forever, so a merely SLOW one must not lose the session in ten seconds.
   * Only a run of them says the endpoint is wrong.
   */
  const handleHandshakeTimeout = (): void => {
    state.handshakeTimeoutsSinceSync += 1;

    const reason = `${url} sent no control frame`;

    if (state.handshakeTimeoutsSinceSync >= MAX_HANDSHAKE_TIMEOUTS_SINCE_SYNC) {
      terminate('handshake-timeout', { reason });

      return;
    }

    teardownGeneration(true);
    scheduleReconnect(undefined, reason);
  };

  /**
   * Attaches the transport for one generation and sends the ONLY frame that may
   * precede the control frame.
   * @param generation - the generation this socket belongs to
   * @param token - the connection ticket, if the host mints them
   */
  const openSocket = (generation: number, token: string | null): void => {
    const offers = subprotocolOffers(options.outbox);
    const protocols = token === null ? offers : [...offers, token];

    // The try covers the factory call ALONE: a throw while attaching handlers
    // would leave a half-wired socket in `state`, which is the strand this
    // guards against in the first place.
    const attempt = ((): { socket: WebSocketLike } | { failure: string } => {
      try {
        return { socket: socketFactory(url, protocols) };
      } catch (thrown) {
        return { failure: thrown instanceof Error ? thrown.message : `${url} could not be opened` };
      }
    })();

    if (!('socket' in attempt)) {
      // A factory that throws (CSP, a bad URL, an exhausted transport) is a
      // FAILED CONNECTION, not a dead provider — same recovery as a ticket that
      // could not be minted. Without this the reconnect timer's callback throws,
      // the phase stays 'connecting', and `connect()` refuses forever.
      state.phase = 'offline';
      scheduleReconnect(undefined, attempt.failure);

      return;
    }

    const socket = attempt.socket;
    const origin: ProviderOrigin = { provider: 'blok-collab' };

    socket.binaryType = 'arraybuffer';
    state.socket = socket;
    state.origin = origin;
    state.phase = 'awaiting-control';
    state.buffered = [];
    state.largestSentBytes = 0;
    // Per connection: the cap belongs to the server that announced it, and the
    // next connection may reach a different one. It re-learns from the next
    // limits frame; a server that sends none leaves the learned-bound fallback.
    state.announcedMaxBytes = null;

    // Armed at creation, not at `onopen`: browsers put no deadline on the
    // opening handshake, so a server that accepts the TCP connection and never
    // completes the upgrade would otherwise park the client in `connecting`
    // for good.
    state.handshakeTimer = setTimeout(() => {
      state.handshakeTimer = null;
      handleHandshakeTimeout();
    }, handshakeTimeoutMs);

    socket.onopen = (): void => {
      if (isStale(generation)) {
        return;
      }

      // A state vector carries no history, so it is safe before validation.
      send(socket, { type: 'syncStep1', stateVector: yjs.getStateVector() });
    };

    socket.onmessage = (event): void => {
      if (isStale(generation)) {
        return;
      }

      try {
        const bytes = toBytes(event.data);
        const frame = bytes === null ? null : decode(bytes);

        // `unknown` is forward compatibility; `malformed` is a frame we refuse to
        // guess at; `operation` is a client→server frame a server has no
        // business sending. None is worth dropping the connection over.
        if (frame === null || frame.type === 'unknown' || frame.type === 'malformed' || frame.type === 'operation') {
          return;
        }

        if (frame.type === 'control') {
          handleControl(socket, origin, frame.tag);

          return;
        }

        const beforeControl = state.phase === 'awaiting-control';

        // A v2 acknowledgement or rejection names a lineage the control frame
        // has not announced yet, so there is nothing to check it against.
        // DROPPED rather than buffered: buffering would count them toward
        // MAX_BUFFERED_INBOUND, and a peer sending 64+ would force a teardown
        // and a reconnect over frames that mean nothing here.
        if (beforeControl && (frame.type === 'acknowledgement' || frame.type === 'rejection')) {
          return;
        }

        if (beforeControl) {
          bufferInbound(frame);

          return;
        }

        handleFrame(socket, origin, frame);
      } catch (thrown) {
        // The seam could not materialise a DOC frame (presence frames are
        // dropped inside `handleFrame`). The same frame would throw again on a
        // retry, and skipping it parks every later update on the one that is
        // missing — so the document wedges either way. End the session
        // instead: an editor whose document never loaded must not look live.
        logLabeled(`collaboration could not apply a frame for ${docId}`, 'error', thrown);
        terminate('apply-failed', {
          reason: thrown instanceof Error ? thrown.message : `${docId} could not apply a frame`,
        });
      }
    };

    socket.onclose = (event): void => {
      if (isStale(generation)) {
        return;
      }

      handleClose(event.code, event.reason);
    };

    // A transport error is always followed by a close; the close handler decides.
    socket.onerror = (): void => undefined;
  };

  const openGeneration = (): void => {
    if (state.destroyed) {
      return;
    }

    state.generation += 1;
    state.phase = 'connecting';

    // At CONNECT, not at handshake: the seam drops setAwarenessField silently
    // while awareness is off, so presence set during the handshake window would
    // be lost. Idempotent, and still lazy — no provider means no Awareness.
    yjs.enableAwareness();

    const generation = state.generation;
    const forceRefresh = state.forceTicketRefresh;

    state.forceTicketRefresh = false;
    report('connecting');

    if (ticketSource === undefined) {
      openSocket(generation, null);

      return;
    }

    void ticketSource(forceRefresh ? { forceRefresh: true } : undefined).then(
      (token) => {
        if (isStale(generation)) {
          return;
        }

        openSocket(generation, token);
      },
      (error: unknown) => {
        if (isStale(generation)) {
          return;
        }

        state.phase = 'offline';
        scheduleReconnect(undefined, error instanceof Error ? error.message : 'the ticket could not be minted');
      }
    );
  };

  cycle.open = openGeneration;

  // Another tab's commit is the only outbox change this provider does not cause
  // itself; its own tab's appends are woken by `drain()` from the module.
  const unhookCommitted = options.outbox?.onCommitted(() => drain()) ?? null;

  return {
    connect: (): void => {
      if (state.destroyed || state.phase === 'terminal') {
        return;
      }

      // Idempotent: a live or pending connection is left alone.
      if (state.phase !== 'idle' && state.phase !== 'offline') {
        return;
      }

      if (state.reconnectTimer !== null) {
        return;
      }

      openGeneration();
    },
    destroy: (): void => {
      if (state.destroyed) {
        return;
      }

      // Set first: every continuation and every report checks it.
      state.destroyed = true;
      unhookCommitted?.();
      teardownGeneration(true);
      state.reconnectTimer = clearTimer(state.reconnectTimer);
      state.phase = 'terminal';
    },
    get status(): CollabStatus {
      return state.status;
    },
    get tag(): WorkingSetTag | null {
      return state.tag;
    },
    get protocol(): SessionProtocol {
      return state.protocol;
    },
    drain: (): void => {
      drain();
    },
  };
}
