import React, { useState, type ReactElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';

import { createReactBlock, type ReactBlockRenderProps } from '../../../packages/react/src/createReactBlock';
import {
  createBlockPortalRegistry,
  type BlockPortalRegistry,
} from '../../../packages/react/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/react/src/BlockPortalHost';
import type { BlockAPI } from '../../../types/api';
import type { API } from '../../../types';

const REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

interface CounterData {
  count: number;
  label: string;
}

/** A fake per-block BlockAPI carrying just what the factory touches. */
const makeBlockApi = (id = 'blk-1'): BlockAPI & { dispatchChange: ReturnType<typeof vi.fn> } =>
  ({
    id,
    contentIds: [],
    getChildren: () => [],
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI & { dispatchChange: ReturnType<typeof vi.fn> });

/** A fake editor `api` exposing the pointer-drag flag the commit path reads. */
const makeApi = (pointerDragActive = false): API =>
  ({
    blocks: { isPointerDragActive: pointerDragActive },
  } as unknown as API);

/** Mount the shared portal host so registered tools actually render. */
const mountHost = (): { registry: BlockPortalRegistry; unmount: () => void } => {
  const registry = createBlockPortalRegistry();
  const { unmount } = render(<BlockPortalHost registry={registry} />);

  return { registry, unmount };
};

/** Run tool.render() inside act() and hand back the host element. */
const renderTool = (tool: { render(): HTMLElement }): HTMLElement => {
  const holder: { host: HTMLElement | null } = { host: null };

  act(() => {
    holder.host = tool.render();
  });

  if (holder.host === null) {
    throw new Error('tool.render() did not run');
  }

  return holder.host;
};

describe('createReactBlock (React authoring factory)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the component into a mutation-free host, defaults-filled', () => {
    const { registry, unmount } = mountHost();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data }: ReactBlockRenderProps<CounterData>) => (
        <span className="view">{`${data.label}:${data.count}`}</span>
      ),
    });

    const tool = new Tool({
      data: { count: 5 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    expect(host.getAttribute('data-blok-mutation-free')).toBe('true');
    // count from incoming data (5), label defaulted ('n').
    expect(host.querySelector('.view')?.textContent).toBe('n:5');

    unmount();
  });

  it('save() returns the COMPLETE defaults-filled mirror, never the DOM', () => {
    const { registry, unmount } = mountHost();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data }: ReactBlockRenderProps<CounterData>) => <span>{data.count}</span>,
    });

    const tool = new Tool({
      data: { count: 7 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    renderTool(tool);
    const saved = tool.save();

    // Every propSchema key present (count from data, label defaulted) — never
    // partial, so per-key Yjs sync can't resurrect omitted keys.
    expect(saved).toEqual({ count: 7, label: 'n' });
    expect(Object.isFrozen(saved)).toBe(true);

    unmount();
  });

  it('setData returns true and updates in place WITHOUT remounting (state preserved)', async () => {
    const { registry, unmount } = mountHost();
    const mountRuns = vi.fn();

    function Counter({ data }: ReactBlockRenderProps<CounterData>): ReactElement {
      // Ephemeral, NON-data state that only survives if the component is not remounted.
      const [typed] = useState(() => {
        mountRuns();

        return 'ephemeral';
      });

      return <span className="view">{`${data.count}:${typed}`}</span>;
    }

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: Counter,
    });

    const tool = new Tool({
      data: { count: 1 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);
    expect(host.querySelector('.view')?.textContent).toBe('1:ephemeral');

    const result = await act(async () => tool.setData({ count: 2 }));

    expect(result).toBe(true);
    expect(host.querySelector('.view')?.textContent).toBe('2:ephemeral');
    expect(mountRuns).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('setData is deduped: identical data resolves true without a re-render', async () => {
    const { registry, unmount } = mountHost();
    const renders = vi.fn();

    function Counter({ data }: ReactBlockRenderProps<CounterData>): ReactElement {
      renders();

      return <span className="view">{data.count}</span>;
    }

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: Counter,
    });

    const tool = new Tool({
      data: { count: 3 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    const rendersBefore = renders.mock.calls.length;
    const result = await act(async () => tool.setData({ count: 3, label: 'n' }));

    expect(result).toBe(true);
    expect(renders.mock.calls.length).toBe(rendersBefore);

    unmount();
  });

  it('commit merges the patch, updates the mirror, and dispatches change exactly once', () => {
    const { registry, unmount } = mountHost();
    const blockApi = makeBlockApi();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data, commit }: ReactBlockRenderProps<CounterData>) => (
        <button className="inc" onClick={() => commit({ count: data.count + 1 })}>
          {data.count}
        </button>
      ),
    });

    const tool = new Tool({
      data: { count: 0 },
      block: blockApi,
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    const button = host.querySelector('.inc');

    expect(button).not.toBeNull();
    act(() => {
      fireEvent.click(button as Element);
    });

    expect(tool.save()).toEqual({ count: 1, label: 'n' });
    expect(blockApi.dispatchChange).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.inc')?.textContent).toBe('1');

    unmount();
  });

  it('commit is idempotent: a patch that changes nothing neither dispatches nor re-renders', () => {
    const { registry, unmount } = mountHost();
    const blockApi = makeBlockApi();
    const renders = vi.fn();

    function Counter({ data, commit }: ReactBlockRenderProps<CounterData>): ReactElement {
      renders();

      return (
        <button className="echo" onClick={() => commit({ count: data.count })}>
          {data.count}
        </button>
      );
    }

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: Counter,
    });

    const tool = new Tool({
      data: { count: 4 },
      block: blockApi,
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    const rendersBefore = renders.mock.calls.length;

    act(() => {
      fireEvent.click(host.querySelector('.echo') as Element);
    });

    expect(blockApi.dispatchChange).not.toHaveBeenCalled();
    expect(renders.mock.calls.length).toBe(rendersBefore);
    expect(tool.save()).toEqual({ count: 4, label: 'n' });

    unmount();
  });

  it('commit idempotence breaks effect-echo loops (no guard needed in the component)', () => {
    const { registry, unmount } = mountHost();
    const blockApi = makeBlockApi();
    const effectRuns = vi.fn();

    // The consumer pattern from the field: an effect that echoes the current
    // value back through commit on every data change. Without commit-side
    // dedup this loops forever (commit → new data prop → effect → commit).
    function Echo({ data, commit }: ReactBlockRenderProps<CounterData>): ReactElement {
      React.useEffect(() => {
        effectRuns();
        commit({ count: data.count });
      }, [data, commit]);

      return <span className="view">{data.count}</span>;
    }

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: Echo,
    });

    const tool = new Tool({
      data: { count: 9 },
      block: blockApi,
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    // One effect pass; the echoed commit is a no-op, so the loop never starts
    // and no change is dispatched for a value the block already holds.
    expect(effectRuns).toHaveBeenCalledTimes(1);
    expect(blockApi.dispatchChange).not.toHaveBeenCalled();

    unmount();
  });

  it('removed() unregisters the block so its subtree unmounts', () => {
    const { registry, unmount } = mountHost();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data }: ReactBlockRenderProps<CounterData>) => <span className="view">{data.count}</span>,
    });

    const tool = new Tool({
      data: {},
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);
    expect(host.querySelector('.view')).not.toBeNull();

    act(() => {
      tool.removed();
    });
    expect(host.querySelector('.view')).toBeNull();

    unmount();
  });

  it('hands the tool config to the component as a `config` prop (internal keys stripped)', () => {
    const { registry, unmount } = mountHost();

    interface GoodsConfig {
      canManageGoods: boolean;
      cdnUrl: string;
    }

    const seen: { config: Readonly<Partial<GoodsConfig>> | null } = { config: null };

    const Tool = createReactBlock<CounterData, GoodsConfig>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ config }: ReactBlockRenderProps<CounterData, GoodsConfig>) => {
        seen.config = config;

        return <span className="view">{config.cdnUrl}</span>;
      },
    });

    const tool = new Tool({
      data: {},
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: {
        [REGISTRY_CONFIG_KEY]: registry,
        __blokToolName: 'goods',
        canManageGoods: true,
        cdnUrl: 'https://cdn.example',
      },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    // Host props flow through the tool's `config` — no hand-rolled context
    // provider needed. Adapter-internal keys never leak to the component.
    expect(seen.config).toEqual({ canManageGoods: true, cdnUrl: 'https://cdn.example' });
    expect(host.querySelector('.view')?.textContent).toBe('https://cdn.example');

    unmount();
  });

  it('exposes the static toolbox config from the spec', () => {
    const toolbox = { title: 'Counter', icon: '<svg/>' };
    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      toolbox,
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <span />,
    });

    expect(Tool.toolbox).toEqual(toolbox);
    expect(Tool.__isBlokReactBlock).toBe(true);
  });

  it('supports read-only: setReadOnly toggles IN PLACE without remounting', () => {
    const { registry, unmount } = mountHost();
    const mountRuns = vi.fn();

    function View({ readOnly }: ReactBlockRenderProps<CounterData>): ReactElement {
      const [seed] = useState(() => {
        mountRuns();

        return 'kept';
      });

      return <span className="view">{`${readOnly ? 'ro' : 'rw'}:${seed}`}</span>;
    }

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: View,
    });

    expect(Tool.isReadOnlySupported).toBe(true);
    // Core probes the PROTOTYPE for setReadOnly to pick the in-place path.
    expect(typeof Tool.prototype.setReadOnly).toBe('function');

    const tool = new Tool({
      data: {},
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);
    expect(host.querySelector('.view')?.textContent).toBe('rw:kept');

    act(() => {
      tool.setReadOnly(true);
    });

    expect(host.querySelector('.view')?.textContent).toBe('ro:kept');
    expect(mountRuns).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('defers dispatchChange while a pointer drag is active, then flushes once', () => {
    vi.useFakeTimers();

    const { registry, unmount } = mountHost();
    const blockApi = makeBlockApi();
    const dragState = { active: true };
    const api = {
      blocks: {
        get isPointerDragActive(): boolean {
          return dragState.active;
        },
      },
    } as unknown as API;

    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      rafCallbacks.push(callback);

      return rafCallbacks.length;
    });

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data, commit }: ReactBlockRenderProps<CounterData>) => (
        <button className="inc" onClick={() => commit({ count: data.count + 1 })}>
          {data.count}
        </button>
      ),
    });

    const tool = new Tool({
      data: { count: 0 },
      block: blockApi,
      api,
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    act(() => {
      fireEvent.click(host.querySelector('.inc') as Element);
    });

    // Drag active: the change is deferred, not dropped.
    expect(blockApi.dispatchChange).not.toHaveBeenCalled();

    dragState.active = false;
    act(() => {
      rafCallbacks.splice(0).forEach(callback => callback(0));
    });

    expect(blockApi.dispatchChange).toHaveBeenCalledTimes(1);

    rafSpy.mockRestore();
    vi.useRealTimers();
    unmount();
  });
});
