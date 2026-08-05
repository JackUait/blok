/**
 * C3 (adapter half), Vue mirror: `onCreated` is the seeding hook. It encodes the
 * create-vs-restore predicate once, in the adapter, so a container never has to
 * re-derive it from `origin` — and never reaches for `origin === 'user'`, which
 * silently drops `api.blocks.insert('steps')` and turn-into.
 *
 * Fired only for the CREATION origins (`user`, `api`, `convert`, and an absent
 * origin), never for a restore (`load`, `replay`, `paste`) or the off-tree
 * `probe`, and never before the teleport has committed.
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
import type { BlockOrigin } from '../../../types/tools';

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
const makeApi = (): API =>
  ({
    blocks: { isPointerDragActive: false },
    events: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
  } as unknown as API);

/** Mount the shared portal host so registered tools actually render. */
const mountHost = (): { registry: BlockPortalRegistry; unmount: () => void } => {
  const registry = createBlockPortalRegistry();
  const wrapper = mount(BlockPortalHost, { props: { registry } });

  return { registry, unmount: () => wrapper.unmount() };
};

describe('createVueBlock onCreated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('fires once for a user creation, after the teleport commit, with the origin and api', async () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a')];
    /** Slot child count observed inside the hook (-1 = the slot did not exist). */
    const slotChildrenAtCall: number[] = [];
    const onCreated = vi.fn(() => {
      const slot = document.querySelector('[data-blok-nested-blocks]');

      slotChildrenAtCall.push(slot === null ? -1 : slot.children.length);
    });

    const Tool = createVueBlock<{ text: string }>({
      type: 'steps',
      propSchema: { text: { default: '' } },
      setup: ({ BlockChildren }) => () => h(BlockChildren),
      onCreated,
    });

    const api = makeApi();
    const blockApi = makeContainerApi(children);
    const tool = new Tool({
      data: {},
      block: blockApi,
      api,
      readOnly: false,
      origin: 'user',
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());

    // Never before the commit — that is the whole point of hanging it off the
    // mount signal rather than off core's rendered().
    expect(onCreated).not.toHaveBeenCalled();

    await nextTick();

    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(blockApi, { origin: 'user', api });
    // The child holders are already adopted, so a seeding hook reads real children.
    expect(slotChildrenAtCall).toEqual([1]);

    await tool.setData({ text: 'hi' });

    expect(onCreated).toHaveBeenCalledTimes(1);

    unmount();
  });

  it.each<[BlockOrigin | undefined, boolean]>([
    ['user', true],
    ['api', true],
    ['convert', true],
    [undefined, true],
    ['load', false],
    ['replay', false],
    ['paste', false],
    ['probe', false],
  ])('origin %s → onCreated fired: %s', async (origin, expected) => {
    const { registry, unmount } = mountHost();
    const onCreated = vi.fn();

    const Tool = createVueBlock({
      type: 'card',
      propSchema: {},
      setup: () => () => h('p'),
      onCreated,
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi([]),
      api: makeApi(),
      readOnly: false,
      ...(origin === undefined ? {} : { origin }),
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());
    await nextTick();

    expect(onCreated).toHaveBeenCalledTimes(expected ? 1 : 0);

    unmount();
  });

  it('fires after onMounted, so a seeding hook sees whatever onMounted set up', async () => {
    const { registry, unmount } = mountHost();
    const order: string[] = [];

    const Tool = createVueBlock({
      type: 'card',
      propSchema: {},
      setup: () => () => h('p'),
      onMounted: () => order.push('mounted'),
      onCreated: () => order.push('created'),
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi([]),
      api: makeApi(),
      readOnly: false,
      origin: 'user',
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());
    await nextTick();

    expect(order).toEqual(['mounted', 'created']);

    unmount();
  });
});
