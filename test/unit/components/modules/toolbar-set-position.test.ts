/**
 * `toolbar.setPosition(position)` — runtime setter for `config.toolbarPosition`.
 *
 * The construction path stamps `DATA_ATTR.toolbarPosition` on the editor wrapper
 * once (ui.ts) — the CSS hook that swaps the editor gutter from inline-start to
 * inline-end and flips the actions bar from `right:100%` to `left:100%`. A
 * runtime toggle must write both the attribute and the live config, otherwise
 * the gutter and the floating controls end up on opposite sides.
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

describe('toolbar.setPosition', () => {
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

  it('defaults to the left gutter', async () => {
    const booted = await boot();

    expect(wrapper(booted).getAttribute(DATA_ATTR.toolbarPosition)).toBe('left');
    expect(booted.configuration.toolbarPosition).toBe('left');
  });

  it('stamps the wrapper attribute from config at construction', async () => {
    const booted = await boot({ toolbarPosition: 'right' });

    expect(wrapper(booted).getAttribute(DATA_ATTR.toolbarPosition)).toBe('right');
  });

  it('moves the controls to the right gutter at runtime', async () => {
    const booted = await boot();

    booted.moduleInstances.API.methods.toolbar.setPosition('right');

    expect(wrapper(booted).getAttribute(DATA_ATTR.toolbarPosition)).toBe('right');
    expect(booted.configuration.toolbarPosition).toBe('right');
  });

  it('moves the controls back to the left gutter at runtime', async () => {
    const booted = await boot({ toolbarPosition: 'right' });

    booted.moduleInstances.API.methods.toolbar.setPosition('left');

    expect(wrapper(booted).getAttribute(DATA_ATTR.toolbarPosition)).toBe('left');
    expect(booted.configuration.toolbarPosition).toBe('left');
  });

  it('keeps the toolbar usable after the side changes while it is open', async () => {
    const booted = await boot();
    const toolbarModule = booted.moduleInstances.Toolbar;
    const block = booted.moduleInstances.BlockManager.blocks[0];

    toolbarModule.moveAndOpen(block);
    expect(toolbarModule.opened).toBe(true);

    booted.moduleInstances.API.methods.toolbar.setPosition('right');

    expect(toolbarModule.opened).toBe(true);
  });

  it('reports the active side to the block-settings popover placement', async () => {
    const booted = await boot({ toolbarPosition: 'right' });

    expect(booted.moduleInstances.Toolbar.isPositionedRight).toBe(true);

    booted.moduleInstances.API.methods.toolbar.setPosition('left');

    expect(booted.moduleInstances.Toolbar.isPositionedRight).toBe(false);
  });
});
