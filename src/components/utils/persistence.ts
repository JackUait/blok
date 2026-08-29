import type { BlokConfig, OutputData } from '../../../types';

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
 * @param config - the user-supplied configuration
 */
export function expandPersistenceConfig(config: BlokConfig): BlokConfig {
  const persistence = config.persistence;

  if (persistence === undefined || config.onSave !== undefined) {
    return config;
  }

  const queue: { inFlight: Promise<void> | null; pending: OutputData | null } = {
    inFlight: null,
    pending: null,
  };

  const drain = (): void => {
    if (queue.inFlight !== null || queue.pending === null) {
      return;
    }

    const payload = queue.pending;

    queue.pending = null;
    queue.inFlight = persistence
      .save(payload)
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
    onSave: (data: OutputData): void => {
      queue.pending = data;
      drain();
    },
  };
}
