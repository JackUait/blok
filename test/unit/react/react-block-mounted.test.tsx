/**
 * D4 (adapter half): a React block's portal lands a COMMIT AFTER `render()`
 * returns, so core's `rendered()` hook cannot mean "this block's DOM has
 * settled". Hosts worked around it by setting the caret twice around a
 * requestAnimationFrame.
 *
 * Two signals close that gap:
 * - `onMounted(block, { origin, api })` — the spec hook, fired ONCE after the
 *   portal's first commit (and after `<BlockChildren />` has adopted the child
 *   holders). `origin` is core's create-vs-restore signal, so a container can
 *   seed default children exactly at creation.
 * - the `block:childrenMounted` editor event — observable through
 *   `api.events.on(...)` by anyone, for any container block.
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
  const { unmount } = render(<BlockPortalHost registry={registry} />);

  return { registry, unmount };
};

describe('createReactBlock post-mount signals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('fires onMounted after the portal commit, not when render() returns', () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a'), makeChild('b')];
    const seen: { slotChildren: number }[] = [];

    const Tool = createReactBlock({
      type: 'steps',
      propSchema: {},
      component: ({ BlockChildren }: ReactBlockRenderProps<Record<string, never>>) => (
        <BlockChildren />
      ),
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

    const firedWhenRenderReturned: number[] = [];

    act(() => {
      const rendered = tool.render();

      // The portal has not committed yet — this is exactly the window in which
      // core calls the tool's rendered() hook.
      firedWhenRenderReturned.push(seen.length);
      document.body.appendChild(rendered);
    });

    expect(firedWhenRenderReturned).toEqual([0]);

    // Fired once, with the slot in the DOM and the child holders already in it.
    expect(seen).toEqual([{ slotChildren: 2 }]);

    unmount();
  });

  it('hands onMounted the construction origin and the editor api, exactly once', () => {
    const { registry, unmount } = mountHost();
    const onMounted = vi.fn();

    const Tool = createReactBlock({
      type: 'card',
      propSchema: { text: { default: '' } },
      component: ({ data }: ReactBlockRenderProps<{ text: string }>) => <p>{data.text}</p>,
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

    act(() => {
      document.body.appendChild(tool.render());
    });

    expect(onMounted).toHaveBeenCalledTimes(1);
    expect(onMounted).toHaveBeenCalledWith(blockApi, { origin: 'user', api });

    // A later data push re-renders the component; the creation signal must not
    // fire again.
    act(() => {
      void tool.setData({ text: 'hi' });
    });

    expect(onMounted).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('defaults the onMounted origin to api when the caller supplied none', () => {
    const { registry, unmount } = mountHost();
    const onMounted = vi.fn();

    const Tool = createReactBlock({
      type: 'card',
      propSchema: {},
      component: () => <p />,
      onMounted,
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi([]),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    act(() => {
      document.body.appendChild(tool.render());
    });

    expect(onMounted).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: 'api' })
    );

    unmount();
  });

  it('emits block:childrenMounted once the holders are in the slot', () => {
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

    const Tool = createReactBlock({
      type: 'steps',
      propSchema: {},
      component: ({ BlockChildren }: ReactBlockRenderProps<Record<string, never>>) => (
        <BlockChildren />
      ),
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi(children),
      api,
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    act(() => {
      document.body.appendChild(tool.render());
    });

    expect(api.events.emit).toHaveBeenCalledWith('block:childrenMounted', {
      blockId: 'container',
      childIds: ['a', 'b'],
    });
    expect(mountedAtEmit).toContain(true);

    unmount();
  });
});
