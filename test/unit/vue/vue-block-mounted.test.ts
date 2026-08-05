/**
 * D4 (adapter half), Vue mirror of the React contract: the teleport commits a
 * tick AFTER `render()` returns, so core's `rendered()` cannot mean "this
 * block's DOM has settled".
 *
 * - `onMounted(block, { origin, api })` fires ONCE after that first commit and
 *   carries core's create-vs-restore origin.
 * - `block:childrenMounted` is emitted on the editor bus after the child
 *   holders are mounted into the slot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import { createVueBlock } from '../../../packages/vue/src/createVueBlock';
import {
  createBlockPortalRegistry,
  type BlockPortalRegistry,
} from '../../../packages/vue/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/vue/src/BlockPortalHost';
import type { BlockAPI } from '../../../types/api';
import type { API } from '../../../types';

const REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

/** A fake child block: just the id + holder `mountChildBlocks` moves around. */
const makeChild = (id: string): BlockAPI => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-id', id);

  return { id, holder } as unknown as BlockAPI;
};

/** A container BlockAPI whose children the test controls. */
const makeContainerApi = (children: BlockAPI[]): BlockAPI =>
  ({
    id: 'container',
    contentIds: children.map(child => child.id),
    getChildren: () => children,
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI);

/** A fake editor api with a spying events bus. */
const makeApi = (): API & { events: { emit: ReturnType<typeof vi.fn> } } =>
  ({
    blocks: { isPointerDragActive: false },
    events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  } as unknown as API & { events: { emit: ReturnType<typeof vi.fn> } });

/** Mount the shared portal host so registered tools actually render. */
const mountHost = (): { registry: BlockPortalRegistry; unmount: () => void } => {
  const registry = createBlockPortalRegistry();
  const wrapper = mount(BlockPortalHost, { props: { registry } });

  return { registry, unmount: () => wrapper.unmount() };
};

describe('createVueBlock post-mount signals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('fires onMounted after the teleport commit, not when render() returns', async () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a'), makeChild('b')];
    const seen: { slotChildren: number }[] = [];

    const Tool = createVueBlock({
      type: 'steps',
      propSchema: {},
      setup: ({ BlockChildren }) => () => h(BlockChildren),
      onMounted: () => {
        const slot = document.querySelector('[data-blok-nested-blocks]');

        seen.push({ slotChildren: slot === null ? -1 : slot.children.length });
      },
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());

    // The teleport has not committed yet — the window in which core calls the
    // tool's rendered() hook.
    expect(seen).toHaveLength(0);

    await nextTick();

    expect(seen).toEqual([{ slotChildren: 2 }]);

    unmount();
  });

  it('hands onMounted the construction origin and the editor api, exactly once', async () => {
    const { registry, unmount } = mountHost();
    const onMounted = vi.fn();

    const Tool = createVueBlock<{ text: string }>({
      type: 'card',
      propSchema: { text: { default: '' } },
      setup: ({ data }) => () => h('p', data.value.text),
      onMounted,
    });

    const api = makeApi();
    const blockApi = makeContainerApi([]);
    const tool = new Tool({
      data: {},
      block: blockApi,
      api,
      readOnly: false,
      origin: 'user',
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());
    await nextTick();

    expect(onMounted).toHaveBeenCalledTimes(1);
    expect(onMounted).toHaveBeenCalledWith(blockApi, { origin: 'user', api });

    await tool.setData({ text: 'hi' });

    expect(onMounted).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('defaults the onMounted origin to api when the caller supplied none', async () => {
    const { registry, unmount } = mountHost();
    const onMounted = vi.fn();

    const Tool = createVueBlock({
      type: 'card',
      propSchema: {},
      setup: () => () => h('p'),
      onMounted,
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi([]),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());
    await nextTick();

    expect(onMounted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: 'api' })
    );

    unmount();
  });

  it('emits block:childrenMounted once the holders are in the slot', async () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a'), makeChild('b')];
    const api = makeApi();
    /** Whether every holder was already inside the slot at emit time. */
    const mountedAtEmit: boolean[] = [];

    api.events.emit.mockImplementation(() => {
      mountedAtEmit.push(
        children.every(
          child => child.holder.parentElement?.hasAttribute('data-blok-nested-blocks') === true
        )
      );
    });

    const Tool = createVueBlock({
      type: 'steps',
      propSchema: {},
      setup: ({ BlockChildren }) => () => h(BlockChildren),
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi(children),
      api,
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());
    await nextTick();

    expect(api.events.emit).toHaveBeenCalledWith('block:childrenMounted', {
      blockId: 'container',
      childIds: ['a', 'b'],
    });
    expect(mountedAtEmit).toContain(true);

    unmount();
  });
});
