/**
 * A holder marked `data-blok-no-controls` gets no block controls (+ and the
 * drag handle). A full database row page marks its database's holder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATA_ATTR } from '../../../../src/components/constants/data-attributes';
import { Core } from '../../../../src/components/core';
import { Paragraph } from '../../../../src/tools/paragraph';


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

describe('toolbar — a holder marked no-controls', () => {
  let holder: HTMLDivElement | undefined;
  let core: Core | undefined;

  const boot = async (): Promise<Core> => {
    core = new Core({
      holder,
      tools: { paragraph: { class: Paragraph } },
      data: { blocks: [{ type: 'paragraph', data: { text: 'hello' } }] },
    });
    await core.isReady;
    await vi.waitFor(() => {
      const toolbarNodes = (core?.moduleInstances.Toolbar as unknown as { nodes: { wrapper?: HTMLElement } }).nodes;

      expect(toolbarNodes.wrapper).toBeDefined();
    });

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

  it('does not open for the marked block, and opens again once the mark goes', async () => {
    const booted = await boot();
    const toolbarModule = booted.moduleInstances.Toolbar;
    const block = booted.moduleInstances.BlockManager.blocks[0];

    if (block === undefined) throw new Error('no block');
    block.holder.setAttribute(DATA_ATTR.noControls, '');
    toolbarModule.moveAndOpen(block);

    expect(toolbarModule.opened).toBe(false);

    block.holder.removeAttribute(DATA_ATTR.noControls);
    toolbarModule.moveAndOpen(block);

    expect(toolbarModule.opened).toBe(true);
  });
});
