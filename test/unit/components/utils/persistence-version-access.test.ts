import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  expandPersistenceConfig,
  persistenceVersionAccess,
  releasePersistenceQueue,
} from '../../../../src/components/utils/persistence';

import type { API, BlokConfig } from '../../../../types';

const apiStub = {} as API;

describe('persistenceVersionAccess', () => {
  const configs: BlokConfig[] = [];

  const expand = (config: BlokConfig): BlokConfig => {
    const expanded = expandPersistenceConfig(config);

    configs.push(expanded);

    return expanded;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    configs.splice(0).forEach((config) => releasePersistenceQueue(config.persistence));
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reports the loaded version, then the saved one', async () => {
    const config = expand({
      persistence: {
        load: async () => ({ data: { blocks: [{ id: 'a', type: 'paragraph', data: { text: 'x' } }] }, version: 'v1' }),
        save: async () => ({ version: 'v2' }),
      },
    });
    const access = persistenceVersionAccess(config.persistence);
    const saved = vi.fn();

    access?.onSaved(saved);

    await config.persistence?.load();
    expect(access?.get()).toBe('v1');

    config.onSave?.({ blocks: [] }, apiStub);
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith('v2'));
    expect(access?.get()).toBe('v2');
  });

  it('lets a follower take over the version a leader broadcast', () => {
    const config = expand({ persistence: { load: async () => null, save: async () => {} } });

    persistenceVersionAccess(config.persistence)?.set('v9');
    expect(persistenceVersionAccess(config.persistence)?.get()).toBe('v9');
  });

  it('saves with the version a follower took over', async () => {
    const save = vi.fn(async () => undefined);
    const config = expand({ persistence: { load: async () => null, save } });

    persistenceVersionAccess(config.persistence)?.set('v9');
    config.onSave?.({ blocks: [] }, apiStub);

    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({ blocks: [] }, { version: 'v9' }));
  });

  it('reports the kept version when the endpoint reports none', async () => {
    const config = expand({ persistence: { load: async () => null, save: async () => undefined } });
    const access = persistenceVersionAccess(config.persistence);
    const saved = vi.fn();

    access?.set('v3');
    access?.onSaved(saved);
    config.onSave?.({ blocks: [] }, apiStub);

    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith('v3'));
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('fires once after a retried save lands, and never for the failed attempt', async () => {
    vi.useFakeTimers();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce({ version: 'v4' });
    const config = expand({ persistence: { load: async () => null, save } });
    const saved = vi.fn();

    persistenceVersionAccess(config.persistence)?.onSaved(saved);
    config.onSave?.({ blocks: [] }, apiStub);

    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(saved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(save).toHaveBeenCalledTimes(2);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith('v4');
  });

  it('stays silent while every attempt fails', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValue(new Error('down'));
    const config = expand({ persistence: { load: async () => null, save, onError: () => undefined } });
    const saved = vi.fn();

    persistenceVersionAccess(config.persistence)?.onSaved(saved);
    config.onSave?.({ blocks: [] }, apiStub);

    await vi.advanceTimersByTimeAsync(3000);
    expect(save).toHaveBeenCalledTimes(3);
    expect(saved).not.toHaveBeenCalled();
  });

  it('stops calling a listener once it unsubscribes', async () => {
    const save = vi.fn(async () => ({ version: 'v5' }));
    const config = expand({ persistence: { load: async () => null, save } });
    const saved = vi.fn();

    const off = persistenceVersionAccess(config.persistence)?.onSaved(saved);

    off?.();
    config.onSave?.({ blocks: [] }, apiStub);

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(saved).not.toHaveBeenCalled();
  });

  it('keeps the save landed when a listener throws', async () => {
    const save = vi.fn(async () => ({ version: 'v6' }));
    const config = expand({ persistence: { load: async () => null, save } });
    const access = persistenceVersionAccess(config.persistence);
    const after = vi.fn();

    access?.onSaved(() => {
      throw new Error('listener');
    });
    access?.onSaved(after);
    config.onSave?.({ blocks: [] }, apiStub);

    await vi.waitFor(() => expect(after).toHaveBeenCalledWith('v6'));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('answers null for an editor without persistence', () => {
    expect(persistenceVersionAccess(undefined)).toBeNull();
  });
});
