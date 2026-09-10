import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expandPersistenceConfig,
  registerUnsavedWork,
  releasePersistenceQueue,
} from '../../../../src/components/utils/persistence';
import { orphanSweepFor } from '../../../../src/components/utils/orphan-sweep';
import type { API, OutputData } from '../../../../types';

const DOC: OutputData = { blocks: [], time: 0, version: '1' };
const API_STUB = {} as API;

const FIRST_RETRY_DELAY_MS = 500;
const SECOND_RETRY_DELAY_MS = 2000;
/** Carries a save through every attempt and the backoff between them. */
const RETRY_WINDOW_MS = FIRST_RETRY_DELAY_MS + SECOND_RETRY_DELAY_MS + 1;

/** The `beforeunload` registrations an add/removeEventListener spy saw. */
const beforeUnloadCalls = (spy: { mock: { calls: unknown[][] } }): unknown[][] =>
  spy.mock.calls.filter(([type]) => type === 'beforeunload');

describe('persistence — mutant coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const fireBeforeUnload = (): boolean => {
    const event = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(event);

    return event.defaultPrevented;
  };

  /** Every message handed to console.warn, flattened to text. */
  const warnedTexts = (warn: ReturnType<typeof vi.spyOn>): string[] =>
    (warn.mock.calls as unknown[][]).map(([message]) => String(message));

  describe('the version a load reports', () => {
    // `rev: 42` is the documented shape of a versioned store; a number has to
    // survive as text or the If-Match preconditions never run.
    it('carries a numeric version through to the next save as text', async () => {
      const save = vi.fn().mockResolvedValue(undefined);

      const result = expandPersistenceConfig({
        persistence: { load: async () => ({ data: DOC, version: 42 }), save },
      });

      await result.persistence?.load();
      result.onSave?.(DOC, API_STUB);

      expect(save).toHaveBeenCalledWith(DOC, { version: '42' });
    });

    // An object version would coerce to `[object Object]`, which no endpoint can
    // use as a precondition — so it is refused, and loudly.
    it('ignores a version that is neither a string nor a finite number, and says why', async () => {
      const warn = vi.spyOn(console, 'warn');
      const save = vi.fn().mockResolvedValue(undefined);

      const result = expandPersistenceConfig({
        persistence: { load: async () => ({ data: DOC, version: { rev: 42 } } as unknown as OutputData), save },
      });

      await result.persistence?.load();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Report an ETag, a revision number or a hash.'),
        expect.objectContaining({ rev: 42 })
      );

      result.onSave?.(DOC, API_STUB);

      expect(save).toHaveBeenCalledWith(DOC, { version: null });
    });

    // `undefined` and `null` are how an endpoint says "I do not version"; both
    // are silence, and both leave the version Blok already holds standing. A
    // NaN is neither, and is the same refusal as any other unusable value.
    it('stays silent for a version of undefined or null, and warns for NaN', async () => {
      const warn = vi.spyOn(console, 'warn');
      const save = vi.fn().mockResolvedValue(undefined);

      const versionless = expandPersistenceConfig({
        persistence: { load: async () => ({ data: DOC }), save },
      });
      const nullVersion = expandPersistenceConfig({
        persistence: { load: async () => ({ data: DOC, version: null } as unknown as OutputData), save },
      });

      await versionless.persistence?.load();
      await nullVersion.persistence?.load();

      expect(warn).not.toHaveBeenCalled();

      const nanVersion = expandPersistenceConfig({
        persistence: { load: async () => ({ data: DOC, version: Number.NaN }), save },
      });

      await nanVersion.persistence?.load();

      expect(warn).toHaveBeenCalledTimes(1);
    });

    // A second load that reports no version must not erase the one before it:
    // an editor that loads twice would otherwise write without a precondition.
    it('keeps the version an earlier load reported when a later load reports none', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      let loadCount = 0;

      const result = expandPersistenceConfig({
        persistence: {
          load: async () => {
            loadCount += 1;

            return loadCount === 1 ? { data: DOC, version: 'v1' } : { data: DOC };
          },
          save,
        },
      });

      await result.persistence?.load();
      await result.persistence?.load();
      result.onSave?.(DOC, API_STUB);

      expect(save).toHaveBeenCalledWith(DOC, { version: 'v1' });
    });
  });

  describe('the unload guard', () => {
    // The guard exists only while there is something to lose, and "while there
    // is something to lose" must be read fresh on every transition.
    it('arms the guard on the first queued save and re-arms nothing on the next', async () => {
      const added = vi.spyOn(window, 'addEventListener');
      const gates: Array<() => void> = [];
      const save = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        gates.push(resolve);
      }));

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      expect(beforeUnloadCalls(added)).toHaveLength(0);

      result.onSave?.(DOC, API_STUB);

      expect(fireBeforeUnload()).toBe(true);
      expect(beforeUnloadCalls(added)).toHaveLength(1);

      result.onSave?.({ ...DOC, time: 2 }, API_STUB);

      expect(beforeUnloadCalls(added)).toHaveLength(1);

      gates.forEach((release) => release());
      releasePersistenceQueue(result.persistence);
      await vi.waitFor(() => expect(fireBeforeUnload()).toBe(false));
    });

    // A save in flight is unsaved work even when the queue holds no payload and
    // no other module reports any: the document is still unwritten.
    it('stays armed while a save is in flight and every other source goes idle', async () => {
      const gates: Array<() => void> = [];
      const save = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
        gates.push(resolve);
      }));

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });
      let dirty = true;
      const resync = registerUnsavedWork(result.persistence, () => dirty);

      resync();

      expect(fireBeforeUnload()).toBe(true);

      result.onSave?.(DOC, API_STUB);
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

      dirty = false;
      resync();

      expect(fireBeforeUnload()).toBe(true);

      gates.forEach((release) => release());
      releasePersistenceQueue(result.persistence);
      await vi.waitFor(() => expect(fireBeforeUnload()).toBe(false));
    });

    // destroy() runs for every editor, and the release has to be its own
    // teardown only: a later re-evaluation of the guard finds nothing to undo.
    it('releases once and leaves nothing for a later re-evaluation to undo', () => {
      const removed = vi.spyOn(window, 'removeEventListener');
      const save = vi.fn().mockResolvedValue(undefined);

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });
      const resync = registerUnsavedWork(result.persistence, () => false);

      releasePersistenceQueue(result.persistence);

      expect(beforeUnloadCalls(removed)).toHaveLength(1);

      resync();

      expect(beforeUnloadCalls(removed)).toHaveLength(1);
    });

    // destroy() can be reached twice, and the second release must not run the
    // teardown a second time.
    it('releases twice without tearing down twice', () => {
      const removed = vi.spyOn(window, 'removeEventListener');
      const save = vi.fn().mockResolvedValue(undefined);

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      releasePersistenceQueue(result.persistence);
      releasePersistenceQueue(result.persistence);

      expect(beforeUnloadCalls(removed)).toHaveLength(1);
    });
  });

  describe('the failure run', () => {
    // Reporting an outage per payload starves onError while the user types:
    // every delivery supersedes the one in flight, so no payload ever reaches
    // its own third attempt. The count therefore runs ACROSS payloads, and the
    // third rejection in a row is the one that is news.
    it('reports once the run of rejections reaches three, and not before', async () => {
      vi.useFakeTimers();

      const onError = vi.fn();
      const gates: Array<(error: Error) => void> = [];
      let calls = 0;
      const save = vi.fn().mockImplementation(() => {
        calls += 1;

        if (calls <= 2) {
          return Promise.reject(new Error(`offline ${calls}`));
        }

        if (calls === 3) {
          return new Promise<void>((_resolve, reject) => {
            gates.push(reject);
          });
        }

        return Promise.resolve();
      });

      const result = expandPersistenceConfig({
        persistence: { load: async () => null, save, onError },
      });

      result.onSave?.(DOC, API_STUB);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);

      expect(save).toHaveBeenCalledTimes(2);

      // A newer document supersedes the payload whose attempts are still
      // running: it is carried out by the newest payload, so nothing is parked
      // and the run of failures is the only news.
      result.onSave?.({ ...DOC, time: 2 }, API_STUB);
      await vi.advanceTimersByTimeAsync(0);

      expect(save).toHaveBeenCalledTimes(3);
      expect(onError).not.toHaveBeenCalled();

      // A third rejection, with the newer payload still queued, is the third in
      // a row: this is where the outage is worth reporting.
      result.onSave?.({ ...DOC, time: 3 }, API_STUB);
      gates.forEach((reject) => reject(new Error('offline 3')));
      await vi.advanceTimersByTimeAsync(0);

      expect(onError).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);
      releasePersistenceQueue(result.persistence);
    });

    // A save that rejects while a newer payload is already queued has nothing
    // to retry — retrying would write stale content over the newer document.
    // The newer payload goes out at once, not after a backoff.
    it('sends the newer payload as soon as the in-flight save rejects, without a backoff', async () => {
      vi.useFakeTimers();

      const gates: Array<(error: Error) => void> = [];
      const save = vi.fn()
        .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
          gates.push(reject);
        }))
        .mockResolvedValue(undefined);

      const result = expandPersistenceConfig({
        persistence: { load: async () => null, save, onError: vi.fn() },
      });

      result.onSave?.(DOC, API_STUB);
      await vi.advanceTimersByTimeAsync(0);

      expect(save).toHaveBeenCalledTimes(1);

      const newer = { ...DOC, time: 2 };

      result.onSave?.(newer, API_STUB);
      gates.forEach((reject) => reject(new Error('offline')));
      await vi.advanceTimersByTimeAsync(0);

      expect(save).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenLastCalledWith(newer, { version: null });

      releasePersistenceQueue(result.persistence);
    });

    // A retry of a destroyed editor can land after the replacement editor's
    // first save and write an older document over a newer one. A rejection that
    // arrives after the release stops there — it is neither parked nor
    // reported.
    it('reports nothing for a save that rejects after the editor was released', async () => {
      vi.useFakeTimers();

      const onError = vi.fn();
      const gates: Array<(error: Error) => void> = [];
      let calls = 0;
      const save = vi.fn().mockImplementation(() => {
        calls += 1;

        if (calls < 3) {
          return Promise.reject(new Error(`offline ${calls}`));
        }

        return new Promise<void>((_resolve, reject) => {
          gates.push(reject);
        });
      });

      const result = expandPersistenceConfig({
        persistence: { load: async () => null, save, onError },
      });

      result.onSave?.(DOC, API_STUB);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);
      await vi.advanceTimersByTimeAsync(SECOND_RETRY_DELAY_MS);

      expect(save).toHaveBeenCalledTimes(3);

      releasePersistenceQueue(result.persistence);
      gates.forEach((reject) => reject(new Error('offline 3')));
      await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

      expect(onError).not.toHaveBeenCalled();
    });

    // A release wakes the backoff, so the retry it was holding runs after the
    // editor is gone. That call is where the queue has to stop: a retry of a
    // destroyed editor can land over the replacement editor's first save.
    it('reports nothing for a rejection whose backoff the release woke', async () => {
      vi.useFakeTimers();

      const onError = vi.fn();
      const gates: Array<(error: Error) => void> = [];
      const save = vi.fn().mockImplementation(() => new Promise<void>((_resolve, reject) => {
        gates.push(reject);
      }));

      const result = expandPersistenceConfig({
        persistence: { load: async () => null, save, onError },
      });

      result.onSave?.(DOC, API_STUB);
      await vi.advanceTimersByTimeAsync(0);

      // Two superseded rejections bring the run to two without an outage.
      result.onSave?.({ ...DOC, time: 1 }, API_STUB);
      gates[0]?.(new Error('offline 1'));
      await vi.advanceTimersByTimeAsync(0);

      result.onSave?.({ ...DOC, time: 2 }, API_STUB);
      gates[1]?.(new Error('offline 2'));
      await vi.advanceTimersByTimeAsync(0);

      expect(save).toHaveBeenCalledTimes(3);

      // The third rejection is not superseded, so it backs off for a retry —
      // and that is where a release finds it.
      gates[2]?.(new Error('offline 3'));
      await vi.advanceTimersByTimeAsync(0);

      expect(onError).not.toHaveBeenCalled();

      releasePersistenceQueue(result.persistence);
      // A host still holding the editor's `onSave` closure can call it after
      // destroy — the React and Angular adapters do, on unmount races.
      result.onSave?.(DOC, API_STUB);
      await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

      expect(onError).not.toHaveBeenCalled();
      expect(save).toHaveBeenCalledTimes(3);
    });
  });

  describe('what a failing host handler costs', () => {
    // The host's own failure is the host's problem: it must not escape as an
    // unhandled rejection, and it must not cost the queue its bookkeeping.
    it('swallows a throwing persistence.onError and says so once', async () => {
      vi.useFakeTimers();

      const warn = vi.spyOn(console, 'warn');
      const onError = vi.fn(() => {
        throw new Error('host onError blew up');
      });
      const save = vi.fn().mockRejectedValue(new Error('offline'));

      const result = expandPersistenceConfig({
        persistence: { load: async () => null, save, onError },
      });

      result.onSave?.(DOC, API_STUB);
      await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

      expect(save).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('`persistence.onError` threw. The save queue ignored it and carried on.'),
        expect.any(Error)
      );

      releasePersistenceQueue(result.persistence);
    });

    // `onError` is optional, and an editor without one still spends its
    // attempts. Reaching for a handler that is not there is an error the queue
    // invented, not one the host caused.
    it('does not treat a missing persistence.onError as a failure', async () => {
      vi.useFakeTimers();

      const warn = vi.spyOn(console, 'warn');
      const save = vi.fn().mockRejectedValue(new Error('offline'));

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      result.onSave?.(DOC, API_STUB);
      await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

      expect(save).toHaveBeenCalledTimes(3);
      expect(warnedTexts(warn).filter((message) => message.includes('persistence.onError'))).toHaveLength(0);

      releasePersistenceQueue(result.persistence);
    });
  });

  describe('failures the queue swallows', () => {
    // The sweep is detached, so its rejection has no other handler: without
    // this log a failed cleanup would read as an unhandled rejection, i.e. a
    // Blok crash. The save itself already landed.
    it('logs a failing orphan sweep and carries on', async () => {
      const warn = vi.spyOn(console, 'warn');
      const save = vi.fn().mockResolvedValue(undefined);
      const remove = vi.fn().mockResolvedValue(undefined);

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      orphanSweepFor(result.persistence)?.record('https://cdn.example/kept.png', remove);

      // A host is free to hand over anything; walking it is what throws.
      const hostile: OutputData = { blocks: [], time: 0, version: 'hostile' };

      Object.defineProperty(hostile, 'time', {
        enumerable: true,
        get() {
          throw new Error('hostile document');
        },
      });

      result.onSave?.(hostile, API_STUB);

      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('The orphan sweep failed. The document was saved either way.'),
          expect.any(Error)
        );
      });

      releasePersistenceQueue(result.persistence);
    });

    // Nothing awaits `inFlight`, so the terminal catch is the queue's only
    // handler: a throw escaping the aftermath would land on the page as an
    // unhandled rejection.
    it('logs an unexpected failure of the queue itself', async () => {
      const warn = vi.spyOn(console, 'warn');
      const save = vi.fn().mockResolvedValue(undefined);

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });
      const removed = vi.spyOn(window, 'removeEventListener').mockImplementation((type) => {
        if (type === 'beforeunload') {
          throw new Error('hostile window');
        }
      });

      result.onSave?.(DOC, API_STUB);

      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining('The save queue swallowed an unexpected error and carried on.'),
          expect.any(Error)
        );
      });

      removed.mockRestore();
      releasePersistenceQueue(result.persistence);
      await vi.waitFor(() => expect(fireBeforeUnload()).toBe(false));
    });
  });
});
