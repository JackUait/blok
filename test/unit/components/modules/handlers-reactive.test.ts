/**
 * `handlers.set(handlers)` — the runtime half of the live callback config.
 *
 * The core consults `config.onSubmit`, `config.onSave`, `config.onChange`,
 * `config.onEnter`, `config.onBeforeRender` and `config.onAfterRender` LIVE, on
 * every keypress / change batch / render — and for several of them the mere
 * PRESENCE of the handler is load-bearing (an `onSubmit` function turns Enter
 * from "split the block" into "serialize and submit"; an `onSave` function arms
 * the whole change-observation pipeline). Because there was no runtime setter,
 * adapters had to decide presence once, at construction, and a host that wanted
 * to add or drop a callback had to destroy and rebuild the editor.
 *
 * These tests pin the contract in both directions — the CLEARING direction in
 * particular: a setter that cannot write `undefined` would leave an editor
 * permanently believing `onSubmit` exists, turning Enter into submit forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Core } from '../../../../src/components/core';
import { BlockChanged } from '../../../../src/components/events';
import { Paragraph } from '../../../../src/tools/paragraph';

import type { BlokConfig, OutputBlockData, OutputData } from '../../../../types';

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

describe('handlers.set', () => {
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

    return core;
  };

  /**
   * Presses Enter with the caret at the end of the first block, straight
   * through the module the DOM keydown listener delegates to.
   *
   * jsdom does not reflect the `contentEditable` property onto an attribute, so
   * the editor's input discovery (`[contenteditable=true]`) finds nothing unless
   * the attribute is stamped here — without an input, Enter would fall through
   * to the caret-in-the-middle split path instead of the append path.
   * @param booted - booted core instance
   */
  const pressEnter = (booted: Core): void => {
    const block = booted.moduleInstances.BlockManager.blocks[0];
    const input = block.holder.querySelector('[data-blok-tool]');

    if (!(input instanceof HTMLElement)) {
      throw new Error('block has no tool element to type into');
    }

    input.setAttribute('contenteditable', 'true');

    const range = document.createRange();

    range.selectNodeContents(input);
    range.collapse(false);

    const selection = window.getSelection();

    selection?.removeAllRanges();
    selection?.addRange(range);

    const event = new KeyboardEvent('keydown', { key: 'Enter' });

    Object.defineProperty(event, 'target', {
      value: input,
      configurable: true,
    });

    booted.moduleInstances.BlockEvents.keydown(event);
  };

  /**
   * Emits a block mutation on the editor's own event bus — the signal the
   * change-observation pipeline (onChange / onSave) batches and delivers.
   * @param booted - booted core instance
   */
  const emitBlockChange = (booted: Core): void => {
    booted.moduleInstances.API.methods.events.emit(BlockChanged, {
      event: new CustomEvent('block-changed', {
        detail: { target: { id: booted.moduleInstances.BlockManager.blocks[0].id } },
      }),
    });
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

  it('arms onSubmit at runtime: Enter stops splitting and delivers the serialized document', async () => {
    const booted = await boot();

    /** Baseline: with no onSubmit configured, Enter splits the block. */
    pressEnter(booted);
    expect(booted.moduleInstances.BlockManager.blocks.length).toBe(2);

    const onSubmit = vi.fn();

    booted.moduleInstances.API.methods.handlers.set({ onSubmit });

    const blocksBefore = booted.moduleInstances.BlockManager.blocks.length;

    pressEnter(booted);

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(booted.moduleInstances.BlockManager.blocks.length).toBe(blocksBefore);

    const submitted = onSubmit.mock.calls[0][0] as OutputData;

    expect(Array.isArray(submitted.blocks)).toBe(true);
  });

  it('clears onSubmit at runtime: Enter splits the block again', async () => {
    const onSubmit = vi.fn();
    const booted = await boot({ onSubmit });

    /** Baseline: a configured onSubmit preempts the split. */
    pressEnter(booted);
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(booted.moduleInstances.BlockManager.blocks.length).toBe(1);

    booted.moduleInstances.API.methods.handlers.set({ onSubmit: undefined });

    pressEnter(booted);

    expect(booted.moduleInstances.BlockManager.blocks.length).toBe(2);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('leaves handlers the caller did not mention untouched', async () => {
    const onSubmit = vi.fn();
    const booted = await boot({ onSubmit });

    booted.moduleInstances.API.methods.handlers.set({ onSave: vi.fn() });

    pressEnter(booted);

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(booted.moduleInstances.BlockManager.blocks.length).toBe(1);
  });

  it('arms onSave at runtime: a change batch now serializes and delivers', async () => {
    const booted = await boot();
    const onSave = vi.fn();

    booted.moduleInstances.API.methods.handlers.set({ onSave });

    emitBlockChange(booted);

    await vi.waitFor(
      () => {
        expect(onSave).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 }
    );
  });

  it('clears onSave at runtime: the change pipeline stops delivering', async () => {
    const onSave = vi.fn();
    const onChange = vi.fn();
    const booted = await boot({ onSave, onChange });

    booted.moduleInstances.API.methods.handlers.set({ onSave: undefined, onChange: undefined });

    emitBlockChange(booted);

    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(onSave).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('arms the render hooks at runtime', async () => {
    const booted = await boot();
    const onAfterRender = vi.fn();
    const onBeforeRender = vi.fn((blocks: OutputBlockData[]) => blocks);

    booted.moduleInstances.API.methods.handlers.set({ onBeforeRender, onAfterRender });

    await booted.moduleInstances.API.methods.blocks.render({
      blocks: [{ type: 'paragraph', data: { text: 'rendered' } }],
    });

    expect(onBeforeRender).toHaveBeenCalledTimes(1);
    expect(onAfterRender).toHaveBeenCalledTimes(1);
  });
});
