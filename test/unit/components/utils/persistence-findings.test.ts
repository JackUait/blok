/**
 * Regressions for five defects in the `persistence` save queue.
 *
 * Each `describe` below names the defect it pins. They live in their own file
 * rather than in `persistence.test.ts` because that file pins the CONTRACT the
 * queue is supposed to have; these pin the holes that were found in it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandPersistenceConfig, releasePersistenceQueue, unwrapPersistedDocument } from '../../../../src/components/utils/persistence';
import { orphanSweepFor } from '../../../../src/components/utils/orphan-sweep';
import type { API, OutputData } from '../../../../types';

const DOC: OutputData = { blocks: [], time: 0, version: '1' };
const API_STUB = {} as API;

/** Mirrors the backoff in persistence.ts: two retries, 500ms then 2000ms apart. */
const FIRST_RETRY_DELAY_MS = 500;
const SECOND_RETRY_DELAY_MS = 2000;
const ATTEMPTS = 3;
/** Long enough to carry a save through every attempt and its backoff. */
const RETRY_WINDOW_MS = FIRST_RETRY_DELAY_MS + SECOND_RETRY_DELAY_MS + 1;

/** The cadence the change pipeline delivers `onSave` at while a user types. */
const TYPING_CADENCE_MS = 400;

const asset = (name: string): string => `https://cdn.example/uploads/${name}.png`;

const documentWith = (url: string): OutputData => ({
  ...DOC,
  blocks: [ { id: 'b1', type: 'image', data: { file: { url } } } ],
});

describe('persistence — a host onSave must not disable the save queue (F5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Vue synthesizes `config.onSave` for a `v-model:data` binding and Angular
  // for `[formControl]`, so a host that never wrote an onSave of its own could
  // silently lose EVERY save: no endpoint call, no retry, no unload guard.
  it('still calls persistence.save when the host also supplied an onSave', async () => {
    const onSave = vi.fn();
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save }, onSave });

    result.onSave?.(DOC, API_STUB);
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(DOC, { version: null }));

    expect(onSave).toHaveBeenCalledWith(DOC, API_STUB);
  });

  it('arms the unload guard for a host-onSave editor with an unwritten save', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const save = vi.fn().mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
    });

    const result = expandPersistenceConfig({
      persistence: { load: async () => null, save },
      onSave: vi.fn(),
    });

    result.onSave?.(DOC, API_STUB);

    const guarded = new Event('beforeunload', { cancelable: true });

    window.dispatchEvent(guarded);

    expect(guarded.defaultPrevented).toBe(true);

    gate.release?.();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it('records the loaded version for a host-onSave editor', async () => {
    const save = vi.fn().mockResolvedValue(undefined);

    const result = expandPersistenceConfig({
      persistence: { load: async () => ({ data: DOC, version: 'v1' }), save },
      onSave: vi.fn(),
    });

    await result.persistence?.load();
    result.onSave?.(DOC, API_STUB);

    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(DOC, { version: 'v1' }));
  });

  it('gives a host-onSave editor an orphan sweep', () => {
    const result = expandPersistenceConfig({
      persistence: { load: async () => null, save: vi.fn().mockResolvedValue(undefined) },
      onSave: vi.fn(),
    });

    expect(orphanSweepFor(result.persistence)).toBeDefined();
  });
});

describe('persistence — the sweep must not delete assets a newer payload still names (F2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // The sweep runs against the payload that just landed. A newer payload
  // already sitting in the queue is the live document, and it may name the very
  // URL the landed one dropped — an undo, or an image added while the save was
  // in flight.
  it('never sweeps while a newer payload is queued', async () => {
    const url = asset('undone-mid-flight');
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

    // Save A leaves with the block already deleted…
    result.onSave?.(DOC, API_STUB);
    // …and the undo lands while A is still in flight.
    result.onSave?.(documentWith(url), API_STUB);

    gate.release?.();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    expect(remove).not.toHaveBeenCalled();
  });

  // The sweep is only deferred, never cancelled: once the queue is quiet, the
  // asset the newest saved document really dropped still goes.
  it('sweeps once the queue drains and the newest document has dropped the URL', async () => {
    const url = asset('really-orphaned');
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
    result.onSave?.(DOC, API_STUB);

    gate.release?.();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(url));
  });

  // An upload that resolves DURING a save records its URL immediately, before
  // the tool has written it into block data and ~400ms before the change
  // pipeline delivers the next payload. If the save lands inside that gap the
  // queue is empty, so the newer-payload gate sees nothing and the sweep would
  // delete a file the document is about to reference. A candidate recorded
  // after a save started is not that save's business.
  it('does not sweep an asset uploaded while the save was in flight', async () => {
    const url = asset('uploaded-mid-flight');
    const remove = vi.fn().mockResolvedValue(undefined);
    const gate: { release: (() => void) | null } = { release: null };
    const save = vi.fn().mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
    });

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    // The save leaves carrying a document that does not name the asset yet…
    result.onSave?.(DOC, API_STUB);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // …and the upload lands while it is still in flight, so the tool has not
    // written the URL into block data and nothing newer is queued.
    orphanSweepFor(result.persistence)?.record(url, remove);

    gate.release?.();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await Promise.resolve();

    expect(remove).not.toHaveBeenCalled();
  });
});

