import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaAPI } from '../../../../../src/components/modules/api/media';
import { holdLeave } from '../../../../../src/components/utils/leave-guards';
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

    api.state = { MediaFailures: { report, clear, confirmLeave }, UI: { nodes: { wrapper: document.createElement('div') } } } as unknown as BlokModules;
    api.methods.reportFailure(failure);
    api.methods.clearFailure('b');
    api.methods.clearFailure('c', { recovered: true });

    await expect(api.methods.confirmLeave()).resolves.toBe(false);
    expect(report).toHaveBeenCalledWith(failure);
    expect(clear).toHaveBeenCalledWith('b', undefined);
    expect(clear).toHaveBeenCalledWith('c', { recovered: true });
  });

  describe('confirmLeave', () => {
    const setup = (imagesLeave: boolean): { api: MediaAPI; wrapper: HTMLElement; images: ReturnType<typeof vi.fn> } => {
      const wrapper = document.createElement('div');
      const images = vi.fn(() => Promise.resolve(imagesLeave));
      const api = new MediaAPI({ config: {}, eventsDispatcher: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } } as unknown as ModuleConfig);

      api.state = { MediaFailures: { confirmLeave: images }, UI: { nodes: { wrapper } } } as unknown as BlokModules;

      return { api, wrapper, images };
    };

    it('stays without asking about images when a question inside the editor says stay', async () => {
      const { api, wrapper, images } = setup(true);
      const anchor = document.createElement('div');

      wrapper.append(anchor);
      const release = holdLeave(anchor, () => Promise.resolve(false));

      await expect(api.methods.confirmLeave()).resolves.toBe(false);
      expect(images).not.toHaveBeenCalled();
      release();
    });

    it('asks about images once every question inside the editor lets the user leave', async () => {
      const { api, wrapper, images } = setup(false);
      const anchor = document.createElement('div');

      wrapper.append(anchor);
      const release = holdLeave(anchor, () => Promise.resolve(true));

      await expect(api.methods.confirmLeave()).resolves.toBe(false);
      expect(images).toHaveBeenCalledTimes(1);
      release();
    });

    it('ignores a question from another editor', async () => {
      const { api } = setup(true);
      const ask = vi.fn(() => Promise.resolve(false));
      const release = holdLeave(document.createElement('div'), ask);

      await expect(api.methods.confirmLeave()).resolves.toBe(true);
      expect(ask).not.toHaveBeenCalled();
      release();
    });
  });
});
