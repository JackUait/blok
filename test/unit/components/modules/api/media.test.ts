import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaAPI } from '../../../../../src/components/modules/api/media';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';

describe('MediaAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards every method to MediaFailures', async () => {
    const report = vi.fn();
    const clear = vi.fn();
    const confirmLeave = vi.fn(() => Promise.resolve(false));
    const api = new MediaAPI({ config: {}, eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } } as unknown as ModuleConfig);
    const failure = { blockId: 'b', tool: 'image', kind: 'load' as const, retry: vi.fn() };

    api.state = { MediaFailures: { report, clear, confirmLeave } } as unknown as BlokModules;
    api.methods.reportFailure(failure);
    api.methods.clearFailure('b');

    await expect(api.methods.confirmLeave()).resolves.toBe(false);
    expect(report).toHaveBeenCalledWith(failure);
    expect(clear).toHaveBeenCalledWith('b');
  });
});
