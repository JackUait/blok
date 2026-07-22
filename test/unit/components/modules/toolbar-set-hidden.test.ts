/**
 * `toolbar.setHidden(hidden)` — runtime toggle for `config.hideToolbar`.
 *
 * The construction path stamps `DATA_ATTR.toolbarHidden` on the editor wrapper
 * once (ui.ts) — the CSS hook that collapses the gutter — while the toolbar's
 * open guards read `config.hideToolbar` live. A runtime toggle must write both,
 * otherwise the gutter stays stale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { Core } from '../../../../src/components/core';
import { Paragraph } from '../../../../src/tools/paragraph';

import type { BlokConfig } from '../../../../types';

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

describe('toolbar.setHidden', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  const boot = async (configOverrides: Partial<BlokConfig> = {}): Promise<Core> => {
    core = new Core({
      holder,
      tools: { paragraph: { class: Paragraph } },
      data: {
        blocks: [
          { type: 'paragraph', data: { text: 'hello' } },
        ],
      },
      ...configOverrides,
    });
    await core.isReady;

    /** Toolbar DOM is drawn inside requestIdleCallback (polyfilled via setTimeout) */
    await vi.waitFor(() => {
      const toolbarNodes = (core?.moduleInstances.Toolbar as unknown as { nodes: { wrapper?: HTMLElement } }).nodes;

      expect(toolbarNodes.wrapper).toBeDefined();
    });

    return core;
  };

  const wrapper = (booted: Core): HTMLElement => {
    const element = booted.moduleInstances.UI.nodes.wrapper;

    if (!(element instanceof HTMLElement)) {
      throw new Error('UI wrapper is not mounted');
    }

    return element;
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

  it('stamps the wrapper attribute when hiding at runtime', async () => {
    const booted = await boot();

    expect(wrapper(booted).hasAttribute(DATA_ATTR.toolbarHidden)).toBe(false);

    booted.moduleInstances.API.methods.toolbar.setHidden(true);

    expect(wrapper(booted).hasAttribute(DATA_ATTR.toolbarHidden)).toBe(true);
    expect(booted.configuration.hideToolbar).toBe(true);
  });

  it('removes the construction-time attribute when un-hiding at runtime', async () => {
    const booted = await boot({ hideToolbar: true });

    expect(wrapper(booted).hasAttribute(DATA_ATTR.toolbarHidden)).toBe(true);

    booted.moduleInstances.API.methods.toolbar.setHidden(false);

    expect(wrapper(booted).hasAttribute(DATA_ATTR.toolbarHidden)).toBe(false);
    expect(booted.configuration.hideToolbar).toBe(false);
  });

  it('the moveAndOpen guard respects the runtime value (hidden → does not open)', async () => {
    const booted = await boot();
    const toolbarModule = booted.moduleInstances.Toolbar;
    const block = booted.moduleInstances.BlockManager.blocks[0];

    expect(block).toBeDefined();

    booted.moduleInstances.API.methods.toolbar.setHidden(true);
    toolbarModule.moveAndOpen(block);

    expect(toolbarModule.opened).toBe(false);
  });

  it('the moveAndOpen guard respects the runtime value (un-hidden → opens)', async () => {
    const booted = await boot({ hideToolbar: true });
    const toolbarModule = booted.moduleInstances.Toolbar;
    const block = booted.moduleInstances.BlockManager.blocks[0];

    toolbarModule.moveAndOpen(block);
    expect(toolbarModule.opened).toBe(false);

    booted.moduleInstances.API.methods.toolbar.setHidden(false);
    toolbarModule.moveAndOpen(block);

    expect(toolbarModule.opened).toBe(true);
  });
});
