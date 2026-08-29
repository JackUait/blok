import type { BlokConfig, OutputData } from '../../../types';
import type { PersistedDocument } from '../../../types/configs/blok-config';

/**
 * What `persistence.load` may answer with: the document, a versioned envelope
 * around it, or nothing.
 */
type LoadResult = OutputData | PersistedDocument | null;

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
  } = {
    inFlight: null,
    pending: null,
    version: null,
  };

  const drain = (): void => {
    if (queue.inFlight !== null || queue.pending === null) {
      return;
    }

    const payload = queue.pending;

    queue.pending = null;
    queue.inFlight = persistence
      .save(payload, { version: queue.version })
      .then((result) => {
        // An endpoint that does not version answers with nothing, and the
        // version it was given has to survive that.
        if (result != null && typeof result.version === 'string') {
          queue.version = result.version;
        }
      })
      .catch((error: unknown) => {
        persistence.onError?.(error);
      })
      .finally(() => {
        queue.inFlight = null;
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
      drain();
    },
  };
}
