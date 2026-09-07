import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { expandPersistenceConfig, releasePersistenceQueue } from '../../../../src/components/utils/persistence';
import { orphanSweepFor } from '../../../../src/components/utils/orphan-sweep';
import type { API, BlokConfig, OutputData } from '../../../../types';

/**
 * Asset deletion is not part of writing the document.
 *
 * The sweep used to be awaited inside the attempt whose promise IS
 * `queue.inFlight`, and `drain()` refuses to start while that is non-null — so a
 * `/delete` route that never answers (the built-in fetch uploader sends its
 * delete with no timeout and no AbortSignal) stopped every LATER document save
 * for the rest of the session.
 */

const DOC: OutputData = { blocks: [], time: 0, version: '1' };
const API_STUB = {} as API;

const asset = (name: string): string => `https://cdn.example/uploads/${name}.png`;

const documentWith = (url: string): OutputData => ({
  ...DOC,
  blocks: [ { id: 'b1', type: 'image', data: { file: { url } } } ],
});

/** Ten simulated minutes: far longer than any retry or backoff in the queue. */
const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * Dispatches the event the browser sends when the tab is closing and reports
 * whether the queue's guard held it back.
 */
const fireBeforeUnload = (): boolean => {
  const event = new Event('beforeunload', { cancelable: true });

  window.dispatchEvent(event);

  return event.defaultPrevented;
};

describe('expandPersistenceConfig — an asset deletion that never answers', () => {
  const owners: Array<BlokConfig['persistence']> = [];

  /**
   * A removal that is issued and never settles, the way an unresponsive
   * `/delete` route behaves for a request with no timeout.
   */
  const hangingRemove = (): Mock<(url: string) => Promise<void>> => vi.fn(
    (_url: string) => new Promise<void>(() => undefined)
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    owners.splice(0).forEach((owner) => {
      releasePersistenceQueue(owner);
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createQueue = (): {
    onSave: NonNullable<BlokConfig['onSave']>;
    save: Mock;
    remove: Mock<(url: string) => Promise<void>>;
    url: string;
  } => {
    const url = asset('hanging');
    const remove = hangingRemove();
    const save = vi.fn().mockResolvedValue(undefined);
    const result = expandPersistenceConfig({ persistence: { load: async () => null, save } });

    owners.push(result.persistence);
    orphanSweepFor(result.persistence)?.record(url, remove);

    const onSave = result.onSave;

    if (onSave === undefined) {
      throw new Error('the expansion did not wire a save handler');
    }

    return {
      onSave,
      save,
      remove,
      url,
    };
  };

  it('still writes every later document while the deletion hangs', async () => {
    const { onSave, save, remove } = createQueue();

    onSave(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);

    // The user keeps typing. The document has to reach the store.
    onSave(documentWith(asset('later')), API_STUB);
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(save).toHaveBeenCalledTimes(2);
  });

  it('stops asking the user to confirm a close over a document already stored', async () => {
    const { onSave } = createQueue();

    onSave(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    expect(fireBeforeUnload()).toBe(false);
  });

  it('does not re-issue a removal that is still in flight', async () => {
    const { onSave, remove } = createQueue();

    onSave(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(0);

    expect(remove).toHaveBeenCalledTimes(1);

    // A second save whose document still lacks the URL. The removal from the
    // first save has not answered, so the asset may or may not be gone —
    // issuing a second delete for it is the queue talking to itself.
    onSave(DOC, API_STUB);
    await vi.advanceTimersByTimeAsync(TEN_MINUTES_MS);

    expect(remove).toHaveBeenCalledTimes(1);
  });
});
