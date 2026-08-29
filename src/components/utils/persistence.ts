import type { BlokConfig, OutputData } from '../../../types';
import type { PersistedDocument } from '../../../types/configs/blok-config';

/**
 * What `persistence.load` may answer with: the document, a versioned envelope
 * around it, or nothing.
 */
type LoadResult = OutputData | PersistedDocument | null;

/**
 * How long to wait before each retry of a rejecting save, in milliseconds. One
 * entry per retry, so a save gets three attempts in all.
 *
 * A save rejects far more often from a blip — a dropped connection, the first
 * request after a laptop wakes — than from a broken endpoint, and a blip is
 * over well inside two and a half seconds. A failure that outlives that is an
 * outage the consumer has to hear about: more attempts would only delay
 * `onError` while the document sits unwritten, and the queue already holds the
 * payload for the next change either way.
 */
const RETRY_DELAYS_MS = [500, 2000];

/**
 * Unwraps the versioned envelope a store may answer with, so the rest of the
 * editor only ever sees a document. `data` is the discriminator — `OutputData`
 * has no such key.
 *
 * `{ data: null }` is "nothing saved yet", not "an empty document": rendering
 * it as a document would put a blank page on screen and let autosave write that
 * emptiness over whatever the store really holds.
 * @param loaded - whatever `persistence.load()` resolved with
 */
export function unwrapPersistedDocument(loaded: LoadResult): OutputData | null {
  if (loaded !== null && 'data' in loaded) {
    return loaded.data;
  }

  return loaded;
}

/**
 * Turns a `persistence` block into the `onSave` handler the editor already has.
 *
 * Loading is deliberately NOT wired into `data`: that key is read synchronously
 * while the config is normalized, so it cannot hold a promise. The editor awaits
 * `load()` once, right before its first render.
 *
 * The queue matters: `onSave` is debounced upstream, but a slow save can still
 * be overtaken by the next one, and out-of-order completion resurrects stale
 * content. One save runs at a time, and only the NEWEST pending payload is sent
 * after it — intermediate ones are already obsolete.
 *
 * `load` is wrapped rather than left alone because the document version travels
 * the same route as the document: whatever `load` reported is what the next
 * `save` is told it is overwriting. Blok only carries that version — comparing
 * two of them is the consumer endpoint's job.
 * @param config - the user-supplied configuration
 */
export function expandPersistenceConfig(config: BlokConfig): BlokConfig {
  const persistence = config.persistence;

  if (persistence === undefined || config.onSave !== undefined) {
    return config;
  }

  const queue: {
    inFlight: Promise<void> | null;
    pending: OutputData | null;
    version: string | null;
    /**
     * Set while a payload sits in `pending` only because its own attempts ran
     * out. It is kept so nothing is lost, but it must not restart the queue by
     * itself — that would be an endless retry loop against a dead endpoint.
     */
    parked: boolean;
    /** Wakes a backoff early. Non-null only while one is running. */
    cancelBackoff: (() => void) | null;
    guarding: boolean;
  } = {
    inFlight: null,
    pending: null,
    version: null,
    parked: false,
    cancelBackoff: null,
    guarding: false,
  };

  const guardUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };

  /**
   * The listener is attached only while there is something to lose. Blok has no
   * teardown hook a config expansion can reach — `destroy()` walks module
   * instances, not the config — so a listener attached for the editor's whole
   * life would outlive the editor and block navigation forever. Tying it to the
   * queue's own state is what makes it self-removing.
   */
  const syncUnloadGuard = (): void => {
    const hasWork = queue.inFlight !== null || queue.pending !== null;

    if (hasWork === queue.guarding) {
      return;
    }

    queue.guarding = hasWork;

    if (hasWork) {
      window.addEventListener('beforeunload', guardUnload);
    } else {
      window.removeEventListener('beforeunload', guardUnload);
    }
  };

  const backoff = (delay: number): Promise<void> => new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      queue.cancelBackoff = null;
      resolve();
    }, delay);

    queue.cancelBackoff = (): void => {
      clearTimeout(timer);
      queue.cancelBackoff = null;
      resolve();
    };
  });

  const attemptSave = async (payload: OutputData, attempt: number): Promise<void> => {
    try {
      const result = await persistence.save(payload, { version: queue.version });

      // An endpoint that does not version answers with nothing, and the
      // version it was given has to survive that.
      if (result != null && typeof result.version === 'string') {
        queue.version = result.version;
      }
    } catch (error: unknown) {
      // A newer document is already queued, so this one's content is
      // superseded: retrying it would write stale content, and its failure is
      // not a loss to report because the newer payload carries it.
      if (queue.pending !== null) {
        return;
      }

      if (attempt >= RETRY_DELAYS_MS.length) {
        // The payload is the only copy of the newest document Blok holds.
        // Dropping it here is the data loss this queue exists to prevent, so it
        // goes back on the queue for the next change to carry out.
        queue.pending = payload;
        queue.parked = true;
        persistence.onError?.(error);

        return;
      }

      await backoff(RETRY_DELAYS_MS[attempt]);

      if (queue.pending !== null) {
        return;
      }

      await attemptSave(payload, attempt + 1);
    }
  };

  const drain = (): void => {
    if (queue.inFlight !== null || queue.pending === null || queue.parked) {
      return;
    }

    const payload = queue.pending;

    queue.pending = null;
    queue.inFlight = attemptSave(payload, 0)
      .finally(() => {
        queue.inFlight = null;
        syncUnloadGuard();
        drain();
      });
  };

  return {
    ...config,
    persistence: {
      ...persistence,
      load: async (): Promise<LoadResult> => {
        const loaded = await persistence.load();

        if (loaded !== null && 'data' in loaded && typeof loaded.version === 'string') {
          queue.version = loaded.version;
        }

        return loaded;
      },
    },
    onSave: (data: OutputData): void => {
      queue.pending = data;
      queue.parked = false;
      // A backoff still running belongs to a document this one replaces; waking
      // it now lets the queue move on to the newest payload immediately.
      queue.cancelBackoff?.();
      syncUnloadGuard();
      drain();
    },
  };
}
