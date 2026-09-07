/**
 * The `persistence` save queue against a booted editor.
 *
 * Two things can only be seen from here. `handlers.set({ onSave })` writes the
 * SAME config object the queue installed itself into, so the runtime setter can
 * unhook the queue — and every React/Angular host reaches that setter without
 * asking for it. And `persistence.load` resolving nothing is a boot-time
 * failure: the throw lands inside `core.render()`, where no unit test of the
 * expansion could see it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { Paragraph } from '../../../../src/tools/paragraph';

import type { BlokConfig, OutputData } from '../../../../types';

/**
 * Minimal replica of Blok.destroy()'s module teardown so a Core booted
 * directly (to reach moduleInstances) does not leak listeners between tests.
 * @param core - booted core instance
 */
const destroyCore = (core: Core): void => {
  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as { markDestroyed?: () => void };

    if (typeof instance.markDestroyed === 'function') {
      instance.markDestroyed();
    }
  });

  Object.values(core.moduleInstances).forEach((moduleInstance) => {
    if (moduleInstance === undefined || moduleInstance === null) {
      return;
    }

    const instance = moduleInstance as {
      destroy?: () => void;
      listeners?: { removeAll?: () => void };
    };

    if (typeof instance.destroy === 'function') {
      instance.destroy();
    }

    if (instance.listeners && typeof instance.listeners.removeAll === 'function') {
      instance.listeners.removeAll();
    }
  });
};

const DOC: OutputData = { blocks: [], time: 0, version: '1' };

describe('persistence against a booted editor', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  const boot = async (configOverrides: Partial<BlokConfig> = {}): Promise<Core> => {
    core = new Core({
      holder,
      tools: { paragraph: { class: Paragraph } },
      ...configOverrides,
    });
    await core.isReady;

    return core;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(() => {
    if (core) {
      destroyCore(core);
    }
    core = undefined;
    holder?.remove();
    holder = undefined;
    vi.restoreAllMocks();
  });

  // The queue installs itself as `config.onSave`, and `handlers.set` writes that
  // very key on the very object core holds. React calls it the moment an
  // `onSave` prop appears; after that the queue is unreachable — `save` has one
  // call site and it is inside the closure that key held.
  it('keeps saving after handlers.set installs a host onSave (F6)', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const hostOnSave = vi.fn();
    const booted = await boot({
      data: { blocks: [{ type: 'paragraph', data: { text: 'hello' } }] },
      persistence: { load: async () => null, save },
    });

    booted.moduleInstances.API.methods.handlers.set({ onSave: hostOnSave });

    booted.configuration.onSave?.(DOC, booted.moduleInstances.API.methods);

    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(DOC, { version: null }));

    expect(hostOnSave).toHaveBeenCalledTimes(1);
  });

  // `onSave: undefined` is the documented unset direction, and an adapter sends
  // it whenever its host drops the prop. It must unset the HOST handler, never
  // the endpoint the editor was configured with.
  it('keeps saving after handlers.set clears onSave (F6)', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const booted = await boot({
      data: { blocks: [{ type: 'paragraph', data: { text: 'hello' } }] },
      persistence: { load: async () => null, save },
    });

    booted.moduleInstances.API.methods.handlers.set({ onSave: undefined });

    expect(typeof booted.configuration.onSave).toBe('function');

    booted.configuration.onSave?.(DOC, booted.moduleInstances.API.methods);

    await vi.waitFor(() => expect(save).toHaveBeenCalledWith(DOC, { version: null }));
  });

  // Without persistence the setter must stay exactly what it was: writing the
  // raw value, `undefined` included. Clearing is what keeps handler presence
  // reactive instead of a one-way latch.
  it('still unsets onSave for an editor without persistence', async () => {
    const booted = await boot({
      data: { blocks: [{ type: 'paragraph', data: { text: 'hello' } }] },
      onSave: vi.fn(),
    });

    booted.moduleInstances.API.methods.handlers.set({ onSave: undefined });

    expect(booted.configuration.onSave).toBeUndefined();
  });

  // `load: async () => { const row = await db.get(id); if (!row) return; ... }`
  // resolves undefined. That threw out of render(), so isReady rejected and the
  // editor came up with nothing in it — not even the default paragraph.
  it('boots with a default block when load resolves undefined (F14)', async () => {
    const booted = await boot({
      persistence: {
        load: async () => undefined as never,
        save: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(booted.moduleInstances.BlockManager.blocks.length).toBe(1);
  });
});
