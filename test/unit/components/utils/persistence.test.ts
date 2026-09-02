import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandPersistenceConfig, releasePersistenceQueue } from '../../../../src/components/utils/persistence';
import { orphanSweepFor } from '../../../../src/components/utils/orphan-sweep';
import type { API, BlokConfig, OutputData } from '../../../../types';

const DOC: OutputData = { blocks: [], time: 0, version: '1' };
const API_STUB = {} as API;

/** Mirrors the backoff in persistence.ts: two retries, 500ms then 2000ms apart. */
const FIRST_RETRY_DELAY_MS = 500;
const SECOND_RETRY_DELAY_MS = 2000;
const ATTEMPTS = 3;
/** Long enough to carry a save through every attempt and its backoff. */
const RETRY_WINDOW_MS = FIRST_RETRY_DELAY_MS + SECOND_RETRY_DELAY_MS + 1;

describe('expandPersistenceConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /**
   * Dispatches the event the browser sends when the tab is closing and reports
   * whether the guard held it back.
   */
  const fireBeforeUnload = (): boolean => {
    const event = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(event);

    return event.defaultPrevented;
  };

  it('leaves a config without `persistence` untouched', () => {
    const config = { holder: 'app' };

    expect(expandPersistenceConfig(config)).toEqual(config);
  });

  it('wires save() into onSave', () => {
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    result.onSave?.(DOC, API_STUB);

    expect(save).toHaveBeenCalledWith(DOC, { version: null });
  });

  // The version is what a consumer's endpoint needs for an `If-Match`. Blok
  // only carries it between load and save — it never compares two versions and
  // never resolves a conflict, because it does not own the stored document.
  it('passes a null version when the loaded document reported none', async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load: async () => DOC, save } });

    await result.persistence?.load();
    result.onSave?.(DOC, API_STUB);

    expect(save).toHaveBeenCalledWith(DOC, { version: null });
  });

  it('passes the version load reported', async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({
      persistence: { load: async () => ({ data: DOC, version: 'v1' }), save },
    });

    await result.persistence?.load();
    result.onSave?.(DOC, API_STUB);

    expect(save).toHaveBeenCalledWith(DOC, { version: 'v1' });
  });

  it('passes the version a save returned to the next save', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ version: 'v2' })
      .mockResolvedValue(undefined);

    const result = expandPersistenceConfig({
      persistence: { load: async () => ({ data: DOC, version: 'v1' }), save },
    });

    await result.persistence?.load();

    result.onSave?.(DOC, API_STUB);
    expect(save).toHaveBeenNthCalledWith(1, DOC, { version: 'v1' });

    result.onSave?.({ ...DOC, time: 2 }, API_STUB);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    expect(save).toHaveBeenNthCalledWith(2, { ...DOC, time: 2 }, { version: 'v2' });
  });

  // An endpoint that does not version returns nothing at all: the version it
  // was given must survive, or a versioned store would lose it on the first
  // save that answered with an empty body.
  it('keeps the previous version when a save returns nothing', async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({
      persistence: { load: async () => ({ data: DOC, version: 'v1' }), save },
    });

    await result.persistence?.load();

    result.onSave?.(DOC, API_STUB);
    result.onSave?.({ ...DOC, time: 2 }, API_STUB);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    expect(save).toHaveBeenNthCalledWith(2, { ...DOC, time: 2 }, { version: 'v1' });
  });

  // Every documented example returns the document itself; the envelope is opt-in.
  it('accepts a bare document from load and hands it back unchanged', async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load: async () => DOC, save } });

    await expect(result.persistence?.load()).resolves.toEqual(DOC);

    result.onSave?.(DOC, API_STUB);

    expect(save).toHaveBeenCalledWith(DOC, { version: null });
  });

  // Loading is NOT wired into `data`: that key is read synchronously while the
  // config is normalized and cannot hold a promise. The editor awaits load()
  // once, right before its first render — see core.test.ts.
  it('leaves data alone, including when the host supplied none', () => {
    const result = expandPersistenceConfig({ persistence: { load: async () => DOC, save: vi.fn() } });

    expect(result.data).toBeUndefined();
  });

  it('keeps an onSave the host set instead of replacing it', () => {
    const onSave = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save }, onSave });

    result.onSave?.(DOC, API_STUB);

    expect(onSave).toHaveBeenCalledWith(DOC, API_STUB);
    expect(save).not.toHaveBeenCalled();
  });

  // onSave is already debounced upstream, but a slow save can still be overtaken
  // by the next one. Out-of-order completion would resurrect stale content.
  it('never runs two saves concurrently and always sends the newest payload last', async () => {
    const started: OutputData[] = [];
    const gate: { release: (() => void) | null } = { release: null };
    const save = vi.fn().mockImplementation(async (data: OutputData) => {
      started.push(data);

      if (started.length === 1) {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      }
    });

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });
    const first = { ...DOC, time: 1 };
    const second = { ...DOC, time: 2 };
    const third = { ...DOC, time: 3 };

    result.onSave?.(first, API_STUB);
    result.onSave?.(second, API_STUB);
    result.onSave?.(third, API_STUB);

    expect(started).toEqual([first]);

    gate.release?.();
    await vi.waitFor(() => expect(started).toHaveLength(2));

    // Only the newest queued payload is sent: the intermediate one is obsolete.
    expect(started[1]).toEqual(third);
  });

  it('reports a failed save without stopping later saves', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('offline'));

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });

    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    save.mockResolvedValue(undefined);
    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(ATTEMPTS + 1);
  });

  // A save rejects far more often from a blip than from a broken endpoint, so
  // the first answer to a rejection is to try again rather than to bother the
  // consumer. onError is the report of a loss, and there is no loss until the
  // attempts are spent.
  it('retries a rejecting save with backoff before reporting it', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('offline'));

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });

    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SECOND_RETRY_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(ATTEMPTS);
    expect(save).toHaveBeenLastCalledWith(DOC, { version: null });

    // Land a successful save before leaving: a spent payload keeps the unload
    // guard attached by design, and every test in this file shares one window.
    save.mockResolvedValue(undefined);
    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('reports a spent save once, not once per attempt', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('offline'));

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });

    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(save).toHaveBeenCalledTimes(ATTEMPTS);
    expect(onError).toHaveBeenCalledTimes(1);

    // Land a successful save before leaving: a spent payload keeps the unload
    // guard attached by design, and every test in this file shares one window.
    save.mockResolvedValue(undefined);
    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);
  });

  // Dropping the payload once the attempts are spent loses the only copy of the
  // newest document Blok holds. It stays queued instead, so the next change
  // carries it out rather than burying it.
  it('keeps a payload whose retries are spent queued for the next change', async () => {
    vi.useFakeTimers();

    const save = vi.fn().mockRejectedValue(new Error('offline'));

    const result = expandPersistenceConfig({
      persistence: { load: async () => null, save, onError: vi.fn() },
    });

    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(save).toHaveBeenCalledTimes(ATTEMPTS);
    // Still unsaved work: the tab must not close quietly on it.
    expect(fireBeforeUnload()).toBe(true);

    // And it is not retried on its own — only a change restarts the queue.
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(save).toHaveBeenCalledTimes(ATTEMPTS);

    save.mockResolvedValue(undefined);

    const newer = { ...DOC, time: 2 };

    result.onSave?.(newer, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(ATTEMPTS + 1);
    expect(save).toHaveBeenLastCalledWith(newer, { version: null });
    expect(fireBeforeUnload()).toBe(false);
  });

  // The queue's rule is that only the newest document is worth writing. A retry
  // of a document a newer one has already replaced would write stale content —
  // and its failure is not a loss, because the newer payload carries it.
  it('abandons the retry for a document a newer one replaced', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });
    const stale = { ...DOC, time: 1 };
    const newer = { ...DOC, time: 2 };

    result.onSave?.(stale, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);

    result.onSave?.(newer, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(newer, { version: null });

    // The stale payload's backoff must not wake up and send it after the newer one.
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(save).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it('warns before unload while a save is pending or in flight, and not otherwise', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const save = vi.fn().mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
    });

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    expect(fireBeforeUnload()).toBe(false);

    result.onSave?.(DOC, API_STUB);

    expect(fireBeforeUnload()).toBe(true);

    gate.release?.();
    await vi.waitFor(() => expect(fireBeforeUnload()).toBe(false));
  });

  // A beforeunload listener that outlives the work it guards blocks navigation
  // forever, so the queue holds one only while it has something to lose.
  it('leaves no unload listener behind once the queue is empty', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    expect(added.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0);

    result.onSave?.(DOC, API_STUB);

    const attached = added.mock.calls.filter(([type]) => type === 'beforeunload');

    expect(attached).toHaveLength(1);

    await vi.waitFor(() => {
      expect(removed.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
    });

    const [, attachedHandler] = attached[0];
    const [, detachedHandler] = removed.mock.calls.filter(([type]) => type === 'beforeunload')[0];

    expect(detachedHandler).toBe(attachedHandler);
    expect(fireBeforeUnload()).toBe(false);
  });

  // The queue detaches its own listener when it runs out of work, which covers
  // every case but one: an editor destroyed while a save is still unwritten.
  // In a single-page app that leaked listener asks the user to confirm every
  // later navigation, for an editor that is no longer on the page.
  it('removes the unload guard when released with a save in flight', async () => {
    vi.useFakeTimers();

    const gate: { reject: ((reason: Error) => void) | null } = { reject: null };
    const save = vi.fn().mockImplementation(() => new Promise<void>((_resolve, reject) => {
      gate.reject = reject;
    }));

    const result = expandPersistenceConfig({
      persistence: { load: async () => null, save, onError: vi.fn() },
    });

    result.onSave?.(DOC, API_STUB);

    expect(fireBeforeUnload()).toBe(true);

    releasePersistenceQueue(result.persistence);

    expect(fireBeforeUnload()).toBe(false);

    // The save the destroyed editor left behind still runs to its end: it
    // rejects, retries, and parks. None of that bookkeeping may put back the
    // listener the release just took off.
    save.mockRejectedValue(new Error('offline'));
    gate.reject?.(new Error('offline'));
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(fireBeforeUnload()).toBe(false);
  });

  it('removes the unload guard when released with a payload parked', async () => {
    vi.useFakeTimers();

    const save = vi.fn().mockRejectedValue(new Error('offline'));

    const result = expandPersistenceConfig({
      persistence: { load: async () => null, save, onError: vi.fn() },
    });

    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(save).toHaveBeenCalledTimes(ATTEMPTS);
    expect(fireBeforeUnload()).toBe(true);

    releasePersistenceQueue(result.persistence);

    expect(fireBeforeUnload()).toBe(false);
  });

  // destroy() can be reached more than once, and two editors share one window:
  // a release that removed anything but its own editor's listener would let a
  // torn-down editor silence the guard of a live one.
  it('releases twice without throwing and leaves another editor guarding', async () => {
    const gates: Array<() => void> = [];
    const save = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      gates.push(resolve);
    }));

    const mine = expandPersistenceConfig({ persistence: { load: async () => null, save } });
    const theirs = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    mine.onSave?.(DOC, API_STUB);
    theirs.onSave?.(DOC, API_STUB);

    expect(fireBeforeUnload()).toBe(true);

    releasePersistenceQueue(mine.persistence);
    releasePersistenceQueue(mine.persistence);

    expect(fireBeforeUnload()).toBe(true);

    releasePersistenceQueue(theirs.persistence);

    expect(fireBeforeUnload()).toBe(false);

    gates.forEach((release) => release());
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  // destroy() runs for every editor, and most of them never saw `persistence`:
  // the release has to be a no-op for a config that has no queue behind it.
  it('releases harmlessly for an editor that had no persistence', () => {
    const config = expandPersistenceConfig({ holder: 'app' });

    expect(() => releasePersistenceQueue(config.persistence)).not.toThrow();
  });

  // The sweep needs a reliable "the document was written" signal, and this
  // queue is the only place that has one.
  describe('the orphan sweep', () => {
    const asset = (name: string): string => `https://cdn.example/uploads/${name}.png`;

    const documentWith = (url: string): OutputData => ({
      ...DOC,
      blocks: [ { id: 'b1', type: 'image', data: { file: { url } } } ],
    });

    it('deletes an asset this session uploaded once a save lands without it', async () => {
      const url = asset('landed');
      const remove = vi.fn().mockResolvedValue(undefined);
      const save = vi.fn().mockResolvedValue(undefined);

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      orphanSweepFor(result.persistence)?.record(url, remove);
      result.onSave?.(DOC, API_STUB);

      await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(url));
    });

    it('leaves an asset the saved document still references alone', async () => {
      const url = asset('still-used');
      const remove = vi.fn().mockResolvedValue(undefined);
      const save = vi.fn().mockResolvedValue(undefined);

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      orphanSweepFor(result.persistence)?.record(url, remove);
      result.onSave?.(documentWith(url), API_STUB);

      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

      expect(remove).not.toHaveBeenCalled();
    });

    // A save that never landed says nothing about what the stored document
    // references, so sweeping on it would delete assets a live document uses.
    it('sweeps nothing for a save that failed, nor for the payload it parked', async () => {
      vi.useFakeTimers();

      const url = asset('unsaved');
      const remove = vi.fn().mockResolvedValue(undefined);
      const save = vi.fn().mockRejectedValue(new Error('offline'));

      const result = expandPersistenceConfig({
        persistence: { load: async () => null, save, onError: vi.fn() },
      });

      orphanSweepFor(result.persistence)?.record(url, remove);
      result.onSave?.(DOC, API_STUB);
      await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

      expect(save).toHaveBeenCalledTimes(ATTEMPTS);
      expect(remove).not.toHaveBeenCalled();

      // The payload is parked, not saved: draining is not a written document.
      await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

      expect(remove).not.toHaveBeenCalled();

      // Land a successful save that still references the asset, so the unload
      // guard is released without the sweep taking it.
      save.mockResolvedValue(undefined);
      result.onSave?.(documentWith(url), API_STUB);
      await vi.advanceTimersByTimeAsync(0);

      expect(remove).not.toHaveBeenCalled();
    });

    it('sweeps after a save that only succeeded on a retry', async () => {
      vi.useFakeTimers();

      const url = asset('retried');
      const remove = vi.fn().mockResolvedValue(undefined);
      const save = vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue(undefined);

      const result = expandPersistenceConfig({
        persistence: { load: async () => null, save, onError: vi.fn() },
      });

      orphanSweepFor(result.persistence)?.record(url, remove);
      result.onSave?.(DOC, API_STUB);
      await vi.advanceTimersByTimeAsync(FIRST_RETRY_DELAY_MS);

      expect(save).toHaveBeenCalledTimes(2);
      expect(remove).toHaveBeenCalledWith(url);
    });

    // Undo: the user deletes a block and puts it back before the queue gets to
    // the document that lacked it. The saved document is the one with the URL,
    // so the asset was never an orphan.
    it('never sweeps a URL whose absence no saved document carried', async () => {
      const url = asset('undone');
      const remove = vi.fn().mockResolvedValue(undefined);
      const gate: { release: (() => void) | null } = { release: null };
      const save = vi.fn()
        .mockImplementationOnce(async () => {
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
        })
        .mockResolvedValue(undefined);

      const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

      orphanSweepFor(result.persistence)?.record(url, remove);

      result.onSave?.(documentWith(url), API_STUB);
      // The block is deleted…
      result.onSave?.(DOC, API_STUB);
      // …and undone, before either document reached the store.
      result.onSave?.(documentWith(url), API_STUB);

      gate.release?.();
      await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

      expect(save).toHaveBeenLastCalledWith(documentWith(url), { version: null });
      expect(remove).not.toHaveBeenCalled();
    });
  });

  it('does not mutate the config it was given', () => {
    const config: BlokConfig = { persistence: { load: async (): Promise<null> => null, save: vi.fn() } };

    expandPersistenceConfig(config);

    expect(config.onSave).toBeUndefined();
  });
});

describe('expandPersistenceConfig — one candidate set per editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Two editors on one page share nothing else, and they must not share this:
  // a set held by the module would let the editor that saves delete an asset
  // the OTHER editor just uploaded, leaving a live document pointing at a file
  // that is gone. Session provenance means nothing if "session" means "page".
  it('never sweeps an asset another editor on the page uploaded', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue(undefined);

    const uploading = expandPersistenceConfig({
      persistence: { load: async () => null, save: vi.fn().mockResolvedValue(undefined) },
    });
    const saving = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    orphanSweepFor(uploading.persistence)?.record('https://cdn/theirs.png', remove);

    saving.onSave?.({ blocks: [] }, API_STUB);
    await vi.waitFor(() => expect(save).toHaveBeenCalled());

    expect(remove).not.toHaveBeenCalled();
  });

  it('sweeps through the set belonging to the editor that saved', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const save = vi.fn().mockResolvedValue(undefined);
    const config = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    orphanSweepFor(config.persistence)?.record('https://cdn/ours.png', remove);

    config.onSave?.({ blocks: [] }, API_STUB);
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('https://cdn/ours.png'));
  });
});
