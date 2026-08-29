import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expandPersistenceConfig } from '../../../../src/components/utils/persistence';
import type { API, BlokConfig, OutputData } from '../../../../types';

const DOC: OutputData = { blocks: [], time: 0, version: '1' };
const API_STUB = {} as API;

describe('expandPersistenceConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    const onError = vi.fn();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);

    const result = expandPersistenceConfig({ persistence: { load: async () => null, save, onError } });

    result.onSave?.(DOC, API_STUB);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));

    result.onSave?.(DOC, API_STUB);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  });

  it('does not mutate the config it was given', () => {
    const config: BlokConfig = { persistence: { load: async (): Promise<null> => null, save: vi.fn() } };

    expandPersistenceConfig(config);

    expect(config.onSave).toBeUndefined();
  });
});
