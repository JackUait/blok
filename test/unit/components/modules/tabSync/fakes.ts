import * as Y from 'yjs';
import { vi } from 'vitest';

import type { LeaderLock, RawChannel, TabChannel, TabPlatform } from '../../../../../src/components/modules/tabSync/platform';
import type { TabMessage } from '../../../../../src/components/modules/tabSync/messages';

const busy = (): Promise<never> =>
  Promise.reject(new DOMException('LeaderLock is already waiting or holding', 'InvalidStateError'));

/**
 * One in-memory bus per key; delivery is async like BroadcastChannel and skips the sender.
 * Each lock object follows the real LeaderLock contract (platform.ts): one
 * acquisition at a time, and `release()` cancels a pending `queue`.
 */
export const createFakePlatform = (): TabPlatform & { holders: Map<string, number>; openChannels: (key: string) => number } => {
  const buses = new Map<string, Set<(m: TabMessage) => void>>();
  const holders = new Map<string, number>();
  const waiters = new Map<string, Array<() => void>>();
  let nextId = 0;

  return {
    holders,
    openChannels: (key) => buses.get(key)?.size ?? 0,
    rawChannel: (): RawChannel | null => null,
    channel: (key): TabChannel => {
      const listeners = new Set<(m: TabMessage) => void>();
      const bus = buses.get(key) ?? new Set();
      const deliver = (m: TabMessage): void => listeners.forEach((l) => l(structuredClone(m)));

      buses.set(key, bus);
      bus.add(deliver);

      return {
        post: (m) => bus.forEach((d) => {
          if (d !== deliver) {
            queueMicrotask(() => d(m));
          }
        }),
        onMessage: (l) => {
          listeners.add(l);

          return () => listeners.delete(l);
        },
        close: () => {
          bus.delete(deliver);
          listeners.clear();
        },
      };
    },
    lock: (key): LeaderLock => {
      const me = nextId++;
      const state: { phase: 'idle' | 'pending' | 'held'; cancel: (() => void) | null } = { phase: 'idle', cancel: null };

      const handOn = (): void => {
        holders.delete(key);
        waiters.get(key)?.shift()?.();
      };

      return {
        tryAcquire: async () => {
          if (state.phase !== 'idle') {
            return busy();
          }
          if (holders.has(key)) {
            return false;
          }
          holders.set(key, me);
          state.phase = 'held';

          return true;
        },
        queue: (signal) => {
          if (state.phase !== 'idle') {
            return busy();
          }
          if (signal.aborted) {
            return Promise.reject(signal.reason);
          }

          return new Promise<void>((resolve, reject) => {
            const take = (): void => {
              holders.set(key, me);
              state.phase = 'held';
              state.cancel = null;
              resolve();
            };
            const drop = (reason: unknown): void => {
              waiters.set(key, (waiters.get(key) ?? []).filter((w) => w !== take));
              state.phase = 'idle';
              state.cancel = null;
              reject(reason);
            };

            if (!holders.has(key)) {
              take();

              return;
            }
            const line = waiters.get(key) ?? [];

            line.push(take);
            waiters.set(key, line);
            state.phase = 'pending';
            state.cancel = () => drop(new DOMException('LeaderLock released while waiting', 'AbortError'));
            signal.addEventListener('abort', () => {
              if (state.phase === 'pending') {
                drop(signal.reason);
              }
            }, { once: true });
          });
        },
        release: () => {
          if (state.phase === 'pending') {
            state.cancel?.();

            return;
          }
          if (state.phase === 'held' && holders.get(key) === me) {
            state.phase = 'idle';
            handOn();
          }
        },
      };
    },
  };
};

/**
 * A stand-in for the Blok modules TabSync touches, built on a REAL Y.Doc so
 * merge, reset and generation behaviour is the real Yjs behaviour.
 */
export const createFakeBlok = (options: { recordId?: string; minted?: boolean; readOnly?: boolean } = {}) => {
  let doc = new Y.Doc();
  const updateListeners = new Set<(u: Uint8Array, origin: unknown) => void>();
  const remoteOrigins = new Set<unknown>();
  let recordId = options.recordId ?? 'rec-1';
  let minted = options.minted ?? false;
  // Typing still in the block write buffer, not yet in the Y.Doc.
  let buffered = '';
  const land = (): void => {
    if (buffered !== '') {
      doc.getText('t').insert(doc.getText('t').length, buffered);
      buffered = '';
    }
  };

  const bind = (): void => {
    doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (!remoteOrigins.has(origin)) {
        updateListeners.forEach((l) => l(u, origin));
      }
    });
  };

  bind();

  return {
    text: (): string => doc.getText('t').toJSON(),
    type: (s: string): void => {
      doc.getText('t').insert(doc.getText('t').length, s);
    },
    /** Typing that reaches the Y.Doc only on the next flush, like BlockWriteBuffer. */
    typeBuffered: (s: string): void => {
      buffered += s;
    },
    YjsManager: {
      applyRemoteUpdate: vi.fn((u: Uint8Array, origin: unknown) => {
        land();
        remoteOrigins.add(origin);
        Y.applyUpdate(doc, u, origin);
      }),
      onDocUpdate: (l: (u: Uint8Array, origin: unknown) => void) => {
        updateListeners.add(l);

        return () => updateListeners.delete(l);
      },
      encodeStateAsUpdate: () => Y.encodeStateAsUpdate(doc),
      flushPendingBlockWrites: vi.fn(land),
      resetForRelineage: vi.fn(() => {
        land();
        doc.destroy();
        doc = new Y.Doc();
        bind();
      }),
    },
    BlockManager: { clear: vi.fn(async () => {}), setRemoteOriginLabel: vi.fn() },
    ModificationsObserver: { disable: vi.fn(), enable: vi.fn(), discardPendingChanges: vi.fn(), onRoleChanged: vi.fn(), flushNow: vi.fn() },
    Saver: {
      getDocumentRecordId: () => recordId,
      hasMintedDocumentId: () => minted,
      adoptDocumentRecordId: vi.fn((id: string) => {
        recordId = id;
        minted = false;
      }),
    },
    ReadOnly: { isEnabled: options.readOnly ?? false },
  };
};
