import { decode, encode } from './sync-wire';
import type {
  CollabProvider,
  CollabProviderOptions,
  CollabSocketFactory,
  CollabStatus,
  CollabStatusDetail,
  CollabTerminalError,
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

/** Subprotocol every Blok client offers; the server echoes it in every auth mode. */
const SYNC_SUBPROTOCOL = 'blok-sync.v1';

/** CRDT schema this client speaks. A control frame naming another is terminal. */
const SUPPORTED_FORMAT = 1;

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_AWARENESS_THROTTLE_MS = 100;

const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30_000;

/** A planned restart is back within moments; do not make the user wait a second. */
const SHORT_RECONNECT_MS = 250;

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
  readonly generation: number;
}

type Phase = 'idle' | 'connecting' | 'awaiting-control' | 'ready' | 'offline' | 'terminal';

interface ProviderState {
  /** Bumped per connection attempt; every async continuation checks it. */
  generation: number;
  phase: Phase;
  status: CollabStatus;
  socket: WebSocketLike | null;
  origin: ProviderOrigin | null;
  tag: WorkingSetTag | null;
  /** Lineage of the FIRST control frame; later frames are compared against it. */
  lineage: string | null;
  buffered: SyncWireFrame[];
  unhookDoc: (() => void) | null;
  unhookAwareness: (() => void) | null;
  handshakeTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  awarenessTimer: ReturnType<typeof setTimeout> | null;
  awarenessClients: Set<number>;
  /** A queryAwareness reply (or a reconnect) needs every state, not just the deltas. */
  awarenessFull: boolean;
  attempt: number;
  consecutiveUnauthorized: number;
  consecutiveOversized: number;
  forceTicketRefresh: boolean;
  synced: boolean;
  destroyed: boolean;
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
    tag: null,
    lineage: null,
    buffered: [],
    unhookDoc: null,
    unhookAwareness: null,
    handshakeTimer: null,
    reconnectTimer: null,
    awarenessTimer: null,
    awarenessClients: new Set<number>(),
    awarenessFull: false,
    attempt: 0,
    consecutiveUnauthorized: 0,
    consecutiveOversized: 0,
    forceTicketRefresh: false,
    synced: false,
    destroyed: false,
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
   * Writes one frame. A socket that died between the check and the write throws;
   * the close handler owns recovery, so there is nothing useful to do here.
   * @param socket - the live transport
   * @param frame - the frame to write
   */
  const send = (socket: WebSocketLike, frame: SyncWireFrame): void => {
    try {
      socket.send(encode(frame));
    } catch {
      // Intentionally inert: `onclose` drives reconnection.
    }
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
      if (updateOrigin === origin || state.socket === null || state.phase !== 'ready') {
        return;
      }

      send(state.socket, { type: 'update', update });
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
   * Closes a socket that may already be gone; a throw here means it was.
   * @param socket - the transport to close
   */
  const closeQuietly = (socket: WebSocketLike): void => {
    try {
      socket.close(CLOSE_NORMAL);
    } catch {
      // Already closed — nothing to do.
    }
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
    state.awarenessTimer = clearTimer(state.awarenessTimer);
    state.awarenessClients.clear();
    state.awarenessFull = false;

    const socket = state.socket;

    if (socket !== null) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;

      if (closeSocket) {
        closeQuietly(socket);
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
    yjs.resetForRelineage();

    // Load-bearing: the next control frame announces the NEW lineage, and a
    // remembered old one would mismatch against it and reset forever.
    state.lineage = null;
    state.tag = null;

    scheduleReconnect(code, reason);
  };

  const markSynced = (): void => {
    if (state.synced) {
      return;
    }

    // A completed sync clears every consecutive-failure counter, not just the
    // backoff: the 4401-retry-once and 1009-twice rules are both consecutive.
    state.synced = true;
    state.attempt = 0;
    state.consecutiveUnauthorized = 0;
    state.consecutiveOversized = 0;
    report('connected');
  };

  /**
   * Handles one validated frame on a negotiated connection.
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
        send(socket, { type: 'syncStep2', update: yjs.encodeStateAsUpdate(frame.stateVector) });
        break;
      case 'awareness':
        yjs.applyAwarenessUpdate(frame.update, origin);
        break;
      case 'queryAwareness':
        scheduleAwareness(true);
        break;
      case 'permissionDenied':
        // Inert by design: the server simply drops a read-only member's writes,
        // and read-only arbitration is the Collaboration module's job.
        break;
      case 'control':
        // Handled before buffering; a repeat here would already have been validated.
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
      handleFrame(socket, origin, frame);
    }

    // Re-announce our own presence to a server that has never heard it.
    if (yjs.getAwarenessStates().size > 0) {
      scheduleAwareness(true);
    }
  };

  /**
   * Applies the close-code policy. Every counter here is CONSECUTIVE: a close of
   * a different code resets it, and so does a completed sync.
   * @param code - the WebSocket close code
   * @param reason - the close reason, for the status detail
   */
  const handleClose = (code: number, reason: string): void => {
    teardownGeneration(false);

    state.consecutiveOversized = code === CLOSE_MESSAGE_TOO_BIG ? state.consecutiveOversized + 1 : 0;
    state.consecutiveUnauthorized = code === CLOSE_UNAUTHORIZED ? state.consecutiveUnauthorized + 1 : 0;

    const terminalError = TERMINAL_CLOSE_CODES[code];

    if (terminalError !== undefined) {
      terminate(terminalError, { code, reason });

      return;
    }

    if (code === CLOSE_LINEAGE_RESET) {
      relineage(code, reason);

      return;
    }

    if (code === CLOSE_UNAUTHORIZED && state.consecutiveUnauthorized > 1) {
      terminate('unauthorized', { code, reason });

      return;
    }

    if (code === CLOSE_MESSAGE_TOO_BIG && state.consecutiveOversized > 1) {
      terminate('oversized-update', { code, reason });

      return;
    }

    if (code === CLOSE_UNAUTHORIZED) {
      state.forceTicketRefresh = true;
    }

    scheduleReconnect(code, reason);
  };

  /**
   * Attaches the transport for one generation and sends the ONLY frame that may
   * precede the control frame.
   * @param generation - the generation this socket belongs to
   * @param token - the connection ticket, if the host mints them
   */
  const openSocket = (generation: number, token: string | null): void => {
    const protocols = token === null ? [SYNC_SUBPROTOCOL] : [SYNC_SUBPROTOCOL, token];
    const socket = socketFactory(url, protocols);
    const origin: ProviderOrigin = { provider: 'blok-collab', generation };

    socket.binaryType = 'arraybuffer';
    state.socket = socket;
    state.origin = origin;
    state.phase = 'awaiting-control';
    state.buffered = [];

    socket.onopen = (): void => {
      if (isStale(generation)) {
        return;
      }

      // A state vector carries no history, so it is safe before validation.
      send(socket, { type: 'syncStep1', stateVector: yjs.getStateVector() });

      state.handshakeTimer = setTimeout(() => {
        state.handshakeTimer = null;
        terminate('handshake-timeout', { reason: `${url} sent no control frame` });
      }, handshakeTimeoutMs);
    };

    socket.onmessage = (event): void => {
      if (isStale(generation)) {
        return;
      }

      const bytes = toBytes(event.data);
      const frame = bytes === null ? null : decode(bytes);

      // `unknown` is forward compatibility; `malformed` is a frame we refuse to
      // guess at. Neither is worth dropping the connection over.
      if (frame === null || frame.type === 'unknown' || frame.type === 'malformed') {
        return;
      }

      if (frame.type === 'control') {
        handleControl(socket, origin, frame.tag);

        return;
      }

      if (state.phase === 'awaiting-control') {
        if (state.buffered.length < MAX_BUFFERED_INBOUND) {
          state.buffered.push(frame);
        }

        return;
      }

      handleFrame(socket, origin, frame);
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
  };
}