describe('persistence — a released queue must stop working (F12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // The retry of a destroyed editor can land AFTER the replacement editor's
  // first save and write an older document over a newer one — exactly the
  // out-of-order write the queue exists to prevent.
  it('does not retry a rejected save after the editor was destroyed', async () => {
    vi.useFakeTimers();

    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const result = expandPersistenceConfig({
      persistence: { load: async () => null, save, onError: vi.fn() },
    });

    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);

    releasePersistenceQueue(result.persistence);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not report a spent save to a destroyed editor', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });

    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    releasePersistenceQueue(result.persistence);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(onError).not.toHaveBeenCalled();
  });

  // Deleting files on behalf of an editor that is gone is unrecoverable: there
  // is no undo left to put the block back and no UI left to report the loss.
  it('does not delete assets after the editor was destroyed', async () => {
    vi.useFakeTimers();

    const url = asset('destroyed');
    const remove = vi.fn().mockResolvedValue(undefined);
    const gate: { release: (() => void) | null } = { release: null };
    const save = vi.fn().mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        gate.release = resolve;
      });
    });

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    orphanSweepFor(result.persistence)?.record(url, remove);
    result.onSave?.(DOC, API_STUB);

    releasePersistenceQueue(result.persistence);
    gate.release?.();
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(remove).not.toHaveBeenCalled();
  });

  // A payload delivered after destroy has no editor to belong to, so starting a
  // save for it would call the host's endpoint from a torn-down instance.
  it('does not start a save queued after the editor was destroyed', async () => {
    vi.useFakeTimers();

    const save = vi.fn().mockResolvedValue(undefined);
    const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    releasePersistenceQueue(result.persistence);
    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(save).not.toHaveBeenCalled();
  });
});

describe('persistence — a run of failures must be reported while the user types (F13)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Every delivery supersedes the payload in flight, so no single payload ever
  // spends its attempts and the "attempts are spent" report never fires. The
  // documented promise is that a host can render a not-saved indicator.
  it('reports an endpoint that rejects every save while edits keep arriving', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });

    for (let edit = 0; edit < 10; edit += 1) {
      result.onSave?.({ ...DOC, time: edit }, API_STUB);
      await vi.advanceTimersByTimeAsync(TYPING_CADENCE_MS);
    }

    expect(save.mock.calls.length).toBeGreaterThan(ATTEMPTS);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    // Leave the shared window quiet: a parked payload keeps the unload guard.
    save.mockResolvedValue(undefined);
    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);
  });

  // A blip inside an otherwise healthy run is not an outage, and reporting one
  // would make a "not saved" indicator flicker on every dropped request.
  it('stays silent when a rejection is followed by a save that lands', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(undefined);
    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });

    result.onSave?.({ ...DOC, time: 1 }, API_STUB);
    await vi.advanceTimersByTimeAsync(TYPING_CADENCE_MS);
    result.onSave?.({ ...DOC, time: 2 }, API_STUB);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(onError).not.toHaveBeenCalled();
  });

  // A landed save proves the endpoint is back, so the next outage has to earn
  // its own report rather than riding on the counter of the previous one.
  it('needs a fresh run of failures after a save has landed', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });

    result.onSave?.(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(RETRY_WINDOW_MS);

    expect(onError).toHaveBeenCalledTimes(1);

    save.mockResolvedValue(undefined);
    result.onSave?.({ ...DOC, time: 2 }, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    save.mockRejectedValue(new Error('offline again'));
    result.onSave?.({ ...DOC, time: 3 }, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    // One rejection after a healthy save is a blip, not a reportable outage.
    expect(onError).toHaveBeenCalledTimes(1);

    save.mockResolvedValue(undefined);
    result.onSave?.({ ...DOC, time: 4 }, API_STUB);
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe('persistence — load() resolving undefined must not break the boot (F14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // `const row = await db.get(id); if (!row) return;` is the natural JS shape,
  // and it resolves undefined. TypeScript stops a strict host; nothing stops a
  // JavaScript one.
  it('reads undefined as "nothing saved yet" instead of throwing', () => {
    expect(unwrapPersistedDocument(undefined as never)).toBeNull();
  });

  // Normalized rather than passed through: the published type promises `null`
  // for "nothing saved yet", and core's render gate is written against it.
  it('normalizes an undefined load to null instead of throwing', async () => {
    const result = expandPersistenceConfig({
      persistence: { load: async () => undefined as never, save: vi.fn().mockResolvedValue(undefined) },
    });

    await expect(result.persistence?.load()).resolves.toBeNull();
  });
});
