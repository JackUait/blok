/**
 * `readOnly.set(state, options?)` — backward-compatible extension of the
 * existing public set: `options.hideControls` writes the normalized
 * `config.readOnly` object form so the live `isControlsHidden` getter (which
 * recomputes from config on every access) picks it up at runtime.
 *
 * Also covers `readOnly.togglesInPlace` — the observability constant that
 * lets consumers assert the in-place toggle capability.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { Paragraph } from '../../../../src/tools/paragraph';
import { Blok } from '../../../../src/blok';

import type { ReadOnly as ReadOnlyAPI } from '../../../../types/api';

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

describe('readOnly.set with options', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  const boot = async (): Promise<Core> => {
    core = new Core({
      holder,
      tools: { paragraph: { class: Paragraph } },
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

  it('set(true, { hideControls: true }) flips isControlsHidden on', async () => {
    const booted = await boot();
    const readOnlyApi = booted.moduleInstances.API.methods.readOnly;

    expect(booted.moduleInstances.ReadOnly.isControlsHidden).toBe(false);

    await readOnlyApi.set(true, { hideControls: true });

    expect(booted.moduleInstances.ReadOnly.isEnabled).toBe(true);
    expect(booted.moduleInstances.ReadOnly.isControlsHidden).toBe(true);
  });

  it('set(true, { hideControls: false }) flips isControlsHidden back off while staying read-only', async () => {
    const booted = await boot();
    const readOnlyApi = booted.moduleInstances.API.methods.readOnly;

    await readOnlyApi.set(true, { hideControls: true });
    expect(booted.moduleInstances.ReadOnly.isControlsHidden).toBe(true);

    await readOnlyApi.set(true, { hideControls: false });

    expect(booted.moduleInstances.ReadOnly.isEnabled).toBe(true);
    expect(booted.moduleInstances.ReadOnly.isControlsHidden).toBe(false);
  });

  it('plain boolean call keeps working unchanged (backward compatibility)', async () => {
    const booted = await boot();
    const readOnlyApi = booted.moduleInstances.API.methods.readOnly;

    await readOnlyApi.set(true);
    expect(booted.moduleInstances.ReadOnly.isEnabled).toBe(true);

    await readOnlyApi.set(false);
    expect(booted.moduleInstances.ReadOnly.isEnabled).toBe(false);
    expect(booted.moduleInstances.ReadOnly.isControlsHidden).toBe(false);
  });

  it('isControlsHidden goes false when read-only is disabled, whatever the last options were', async () => {
    const booted = await boot();
    const readOnlyApi = booted.moduleInstances.API.methods.readOnly;

    await readOnlyApi.set(true, { hideControls: true });
    await readOnlyApi.set(false);

    expect(booted.moduleInstances.ReadOnly.isControlsHidden).toBe(false);
  });

  describe('togglesInPlace', () => {
    it('is true on the API methods object', async () => {
      const booted = await boot();

      expect(booted.moduleInstances.API.methods.readOnly.togglesInPlace).toBe(true);
    });

    it('is true on a booted Blok instance', async () => {
      const blokHolder = document.createElement('div');

      document.body.appendChild(blokHolder);

      const editor = new Blok({ holder: blokHolder, minHeight: 50 });

      await editor.isReady;

      const readOnlyApi = (editor as unknown as { readOnly: ReadOnlyAPI }).readOnly;

      expect(readOnlyApi.togglesInPlace).toBe(true);

      await editor.destroy();
      blokHolder.remove();
    });
  });
});
