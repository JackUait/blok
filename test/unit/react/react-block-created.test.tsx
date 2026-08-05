/**
 * C3 (adapter half): core now stamps every Block with its creation provenance
 * (`origin`), and D4 gave the adapters a post-commit `onMounted` signal. The
 * remaining gap is the SEEDING hook itself: a container that wants to insert its
 * default children exactly once still has to re-derive "was I created or
 * restored?" from `origin` by hand — and the obvious `origin === 'user'` test is
 * WRONG (it drops `api.blocks.insert('steps')` and turn-into, leaving an empty
 * container), which is precisely the mistake core refused to ship into its own
 * column tools.
 *
 * `onCreated` encodes that predicate once, in the adapter: fired only for the
 * CREATION origins (`user`, `api`, `convert`, and an absent origin), never for a
 * restore (`load`, `replay`, `paste`) or the off-tree `probe`, and never before
 * the portal has committed.
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';

import { createReactBlock, type ReactBlockRenderProps } from '../../../packages/react/src/createReactBlock';
import {
  createBlockPortalRegistry,
  type BlockPortalRegistry,
} from '../../../packages/react/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/react/src/BlockPortalHost';
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
  const { unmount } = render(<BlockPortalHost registry={registry} />);

  return { registry, unmount };
};

describe('createReactBlock onCreated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('fires once for a user creation, after the portal commit, with the origin and api', () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a')];
    /** Slot child count observed inside the hook (-1 = the slot did not exist). */
    const slotChildrenAtCall: number[] = [];
    const onCreated = vi.fn(() => {
      const slot = document.querySelector('[data-blok-nested-blocks]');

      slotChildrenAtCall.push(slot === null ? -1 : slot.children.length);
    });

    const Tool = createReactBlock({
      type: 'steps',
      propSchema: { text: { default: '' } },
      component: ({ BlockChildren }: ReactBlockRenderProps<{ text: string }>) => <BlockChildren />,
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

    const firedWhenRenderReturned: number[] = [];

    act(() => {
      const host = tool.render();

      firedWhenRenderReturned.push(onCreated.mock.calls.length);
      document.body.appendChild(host);
    });

    // Never before the commit — that is the whole point of hanging it off the
    // mount signal rather than off core's rendered().
    expect(firedWhenRenderReturned).toEqual([0]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(blockApi, { origin: 'user', api });
    // The child holders are already adopted, so a seeding hook reads real children.
    expect(slotChildrenAtCall).toEqual([1]);

    // A later data push re-renders the component; a creation signal must not repeat.
    act(() => {
      void tool.setData({ text: 'hi' });
    });

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
  ])('origin %s → onCreated fired: %s', (origin, expected) => {
    const { registry, unmount } = mountHost();
    const onCreated = vi.fn();

    const Tool = createReactBlock({
      type: 'card',
      propSchema: {},
      component: () => <p />,
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

    act(() => {
      document.body.appendChild(tool.render());
    });

    expect(onCreated).toHaveBeenCalledTimes(expected ? 1 : 0);

    unmount();
  });

  it('fires after onMounted, so a seeding hook sees whatever onMounted set up', () => {
    const { registry, unmount } = mountHost();
    const order: string[] = [];

    const Tool = createReactBlock({
      type: 'card',
      propSchema: {},
      component: () => <p />,
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

    act(() => {
      document.body.appendChild(tool.render());
    });

    expect(order).toEqual(['mounted', 'created']);

    unmount();
  });
});
