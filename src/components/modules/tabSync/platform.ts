import type { TabMessage } from './messages';
import { unwrap, wrap } from './messages';

export interface RawChannel {
  post(data: unknown): void;
  onMessage(listener: (data: unknown) => void): () => void;
  close(): void;
}

export interface TabChannel {
  post(message: TabMessage): void;
  onMessage(listener: (message: TabMessage) => void): () => void;
  close(): void;
}

export interface LeaderLock {
  /** Resolves true when this tab got the lock without waiting. */
  tryAcquire(): Promise<boolean>;
  /** Waits in line; resolves when this tab becomes leader. Abortable. */
  queue(signal: AbortSignal): Promise<void>;
  release(): void;
}

export interface TabPlatform {
  /** Any data, no codec. Null when BroadcastChannel is missing. */
  rawChannel(name: string): RawChannel | null;
  /** Null when BroadcastChannel is missing. */
  channel(key: string): TabChannel | null;
  /** Null when navigator.locks is missing. */
  lock(key: string): LeaderLock | null;
}

const rawChannel = (name: string): RawChannel | null => {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }

  const port = new BroadcastChannel(name);

  return {
    post: (data) => port.postMessage(data),
    onMessage: (listener) => {
      const handle = (event: MessageEvent): void => listener(event.data);

      port.addEventListener('message', handle);

      return () => port.removeEventListener('message', handle);
    },
    close: () => port.close(),
  };
};

const channel = (key: string): TabChannel | null => {
  const raw = rawChannel(key);

  if (raw === null) {
    return null;
  }

  return {
    post: (message) => raw.post(wrap(key, message)),
    onMessage: (listener) => raw.onMessage((data) => {
      const message = unwrap(key, data);

      if (message !== null) {
        listener(message);
      }
    }),
    close: () => raw.close(),
  };
};

const lock = (key: string): LeaderLock | null => {
  const locks = typeof navigator === 'undefined' ? undefined : (navigator.locks as LockManager | undefined);

  if (locks === undefined) {
    return null;
  }

  const held: { release: (() => void) | null } = { release: null };

  // The lock stays held while the callback's promise is pending.
  const hold = (): Promise<void> => new Promise<void>((resolve) => {
    held.release = resolve;
  });

  return {
    tryAcquire: () => new Promise<boolean>((resolve, reject) => {
      locks.request(key, { ifAvailable: true }, (granted) => {
        resolve(granted !== null);

        return granted === null ? undefined : hold();
      }).catch(reject);
    }),
    queue: (signal) => new Promise<void>((resolve, reject) => {
      locks.request(key, { signal }, () => {
        resolve();

        return hold();
      }).catch(reject);
    }),
    release: () => {
      held.release?.();
      held.release = null;
    },
  };
};

export const browserTabPlatform: TabPlatform = { rawChannel, channel, lock };
