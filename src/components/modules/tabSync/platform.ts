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

/**
 * One acquisition at a time: `tryAcquire` or `queue` while this object is
 * already waiting or holding rejects with an InvalidStateError.
 */
export interface LeaderLock {
  /** Resolves true when this tab got the lock without waiting. */
  tryAcquire(): Promise<boolean>;
  /**
   * Waits in line; resolves when this tab becomes leader.
   * Rejects with an AbortError when `signal` aborts or `release()` is called first.
   */
  queue(signal: AbortSignal): Promise<void>;
  /** Frees a held lock, or cancels a pending `tryAcquire` / `queue`. */
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

  interface Attempt { cancelled: boolean; free: (() => void) | null; abort: AbortController }

  const current: { attempt: Attempt | null } = { attempt: null };

  const busy = (): Promise<never> =>
    Promise.reject(new DOMException('LeaderLock is already waiting or holding', 'InvalidStateError'));

  /**
   * Requests the lock. `settle` gets the outcome; the lock stays held while the
   * callback's promise is pending, until `release()` frees it.
   * @param options - lock request options, given this attempt's abort signal
   * @param settle - called with true when granted, false when missed or cancelled
   */
  const request = (options: (signal: AbortSignal) => LockOptions, settle: (granted: boolean) => void): Promise<unknown> => {
    const attempt: Attempt = { cancelled: false, free: null, abort: new AbortController() };

    current.attempt = attempt;

    return locks.request(key, options(attempt.abort.signal), (granted) => {
      if (granted === null || attempt.cancelled) {
        settle(false);

        return undefined;
      }
      settle(true);

      return new Promise<void>((resolve) => {
        attempt.free = resolve;
      });
    }).finally(() => {
      if (current.attempt === attempt) {
        current.attempt = null;
      }
    });
  };

  return {
    tryAcquire: () => {
      if (current.attempt !== null) {
        return busy();
      }

      // No signal here: the Web Locks API rejects `ifAvailable` with `signal`.
      return new Promise<boolean>((resolve, reject) => {
        request(() => ({ ifAvailable: true }), resolve).catch(reject);
      });
    },
    queue: (signal) => {
      if (current.attempt !== null) {
        return busy();
      }
      if (signal.aborted) {
        return Promise.reject(signal.reason);
      }

      return new Promise<void>((resolve, reject) => {
        const settle = (granted: boolean): void => {
          if (granted) {
            resolve();
          } else {
            reject(new DOMException('LeaderLock released while waiting', 'AbortError'));
          }
        };
        const pending = request((own) => ({ signal: own }), settle);
        const attempt = current.attempt;
        const forward = (): void => attempt?.abort.abort(signal.reason);

        signal.addEventListener('abort', forward, { once: true });
        pending
          .catch(reject)
          .finally(() => signal.removeEventListener('abort', forward));
      });
    },
    release: () => {
      const attempt = current.attempt;

      current.attempt = null;
      if (attempt === null) {
        return;
      }
      attempt.cancelled = true;
      attempt.abort.abort();
      attempt.free?.();
    },
  };
};

export const browserTabPlatform: TabPlatform = { rawChannel, channel, lock };
