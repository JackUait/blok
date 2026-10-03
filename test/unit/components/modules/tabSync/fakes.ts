import * as Y from 'yjs';
import { vi } from 'vitest';

import type { LeaderLock, RawChannel, TabActivity, TabChannel, TabPlatform } from '../../../../../src/components/modules/tabSync/platform';
import type { TabMessage } from '../../../../../src/components/modules/tabSync/messages';

/** A tab's activity the test sets by hand. Inactive until set, so no tab claims by itself. */
export const createFakeActivity = (): TabActivity & { set: (active: boolean) => void } => {
  const listeners = new Set<() => void>();
  const state = { active: false };

  return {
    isActive: () => state.active,
    onChange: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    set: (active) => {
      state.active = active;
      listeners.forEach((listener) => listener());
    },
  };
};

const busy = (): Promise<never> =>
  Promise.reject(new DOMException('LeaderLock is already waiting or holding', 'InvalidStateError'));

/**
 * One in-memory bus per key; delivery is async like BroadcastChannel and skips the sender.
 * Each lock object follows the real LeaderLock contract (platform.ts): one
 * acquisition at a time, `release()` cancels a pending `queue`, and `steal`
 * takes the lock from its holder while waiters keep their place.
 */
export const createFakePlatform = (): TabPlatform & {
  holders: Map<string, number>;
  openChannels: (key: string) => number;
  /** Drops deliveries to this channel, like a frozen tab. */
  pauseInbound: (channel: TabChannel) => void;
  resumeInbound: (channel: TabChannel) => void;
} => {
  const buses = new Map<string, Set<(m: TabMessage) => void>>();
  const rawBuses = new Map<string, Set<(data: unknown) => void>>();
  const paused = new Set<TabChannel>();
  const holders = new Map<string, number>();
  const waiters = new Map<string, Array<() => void>>();
  /** Tells a lock object its held lock was stolen. */
  const losers = new Map<number, () => void>();
  let nextId = 0;

  return {
    holders,
    openChannels: (key) => (buses.get(key)?.size ?? 0) + (rawBuses.get(key)?.size ?? 0),
    pauseInbound: (channel) => {
      paused.add(channel);
    },
    resumeInbound: (channel) => {
      paused.delete(channel);
    },
    rawChannel: (name): RawChannel => {
      const listeners = new Set<(data: unknown) => void>();
      const bus = rawBuses.get(name) ?? new Set();
      const deliver = (data: unknown): void => {
        listeners.forEach((l) => l(structuredClone(data)));
      };

      rawBuses.set(name, bus);
      bus.add(deliver);

      return {
        post: (data) => bus.forEach((d) => {
          if (d !== deliver) {
            queueMicrotask(() => d(data));
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
    channel: (key): TabChannel => {
      const listeners = new Set<(m: TabMessage) => void>();
      const bus = buses.get(key) ?? new Set();
      const deliver = (m: TabMessage): void => {
        if (!paused.has(channel)) {
          listeners.forEach((l) => l(structuredClone(m)));
        }
      };
      const channel: TabChannel = {
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

      buses.set(key, bus);
      bus.add(deliver);

      return channel;
    },
    activity: () => createFakeActivity(),
    lock: (key): LeaderLock => {
      const me = nextId++;
      const state: { phase: 'idle' | 'pending' | 'held'; cancel: (() => void) | null } = { phase: 'idle', cancel: null };
      const lostListeners = new Set<() => void>();

      const handOn = (): void => {
        holders.delete(key);
        waiters.get(key)?.shift()?.();
      };

      losers.set(me, () => {
        state.phase = 'idle';
        // Async, like the rejection of the real held request.
        queueMicrotask(() => lostListeners.forEach((listener) => listener()));
      });

      const release = (): void => {
        if (state.phase === 'pending') {
          state.cancel?.();

          return;
        }
        if (state.phase === 'held' && holders.get(key) === me) {
          state.phase = 'idle';
          handOn();
        }
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
        release,
        steal: async () => {
          if (state.phase === 'held' && holders.get(key) === me) {
            return;
          }
          release();
          const holder = holders.get(key);

          holders.set(key, me);
          state.phase = 'held';
          if (holder !== undefined) {
            losers.get(holder)?.();
          }
        },
        onLost: (listener) => {
          lostListeners.add(listener);

          return () => {
            lostListeners.delete(listener);
          };
        },
      };
    },
  };
};

/**
 * A stand-in for the Blok modules TabSync touches, built on a REAL Y.Doc so
 * merge, reset and generation behaviour is the real Yjs behaviour.
 */
export const createFakeBlok = (options: { recordId?: string; minted?: boolean; readOnly?: boolean; seedText?: string } = {}) => {
  let doc = new Y.Doc();
  const settledListeners = new Set<() => void>();
  let savesInFlight = 0;
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
  if (options.seedText !== undefined) {
    doc.getText('t').insert(0, options.seedText);
  }

  return {
    text: (): string => doc.getText('t').toJSON(),
    type: (s: string): void => {
      doc.getText('t').insert(doc.getText('t').length, s);
    },
    /** Deletes the last `count` characters. */
    erase: (count: number): void => {
      const text = doc.getText('t');

      text.delete(text.length - count, count);
    },
    /** Typing that reaches the Y.Doc only on the next flush, like BlockWriteBuffer. */
    typeBuffered: (s: string): void => {
      buffered += s;
    },
    /**
     * A block.save() round trip still running. The returned function ends it:
     * its typing enters the write buffer, then settled listeners run.
     */
    startBlockSave: (s: string): (() => void) => {
      savesInFlight += 1;

      return () => {
        buffered += s;
        savesInFlight -= 1;
        if (savesInFlight === 0) {
          const listeners = Array.from(settledListeners);

          settledListeners.clear();
          listeners.forEach((l) => l());
        }
      };
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
      /** Every update, remote ones included, like the real one. */
      onAnyDocUpdate: (l: (u: Uint8Array, origin: unknown) => void) => {
        const current = doc;

        current.on('update', l);

        return () => current.off('update', l);
      },
      encodeStateAsUpdate: (stateVector?: Uint8Array) => {
        land();

        return Y.encodeStateAsUpdate(doc, stateVector);
      },
      getStateVector: () => {
        land();

        return Y.encodeStateVector(doc);
      },
      /** Like the real one: runs at once when no block save is in flight. */
      onPendingBlockWritesSettled: (callback: () => void): (() => void) => {
        if (savesInFlight === 0) {
          callback();

          return () => undefined;
        }
        settledListeners.add(callback);

        return () => {
          settledListeners.delete(callback);
        };
      },
      flushPendingBlockWrites: vi.fn(land),
      resetForRelineage: vi.fn(() => {
        land();
        doc.destroy();
        doc = new Y.Doc();
        bind();
      }),
    },
    BlockManager: { clear: vi.fn(async () => {}), setRemoteOriginLabel: vi.fn(), blocks: [{ isEmpty: false }] },
    ModificationsObserver: {
      disable: vi.fn(),
      enable: vi.fn(),
      discardPendingChanges: vi.fn(),
      onRoleChanged: vi.fn((_role: string, _options?: { keepPendingSave: boolean }): boolean => false),
      flushNow: vi.fn(),
      markDirty: vi.fn(),
      hasUnsavedChanges: false,
      hasPendingSave: false,
      isSaving: false,
    },
    Saver: {
      getDocumentRecordId: () => recordId,
      hasMintedDocumentId: () => minted,
      adoptDocumentRecordId: vi.fn((id: string) => {
        recordId = id;
        minted = false;
      }),
    },
    ReadOnly: { isEnabled: options.readOnly ?? false },
    Renderer: { pendingRender: null as Promise<void> | null },
    I18n: { getLocale: (): string => 'en', update: vi.fn(async (_options: { locale: string }): Promise<void> => undefined) },
  };
};
