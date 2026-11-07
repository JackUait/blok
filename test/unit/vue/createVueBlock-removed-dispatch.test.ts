import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import { createVueBlock } from '../../../packages/vue/src/createVueBlock';
import { createBlockPortalRegistry } from '../../../packages/vue/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/vue/src/BlockPortalHost';
import type { BlockAPI } from '../../../types/api';
import type { API } from '../../../types';

const REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

interface CounterData {
  count: number;
}

describe('createVueBlock — a change deferred by a drag', () => {
  const frames = new Map<number, FrameRequestCallback>();
  const runFrames = (): void => {
    const pending = [...frames.values()];

    frames.clear();
    pending.forEach(callback => callback(0));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    frames.clear();
    document.body.innerHTML = '';
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      const id = frames.size + 1;

      frames.set(id, callback);

      return id;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it.each(['removed', 'destroy'] as const)('is not dispatched on a block that was %s before the drag ended', async (teardown) => {
    const registry = createBlockPortalRegistry();
    const wrapper = mount(BlockPortalHost, { props: { registry } });
    const dispatchChange = vi.fn();
    const blockApi = { id: 'blk-1', contentIds: [], getChildren: () => [], dispatchChange } as unknown as BlockAPI;
    const dragState = { active: true };
    const api = {
      blocks: {
        get isPointerDragActive(): boolean {
          return dragState.active;
        },
      },
    } as unknown as API;

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 } },
      setup({ data, commit }) {
        return () => h('button', { onClick: () => commit({ count: data.value.count + 1 }) }, String(data.value.count));
      },
    });
    const tool = new Tool({ data: { count: 0 }, block: blockApi, api, readOnly: false, config: { [REGISTRY_CONFIG_KEY]: registry } });
    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();

    const button = host.querySelector('button');

    if (button === null) {
      throw new Error('component did not render');
    }

    button.click();
    await nextTick();
    expect(dispatchChange).not.toHaveBeenCalled();

    tool[teardown]();
    dragState.active = false;
    runFrames();

    expect(dispatchChange).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
