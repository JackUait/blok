import { createOperationStore } from './operation-store';
import { createCollabProvider } from './provider';
import { TrackingOutbox } from './tracking-outbox';
import type {
  CollabDocSeam,
  CollabProvider,
  CollabSocketFactory,
  CollabTerminalError,
  CollabTicketSource,
  SessionProtocol
} from './types';
import { DocumentStore } from '../yjs/document-store';
import type { YBlockSerializer } from '../yjs/serializer';

export interface HeadlessRoomInput {
  /** Full sync URL, doc segment included. */
  url: string;
  docId: string;
  /** Built by the caller, so this module never imports `src/view`. */
  serializer: YBlockSerializer;
  socketFactory: CollabSocketFactory;
  ticketSource?: CollabTicketSource;
  writeDenied: boolean;
  syncTimeoutMs?: number;
  /** Aborting before the first sync stops the wait and rejects with the signal's reason. */
  signal?: AbortSignal;
}

export type HeadlessRoomEnd = { reason: 'reset' } | { reason: 'terminal'; error: CollabTerminalError | undefined };

export class HeadlessRoomTimeoutError extends Error {
  constructor() {
    super('The room did not finish its first sync in time');
    this.name = 'HeadlessRoomTimeoutError';
  }
}

export class HeadlessRoomTerminalError extends Error {
  public readonly error: CollabTerminalError | undefined;

  constructor(error: CollabTerminalError | undefined) {
    super(`The room refused the connection: ${error ?? 'unknown'}`);
    this.name = 'HeadlessRoomTerminalError';
    this.error = error;
  }
}

export interface HeadlessRoom {
  readonly store: DocumentStore;
  readonly outbox: TrackingOutbox;
  readonly protocol: SessionProtocol;
  sendActivity(): boolean;
  /** Resolves when every append the write tap started has settled. */
  flushAppends(): Promise<void>;
  /** How many local writes the tap failed to journal. Such a write never reaches the room. */
  appendFailures(): number;
  ended(): HeadlessRoomEnd | null;
  onEnd(listener: (end: HeadlessRoomEnd) => void): () => void;
  close(): Promise<void>;
}

const DEFAULT_SYNC_TIMEOUT_MS = 15_000;

/**
 * A writing, headless room member: downloadOfflinePage's seam plus the
 * Collaboration module's outbox tap. No editor, no DOM.
 * @param input - where the room is and how to reach it
 * @returns the room, once its first sync has completed
 */
export const openHeadlessRoom = async (input: HeadlessRoomInput): Promise<HeadlessRoom> => {
  const store = new DocumentStore(input.serializer);
  const operations = createOperationStore({ url: input.url, doc: input.docId, offlineScope: null });

  await operations.open();
  const outbox = new TrackingOutbox(operations);
  const inflight = new Set<Promise<unknown>>();
  const endListeners = new Set<(end: HeadlessRoomEnd) => void>();
  const state: {
    end: HeadlessRoomEnd | null;
    synced: boolean;
    session: Promise<void>;
    provider: CollabProvider | null;
    appendFailures: number;
  } = {
    end: null,
    synced: false,
    appendFailures: 0,
    session: Promise.resolve(),
    provider: null,
  };

  const finish = (end: HeadlessRoomEnd): void => {
    if (state.end !== null) {
      return;
    }
    state.end = end;
    [...endListeners].forEach((listener) => listener(end));
  };

  const seam: CollabDocSeam = {
    applyRemoteUpdate: (update, origin) => store.applyRemoteUpdate(update, origin),
    onDocUpdate: (callback) => store.onUpdate(callback),
    onAnyDocUpdate: (callback) => store.onAnyUpdate(callback),
    getStateVector: () => store.getStateVector(),
    encodeStateAsUpdate: (stateVector) => store.encodeStateAsUpdate(stateVector),
    enableAwareness: () => store.enableAwareness(),
    setAwarenessField: (field, value) => store.setAwarenessField(field, value),
    getAwarenessStates: () => store.getAwarenessStates(),
    onAwarenessChange: (callback) => store.onAwarenessChange(callback),
    onAwarenessUpdate: (callback) => store.onAwarenessUpdate(callback),
    encodeAwarenessUpdate: (clients) => store.encodeAwarenessUpdate(clients),
    encodeLocalAwarenessDeparture: () => store.encodeLocalAwarenessDeparture(),
    applyAwarenessUpdate: (update, origin) => store.applyAwarenessUpdate(update, origin),
    clearRemoteAwarenessStates: () => store.clearRemoteAwarenessStates(),
    resetForRelineage: () => {
      store.resetForRelineage();
      // The agent session read the old doc; after the swap its view is gone.
      finish({ reason: 'reset' });
    },
    flushPendingWrites: () => {},
  };

  const signal = input.signal;
  const wait: { abort: () => void } = { abort: () => {} };
  const synced = new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);

      return;
    }
    const timer = setTimeout(() => reject(new HeadlessRoomTimeoutError()), input.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS);

    wait.abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', wait.abort, { once: true });
    const provider = createCollabProvider({
      url: input.url,
      docId: input.docId,
      yjs: seam,
      outbox,
      ticketSource: input.ticketSource,
      socketFactory: input.socketFactory,
      onOperationAcknowledged: (serverSequence) => outbox.noteSequence(serverSequence),
      onStatus: (status, detail) => {
        if (status === 'error') {
          clearTimeout(timer);
          if (state.synced) {
            finish({ reason: 'terminal', error: detail?.error });
          } else {
            reject(new HeadlessRoomTerminalError(detail?.error));
          }

          return;
        }
        if (status !== 'connected' || provider.tag === null) {
          return;
        }
        // Rows can only be stamped once the session names a lineage.
        state.session = operations.recordSession(provider.tag, input.writeDenied, provider.protocol);
        if (!state.synced) {
          state.synced = true;
          clearTimeout(timer);
          resolve();
        }
      },
    });

    state.provider = provider;
    provider.connect();
  });

  // onUpdate, never onAnyUpdate: the latter would send peers' work back as ours.
  // Under v1 the provider's own seam hook sends local edits.
  const unhookTap = store.onUpdate((update) => {
    const provider = state.provider;

    if (provider === null || provider.protocol !== 'v2') {
      return;
    }
    const append = state.session
      .then(() => outbox.appendLocal(update))
      .then(() => provider.drain());
    const drop = (): void => {
      inflight.delete(append);
    };

    inflight.add(append);
    // The rejection arm also keeps a failed append from going unhandled.
    append.then(drop, () => {
      state.appendFailures += 1;
      drop();
    });
  });

  const close = async (): Promise<void> => {
    unhookTap();
    state.provider?.destroy();
    store.destroy();
    await operations.close();
  };

  try {
    await synced;
  } catch (thrown) {
    await close();
    throw thrown;
  } finally {
    signal?.removeEventListener('abort', wait.abort);
  }

  const provider = state.provider;

  if (provider === null) {
    throw new HeadlessRoomTerminalError(undefined);
  }

  return {
    store,
    outbox,
    get protocol(): SessionProtocol {
      return provider.protocol;
    },
    sendActivity: () => provider.sendActivity(),
    flushAppends: async () => {
      await Promise.allSettled([...inflight]);
    },
    appendFailures: () => state.appendFailures,
    ended: () => state.end,
    onEnd: (listener) => {
      endListeners.add(listener);

      return () => endListeners.delete(listener);
    },
    close,
  };
};
