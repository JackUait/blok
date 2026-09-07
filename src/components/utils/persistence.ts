import type { BlokConfig, OutputData } from '../../../types';
import type { PersistedDocument } from '../../../types/configs/blok-config';
import { attachOrphanSweep, createOrphanSweep } from './orphan-sweep';

/**
 * What `persistence.load` may answer with: the document, a versioned envelope
 * around it, or nothing.
 *
 * `undefined` is in the union even though the published type stops at `null`,
 * because `const row = await db.get(id); if (!row) return; return row.doc;` is
 * the natural shape of a load and it resolves `undefined`. TypeScript refuses
 * that in a strict host and nothing refuses it in a JavaScript one.
 */
type LoadResult = OutputData | PersistedDocument | null | undefined;

/** What the published type promises `persistence.load` resolves with. */
type PublishedLoadResult = OutputData | PersistedDocument | null;

/** The expanded `persistence` block one editor's queue and sweep are keyed by. */
type ExpandedPersistence = NonNullable<BlokConfig['persistence']>;

/** A live save handler — the queue's pump and a host's `onSave` share the shape. */
type SaveHandler = NonNullable<BlokConfig['onSave']>;

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
 * How many rejections IN A ROW make an outage worth reporting, counted across
 * payloads rather than within one.
 *
 * Per-payload counting starves `onError` completely while the user types: every
 * delivery supersedes the payload in flight, so no payload ever reaches its
 * third attempt and the report never fires — measured at zero over thirty
 * seconds of editing against a dead endpoint. A landed save resets the count,
 * so a blip inside a healthy run still says nothing.
 */
