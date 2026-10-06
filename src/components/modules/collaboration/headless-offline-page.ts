import { createOperationStore } from './operation-store';
import { createCollabProvider } from './provider';
import type { CollabDocSeam, CollabProvider, CollabSocketFactory, CollabTicketSource } from './types';
import { DocumentStore } from '../yjs/document-store';
import { YBlockSerializer } from '../yjs/serializer';

export interface DownloadOfflinePageInput {
  url: string;
  doc: string;
  offlineScope: string;
  ticket?: CollabTicketSource;
  signal?: AbortSignal;
  socketFactory?: CollabSocketFactory;
}

export interface DownloadOfflinePageResult {
  url: string;
  doc: string;
  lineage: string;
}

export async function downloadOfflinePage(input: DownloadOfflinePageInput): Promise<DownloadOfflinePageResult> {
  if (input.signal?.aborted) {
    throw input.signal.reason;
  }

  const store = createOperationStore({
    url: input.url,
    doc: input.doc,
    offlineScope: input.offlineScope,
  });
  const document = new DocumentStore(new YBlockSerializer());
  const recordingAbort = new AbortController();
  const state: {
    provider: CollabProvider | null;
    finished: boolean;
    recording: boolean;
    timer: ReturnType<typeof setTimeout> | undefined;
  } = {
    provider: null,
    finished: false,
    recording: false,
    timer: undefined,
  };

  try {
    const previous = await store.open();

    if ((await store.stats()).storageUnavailable) {
      throw new Error('Offline storage is unavailable');
    }

    if (input.signal?.aborted) {
      throw input.signal.reason;
    }

    return await new Promise<DownloadOfflinePageResult>((resolve, reject) => {
      const cleanup = (): void => {
        if (state.timer !== undefined) {
          clearTimeout(state.timer);
        }
        input.signal?.removeEventListener('abort', abort);
      };
      const fail = (reason: unknown): void => {
        if (state.finished) {
          return;
        }
        state.finished = true;
        cleanup();
        reject(reason);
      };
      const complete = (value: DownloadOfflinePageResult): void => {
        if (state.finished) {
          return;
        }
        state.finished = true;
        cleanup();
        resolve(value);
      };
      const abort = (): void => {
        const reason: unknown = input.signal?.reason ?? new Error('Offline download aborted');

        recordingAbort.abort(reason);
        if (!state.recording) {
          fail(reason);
        }
      };

      state.timer = setTimeout(() => fail(new Error('Offline download timed out before sync')), 15_000);
      input.signal?.addEventListener('abort', abort, { once: true });
      if (input.signal?.aborted) {
        abort();

        return;
      }

      const seam: CollabDocSeam = {
        applyRemoteUpdate: (update, origin) => document.applyRemoteUpdate(update, origin),
        onDocUpdate: callback => document.onUpdate(callback),
        onAnyDocUpdate: callback => document.onAnyUpdate(callback),
        getStateVector: () => document.getStateVector(),
        encodeStateAsUpdate: stateVector => document.encodeStateAsUpdate(stateVector),
        enableAwareness: () => document.enableAwareness(),
        setAwarenessField: (field, value) => document.setAwarenessField(field, value),
        getAwarenessStates: () => document.getAwarenessStates(),
        onAwarenessChange: callback => document.onAwarenessChange(callback),
        onAwarenessUpdate: callback => document.onAwarenessUpdate(callback),
        encodeAwarenessUpdate: clients => document.encodeAwarenessUpdate(clients),
        encodeLocalAwarenessDeparture: () => document.encodeLocalAwarenessDeparture(),
        applyAwarenessUpdate: (update, origin) => document.applyAwarenessUpdate(update, origin),
        clearRemoteAwarenessStates: () => document.clearRemoteAwarenessStates(),
        resetForRelineage: () => {
          document.resetForRelineage();
          fail(new Error('Offline download stopped after a lineage reset'));
        },
        flushPendingWrites: () => {},
      };

      try {
        const provider = createCollabProvider({
          url: input.url,
          docId: input.doc,
          yjs: seam,
          ticketSource: input.ticket,
          socketFactory: input.socketFactory,
          initialLineage: previous?.meta.lineage,
          onStatus: (status, detail) => {
            if (state.finished) {
              return;
            }

            if (status === 'error') {
              const reason = new Error(detail?.error ?? detail?.reason ?? 'Offline download failed');

              if (state.recording) {
                recordingAbort.abort(reason);
              } else {
                fail(reason);
              }

              return;
            }

            if (state.recording || status !== 'connected') {
              return;
            }

            const synced = state.provider;

            if (synced === null || synced.tag === null) {
              fail(new Error('Offline download connected without a working-set tag'));

              return;
            }

            state.recording = true;
            if (state.timer !== undefined) {
              clearTimeout(state.timer);
              state.timer = undefined;
            }
            const tag = synced.tag;
            const snapshot = document.encodeStateAsUpdate();

            void store.recordSession(tag, true, synced.protocol, snapshot, recordingAbort.signal, true)
              .then(() => {
                if (recordingAbort.signal.aborted) {
                  fail(recordingAbort.signal.reason);
                } else {
                  complete({ url: input.url, doc: input.doc, lineage: tag.lineage });
                }
              }, error => fail(recordingAbort.signal.aborted ? recordingAbort.signal.reason : error));
          },
        });
        state.provider = provider;
        provider.connect();
      } catch (error) {
        fail(error);
      }
    });
  } finally {
    state.provider?.destroy();
    document.destroy();
    await store.close();
  }
}
