import type { BlokConfig, OutputData } from '../../../types';
import type { PersistedDocument } from '../../../types/configs/blok-config';
import { attachOrphanSweep, createOrphanSweep } from './orphan-sweep';

/**
 * What `persistence.load` may answer with: the document, a versioned envelope
 * around it, or nothing.
 */
type LoadResult = OutputData | PersistedDocument | null;

/** The expanded `persistence` block one editor's queue and sweep are keyed by. */
type ExpandedPersistence = NonNullable<BlokConfig['persistence']>;

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
 * One queue teardown per editor, keyed by the expanded `persistence` object
 * the expansion built for it — the same handle the orphan sweep is keyed by,
 * because it is still the only one both sides reach: the queue creates it, and
 * the config carrying it is the config every module receives.
 *
 * A module-level disposer would be shared by every editor on the page, so
 * destroying one would strip the unload guard of another that still has an
 * unwritten save.
 */
const disposers = new WeakMap<ExpandedPersistence, () => void>();

/**
 * Drop the unload guard an editor's save queue is holding.
 *
 * The queue detaches its own listener whenever it runs out of work, which
 * leaves exactly one case for `destroy()` to close: an editor torn down while
 * a save is still unwritten. A listener that outlives its editor makes every
 * later navigation in a single-page app ask the user to confirm a loss that
 * cannot happen any more.
 *
 * Anything may be passed: an editor that never had `persistence` has no queue
 * behind it and releases to nothing, and releasing twice is the same no-op —
 * `destroy()` can be reached more than once.
 * @param owner - the editor's `persistence` block, if it has one
 */
export function releasePersistenceQueue(owner: ExpandedPersistence | undefined): void {
  if (owner === undefined) {
    return;
  }

  const dispose = disposers.get(owner);

  disposers.delete(owner);
  dispose?.();
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

  const sweep = createOrphanSweep();

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
    /**
     * Set once the editor is gone. A save still in flight then runs to its own
     * end — it can reject, back off and park long afterwards — and every one of
     * those steps re-reads the queue's state, so without this the queue would
     * re-attach the listener the release just took off.
     */
    released: boolean;
  } = {
    inFlight: null,
    pending: null,
    version: null,
    parked: false,
    cancelBackoff: null,
    guarding: false,
    released: false,
  };

  const guardUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };

  /**
   * The listener is attached only while there is something to lose, so a queue
   * that empties detaches its own guard. That covers everything but the editor
   * torn down with a save still unwritten — in flight, or parked once its
   * attempts ran out — and `releasePersistenceQueue` covers that one.
   */
  const syncUnloadGuard = (): void => {
    const hasWork = !queue.released && (queue.inFlight !== null || queue.pending !== null);

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

      // The retry is a whole attempt of its own, sweep included, so this one
      // is finished either way.
      await attemptSave(payload, attempt + 1);

      return;
    }

    // A resolved save is the only proof the editor ever gets that the document
    // was written, which is what makes it safe to delete the assets that
    // document no longer names. A payload that ran out of attempts is parked,
    // not saved, and never reaches this line.
    //
    // The sweep sits after the catch rather than inside the try so that nothing
    // it does can be mistaken for the save rejecting — a retry here would write
    // the document a second time.
    await sweep.sweep(payload);
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

  const expanded = {
    ...persistence,
    load: async (): Promise<LoadResult> => {
      const loaded = await persistence.load();

      if (loaded !== null && 'data' in loaded && typeof loaded.version === 'string') {
        queue.version = loaded.version;
      }

      return loaded;
    },
  };

  // The expanded block is the handle the uploader finds this editor's
  // candidate set by, so an asset recorded here can never be swept by the
  // editor next to it on the page.
  attachOrphanSweep(expanded, sweep);

  // Keyed by the same handle, for the same reason: the guard removed on
  // destroy has to be THIS editor's, never the one the editor beside it on the
  // page is still holding for work of its own.
  disposers.set(expanded, () => {
    queue.released = true;
    queue.guarding = false;
    window.removeEventListener('beforeunload', guardUnload);
  });

  return {
    ...config,
    persistence: expanded,
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
