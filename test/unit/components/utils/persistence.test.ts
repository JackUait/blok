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

    expect(save).toHaveBeenCalledWith(DOC);
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