const REPORTABLE_FAILURE_RUN = RETRY_DELAYS_MS.length + 1;

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
  // Anything that is not an object cannot be a document, and `in` throws on
  // every one of them. The only trace of that throw was a console line: it
  // escapes core's render(), so `isReady` rejects and the editor comes up with
  // no blocks at all — not even the default paragraph.
  if (typeof loaded !== 'object' || loaded === null) {
    return null;
  }

  if ('data' in loaded) {
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
 * The queue's own entry point, kept OFF `config.onSave` and keyed by the same
 * handle as the disposer and the candidate set.
 *
 * `config.onSave` is public and writable at runtime: `handlers.set({ onSave })`
 * assigns straight onto the object core holds, and every React and Angular host
 * reaches that setter without asking for it. While the pump lived in that key,
 * one such write replaced it — and `persistence.save` has exactly one call site,
 * inside the closure that key held, so the endpoint became unreachable for the
 * life of the editor with no error anywhere.
 */
const pumps = new WeakMap<ExpandedPersistence, SaveHandler>();

/**
 * The `onSave` an editor should carry: the persistence queue's pump, the host's
 * own handler, or both.
 *
 * Both is the answer whenever both exist. A host `onSave` is not a replacement
 * for a configured endpoint — the adapters synthesize one for their own
 * bindings (`v-model:data`, `[formControl]`), so treating its presence as "the
 * host took over saving" silently unplugged the endpoint the host explicitly
 * configured.
 *
 * The pump runs FIRST so a throwing host handler cannot cost the document its
 * save.
 * @param persistence - the editor's expanded `persistence` block, if it has one
 * @param hostOnSave - the handler the host wants called, if any
 */
export function composePersistenceSave(
  persistence: ExpandedPersistence | undefined,
  hostOnSave: SaveHandler | undefined
): SaveHandler | undefined {
  const pump = persistence === undefined ? undefined : pumps.get(persistence);

  if (pump === undefined) {
    return hostOnSave;
  }

  if (hostOnSave === undefined) {
    return pump;
  }

  return (data, api): void => {
    pump(data, api);
    hostOnSave(data, api);
  };
}

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
 * A host that set `onSave` itself keeps it — it is called alongside the queue,
 * not instead of it. The queue is what carries the endpoint, the retries, the
 * unload guard and the orphan sweep, and none of that is something a host
 * callback replaces.
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

  if (persistence === undefined) {
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
     * Rejections in a row, counted ACROSS payloads and reset by a save that
     * lands. Reporting an outage per payload never fires while the user types.
     */
    failures: number;
    /**
     * Set once the editor is gone. The queue stops there: no retry, no new
     * save, no sweep and no `onError`. A retry of a destroyed editor can land
     * after the replacement editor's first save and write an older document
     * over a newer one — the out-of-order write this queue exists to prevent —
     * and a sweep would delete files with no undo left to put the block back.
     *
     * The one thing that cannot be stopped is the `save()` call already in
     * flight when the release ran; its result is discarded.
     */
    released: boolean;
  } = {
    inFlight: null,
    pending: null,
    version: null,
    parked: false,
    cancelBackoff: null,
    guarding: false,
    failures: 0,
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

  /**
   * Report the rejection of a payload a newer one has already replaced.
   *
   * Nothing is parked and nothing is retried — the newer payload carries this
   * one's content. Only the run of failures is news, and only once it is long
   * enough to mean an outage rather than a blip.
   * @param outage - true once enough saves have rejected in a row
   * @param error - whatever `save` rejected with
   */
  const reportSuperseded = (outage: boolean, error: unknown): void => {
    if (outage) {
      persistence.onError?.(error);
    }
  };

  const attemptSave = async (payload: OutputData, attempt: number): Promise<void> => {
    if (queue.released) {
      return;
    }

    // Taken BEFORE the save leaves: an upload that resolves while it is in
    // flight must not be swept by it. See `beginSave` in orphan-sweep.ts.
    const recordedBefore = sweep.beginSave();

    try {
      const result = await persistence.save(payload, { version: queue.version });

      // An endpoint that does not version answers with nothing, and the
      // version it was given has to survive that.
      if (result != null && typeof result.version === 'string') {
        queue.version = result.version;
      }

      queue.failures = 0;
    } catch (error: unknown) {
      if (queue.released) {
        return;
      }

      queue.failures += 1;

      // Reporting and retrying are separate questions, and conflating them
      // costs the document attempts: a payload delivered after a long outage
      // would be parked on its first rejection instead of retried.
      const outage = queue.failures >= REPORTABLE_FAILURE_RUN;

      // A newer document is already queued, so this one's content is
      // superseded: retrying it would write stale content, and it must not be
      // parked because the newer payload already carries its content.
      if (queue.pending !== null) {
        reportSuperseded(outage, error);

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

      if (queue.released) {
        return;
      }

      // Superseded while the backoff ran. This is the branch a typing user
      // takes every time, so it is the one an outage has to be reportable from.
      if (queue.pending !== null) {
        reportSuperseded(outage, error);

        return;
      }

      // The retry is a whole attempt of its own, sweep included, so this one
      // is finished either way.
      await attemptSave(payload, attempt + 1);

      return;
    }

    if (queue.released) {
      return;
    }

    // A newer payload is already queued, and IT is the live document: the one
    // that just landed may have dropped a URL the newer one still names — an
    // undo, or an image added while this save was in flight. Sweeping now would
    // delete a file a visible block points at. The candidates stay recorded, so
    // the save that drains the queue sweeps them against the newest document.
    if (queue.pending !== null) {
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
    await sweep.sweep(payload, recordedBefore);
  };

  const drain = (): void => {
    if (queue.released || queue.inFlight !== null || queue.pending === null || queue.parked) {
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
    load: async (): Promise<PublishedLoadResult> => {
      const loaded: LoadResult = await persistence.load();

      // Same guard as unwrapPersistedDocument, and needed independently: this
      // wrapper runs FIRST, so an unguarded `in` here throws before the unwrap
      // is ever reached.
      if (typeof loaded === 'object' && loaded !== null && 'data' in loaded && typeof loaded.version === 'string') {
        queue.version = loaded.version;
      }

      // Normalized so only ONE shape of "nothing saved yet" leaves this wrapper.
      // The published type promises `null`, and everything downstream — core's
      // render gate included — is written against it.
      return loaded ?? null;
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
    // A backoff is a live timer holding a retry: without waking it the retry
    // fires up to 2s after the editor is gone, and `released` is only read once
    // the timer resolves.
    queue.cancelBackoff?.();
  });

  pumps.set(expanded, (data: OutputData): void => {
    queue.pending = data;
    queue.parked = false;
    // A backoff still running belongs to a document this one replaces; waking
    // it now lets the queue move on to the newest payload immediately.
    queue.cancelBackoff?.();
    syncUnloadGuard();
    drain();
  });

  return {
    ...config,
    persistence: expanded,
    onSave: composePersistenceSave(expanded, config.onSave),
  };
}
