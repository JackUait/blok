import React, { useState, type ReactElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';

import { createReactBlock, type ReactBlockRenderProps } from '../../../packages/react/src/createReactBlock';
import {
  createBlockPortalRegistry,
  type BlockPortalRegistry,
} from '../../../packages/react/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/react/src/BlockPortalHost';
import type { BlockToolStatics } from '../../../packages/react/src/createReactBlock';
import type { BlockAPI } from '../../../types/api';
import type { BlockToolConstructable } from '../../../types/tools';
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

  /**
   * C2 half (b): core composes the REPLACEMENT block — which registers a portal
   * under the SAME block id — BEFORE it calls REMOVED + destroy() on the block
   * it replaces (`Blocks.insert(index, block, replace = true)`). The superseded
   * instance's teardown therefore lands on an entry it no longer owns; without
   * passing its own host it deletes the live one and the holder stays empty.
   */
  it('a superseded instance cannot unregister the entry that replaced it', () => {
    const { registry, unmount } = mountHost();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data }: ReactBlockRenderProps<CounterData>) => <span className="view">{data.count}</span>,
    });

    const superseded = new Tool({
      data: { count: 1 },
      block: makeBlockApi('blk-same'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const supersededHost = renderTool(superseded);

    document.body.appendChild(supersededHost);

    // Core composes the replacement first — same id, new host.
    const replacement = new Tool({
      data: { count: 2 },
      block: makeBlockApi('blk-same'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const replacementHost = renderTool(replacement);

    document.body.appendChild(replacementHost);

    // …and only then tears the old block down (REMOVED, then destroy()).
    act(() => {
      superseded.removed();
      superseded.destroy();
    });

    expect(registry.getSnapshot().get('blk-same')?.hostEl).toBe(replacementHost);
    expect(replacementHost.querySelector('.view')?.textContent).toBe('2');

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

  it('serializes a React element toolbox icon to markup (no parallel SVG strings)', () => {
    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      toolbox: {
        title: 'Counter',
        icon: (
          <svg data-icon="cart" viewBox="0 0 20 20">
            <path d="M1 1h18" />
          </svg>
        ),
      },
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <span />,
    });

    const toolbox = Tool.toolbox as { title: string; icon: string };

    expect(toolbox.title).toBe('Counter');
    expect(typeof toolbox.icon).toBe('string');
    expect(toolbox.icon).toContain('data-icon="cart"');
    expect(toolbox.icon).toContain('<path');
    // Stable across accesses (serialized once, cached).
    expect((Tool.toolbox as { icon: string }).icon).toBe(toolbox.icon);
  });

  it('preserves SVG camelCase props and namespace attributes in serialized icons', () => {
    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      toolbox: {
        title: 'Counter',
        icon: (
          <svg viewBox="0 0 20 20" strokeWidth={1.25} fillRule="evenodd">
            <path d="M1 1h18" />
          </svg>
        ),
      },
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <span />,
    });

    const toolbox = Tool.toolbox as { icon: string };

    expect(toolbox.icon).toContain('viewBox="0 0 20 20"');
    expect(toolbox.icon).toContain('stroke-width="1.25"');
    expect(toolbox.icon).toContain('fill-rule="evenodd"');
  });

  it('does not throw without a DOM and does not poison the cache (SSR-safe toolbox access)', () => {
    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      toolbox: { title: 'Counter', icon: <svg data-icon="late" /> },
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <span />,
    });

    const realDocument = globalThis.document;

    vi.stubGlobal('document', undefined);
    try {
      // Server-side access must not crash; the element is returned unserialized.
      const ssrToolbox = Tool.toolbox as { title: string; icon: unknown };

      expect(ssrToolbox.title).toBe('Counter');
      expect(typeof ssrToolbox.icon).not.toBe('string');
    } finally {
      vi.stubGlobal('document', realDocument);
    }

    // The DOM-less access must NOT have been cached: with the DOM back, the
    // icon serializes properly.
    const browserToolbox = Tool.toolbox as { icon: string };

    expect(typeof browserToolbox.icon).toBe('string');
    expect(browserToolbox.icon).toContain('data-icon="late"');
  });

  it('serializes element icons inside array toolbox specs, passing string icons through', () => {
    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      toolbox: [
        { title: 'A', icon: '<svg>a</svg>' },
        { title: 'B', icon: <svg data-icon="b" /> },
      ],
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <span />,
    });

    const entries = Tool.toolbox as Array<{ title: string; icon: string }>;

    expect(entries[0].icon).toBe('<svg>a</svg>');
    expect(typeof entries[1].icon).toBe('string');
    expect(entries[1].icon).toContain('data-icon="b"');
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

  it('renders viewComponent (no commit prop) when constructed read-only', () => {
    const { registry, unmount } = mountHost();
    const seenViewProps: Record<string, unknown>[] = [];

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data }: ReactBlockRenderProps<CounterData>) => (
        <span className="edit">{data.count}</span>
      ),
      viewComponent: props => {
        seenViewProps.push(props);

        return <span className="display">{props.data.count}</span>;
      },
    });

    const tool = new Tool({
      data: { count: 3 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: true,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    expect(host.querySelector('.display')?.textContent).toBe('3');
    expect(host.querySelector('.edit')).toBeNull();
    // A view renderer has no write path.
    expect(seenViewProps.at(-1)).not.toHaveProperty('commit');
    // But it keeps the rest of the entry props (data/block/config/BlockChildren).
    expect(seenViewProps.at(-1)).toHaveProperty('block');
    expect(seenViewProps.at(-1)).toHaveProperty('config');

    unmount();
  });

  it('setReadOnly swaps between component and viewComponent in both directions', () => {
    const { registry, unmount } = mountHost();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data }: ReactBlockRenderProps<CounterData>) => (
        <span className="edit">{data.count}</span>
      ),
      viewComponent: ({ data }) => <span className="display">{data.count}</span>,
    });

    const tool = new Tool({
      data: { count: 9 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);
    expect(host.querySelector('.edit')?.textContent).toBe('9');
    expect(host.querySelector('.display')).toBeNull();

    act(() => {
      tool.setReadOnly(true);
    });

    expect(host.querySelector('.display')?.textContent).toBe('9');
    expect(host.querySelector('.edit')).toBeNull();

    act(() => {
      tool.setReadOnly(false);
    });

    expect(host.querySelector('.edit')?.textContent).toBe('9');
    expect(host.querySelector('.display')).toBeNull();

    unmount();
  });

  it('setData while read-only re-renders viewComponent with the new data', async () => {
    const { registry, unmount } = mountHost();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data }: ReactBlockRenderProps<CounterData>) => (
        <span className="edit">{data.count}</span>
      ),
      viewComponent: ({ data }) => <span className="display">{data.count}</span>,
    });

    const tool = new Tool({
      data: { count: 1 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: true,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);
    expect(host.querySelector('.display')?.textContent).toBe('1');

    await act(async () => {
      await tool.setData({ count: 2, label: 'n' });
    });

    // readOnly is preserved through the partial props merge — still the view
    // renderer, now with the new data.
    expect(host.querySelector('.display')?.textContent).toBe('2');
    expect(host.querySelector('.edit')).toBeNull();

    unmount();
  });

  it('data changes while editable do not remount a tool that HAS a viewComponent', async () => {
    const { registry, unmount } = mountHost();
    const mountRuns = vi.fn();

    function Edit({ data }: ReactBlockRenderProps<CounterData>): ReactElement {
      const [seed] = useState(() => {
        mountRuns();

        return 'kept';
      });

      return <span className="edit">{`${data.count}:${seed}`}</span>;
    }

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: Edit,
      viewComponent: ({ data }) => <span className="display">{data.count}</span>,
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
    expect(host.querySelector('.edit')?.textContent).toBe('1:kept');

    await act(async () => {
      await tool.setData({ count: 2, label: 'n' });
    });

    // The ReadOnlySwitch wrapper keeps a stable component identity, so a data
    // update reconciles in place — ephemeral state survives.
    expect(host.querySelector('.edit')?.textContent).toBe('2:kept');
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

describe('createReactBlock — core tool-contract passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('resolves getToolbarAnchorElement against the rendered host, at call time', () => {
    const { registry, unmount } = mountHost();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => (
        <div>
          <div className="chrome">head</div>
          <div data-anchor="" className="anchor" />
        </div>
      ),
      getToolbarAnchorElement: host => host.querySelector<HTMLElement>('[data-anchor]'),
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

    // Resolved lazily: the element only exists after the portal has flushed.
    expect(tool.getToolbarAnchorElement()).toBe(host.querySelector('.anchor'));

    unmount();
  });

  it('takes the toolbar anchor from a ref the component attaches', () => {
    // The spec hook is (host, block) => Element, resolved OUTSIDE the component
    // tree — so the React-idiomatic "point at this element" was unavailable and
    // authors round-tripped through a self-invented data attribute plus
    // querySelector. The ref prop is that channel.
    const { registry, unmount } = mountHost();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ toolbarAnchorRef }) => (
        <div>
          <div className="chrome">head</div>
          <div ref={toolbarAnchorRef} className="anchor" />
        </div>
      ),
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

    expect(tool.getToolbarAnchorElement()).toBe(host.querySelector('.anchor'));

    unmount();
  });

  it('prefers the ref over the spec hook, and falls back when the ref detaches', () => {
    const { registry, unmount } = mountHost();
    const attached = { current: true };
    const blockApi = makeBlockApi();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ toolbarAnchorRef }) => (
        <div>
          <div data-anchor="" className="declared" />
          {attached.current ? <div ref={toolbarAnchorRef} className="anchor" /> : null}
        </div>
      ),
      getToolbarAnchorElement: host => host.querySelector<HTMLElement>('[data-anchor]'),
    });

    const tool = new Tool({
      data: {},
      block: blockApi,
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    // The ref names a live element, so it outranks the host-scoped resolver.
    expect(tool.getToolbarAnchorElement()).toBe(host.querySelector('.anchor'));

    // Once that element unmounts, a stale detached node must not be handed to
    // the toolbar — the declared resolver takes over again.
    attached.current = false;
    act(() => {
      registry.setProps(blockApi.id, { readOnly: false });
    });

    expect(tool.getToolbarAnchorElement()).toBe(host.querySelector('.declared'));

    unmount();
  });

  it('reports no anchor when the spec declares none (core keeps its default positioning)', () => {
    const { registry, unmount } = mountHost();

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <div className="view" />,
    });

    const tool = new Tool({
      data: {},
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(renderTool(tool));

    expect(tool.getToolbarAnchorElement()).toBeUndefined();

    unmount();
  });

  it('forwards authored statics onto the generated tool class', () => {
    const conversionConfig = { export: 'text', import: 'text' };

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <div />,
      statics: { ownsChildren: true, conversionConfig, shortcut: 'CMD+SHIFT+K' },
    });

    const asCoreTool = Tool as unknown as BlockToolConstructable;

    expect(asCoreTool.ownsChildren).toBe(true);
    expect(asCoreTool.conversionConfig).toBe(conversionConfig);
    expect(asCoreTool.shortcut).toBe('CMD+SHIFT+K');
  });

  it('never lets authored statics clobber the members the adapter owns', () => {
    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      toolbox: { title: 'Counter', icon: '<svg/>' },
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: () => <div />,
      // A spec that (accidentally) tries to take over the adapter's own statics.
      statics: { toolbox: undefined, isReadOnlySupported: false } as BlockToolStatics,
    });

    expect(Tool.toolbox).toEqual({ title: 'Counter', icon: '<svg/>' });
    expect(Tool.isReadOnlySupported).toBe(true);
    expect(Tool.__isBlokReactBlock).toBe(true);
  });
});

describe('createReactBlock — editor api on the entry props', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('hands the editor api to the component (and to a viewComponent)', () => {
    const { registry, unmount } = mountHost();
    const api = makeApi();
    const seen: (API | undefined)[] = [];

    const Tool = createReactBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: props => {
        seen.push(props.api);

        return <span className="view" />;
      },
      viewComponent: props => {
        seen.push(props.api);

        return <span className="display" />;
      },
    });

    const tool = new Tool({
      data: {},
      block: makeBlockApi(),
      api,
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(renderTool(tool));

    expect(seen.at(-1)).toBe(api);

    act(() => {
      tool.setReadOnly(true);
    });

    // The read-only renderer keeps the api too — a display renderer may read it.
    expect(seen.at(-1)).toBe(api);

    unmount();
  });
});

describe('BlockChildren — per-child decoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

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

  it('stamps per-child attributes on the holders, which stay DIRECT slot children', () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a'), makeChild('b')];

    const Tool = createReactBlock<CounterData>({
      type: 'container',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ BlockChildren }: ReactBlockRenderProps<CounterData>) => (
        <BlockChildren
          childAttributes={(child, index) => ({
            'data-step-index': String(index),
            'data-child-id': child.id,
          })}
        />
      ),
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    const slot = host.querySelector('[data-blok-nested-blocks]');

    expect(children[0].holder.getAttribute('data-step-index')).toBe('0');
    expect(children[0].holder.getAttribute('data-child-id')).toBe('a');
    expect(children[1].holder.getAttribute('data-step-index')).toBe('1');

    // Anti-wrapper guard: core requires child holders to be DIRECT children of
    // the nested container (hierarchy reparenting and caret sibling checks both
    // compare `holder.parentElement` by identity), so decoration must never
    // introduce a per-child element.
    expect(children[0].holder.parentElement).toBe(slot);
    expect(children[1].holder.parentElement).toBe(slot);

    unmount();
  });

  /** A child whose holder carries core's real wrapper chain (holder → content). */
  const makeWrappedChild = (id: string): BlockAPI => {
    const holder = document.createElement('div');
    const content = document.createElement('div');

    holder.setAttribute('data-blok-id', id);
    content.setAttribute('data-blok-element-content', '');
    holder.appendChild(content);

    return { id, holder } as unknown as BlockAPI;
  };

  it('stamps per-child attributes on the content wrapper too', () => {
    // Core's child-holder decoration law blesses BOTH the holder and the child's
    // [data-blok-element-content] wrapper, but only the holder half was reachable
    // — so a container styling anything relative to a child's CONTENT box had to
    // hard-code core's wrapper chain in its own CSS (`[data-step] >
    // [data-blok-element-content] > …`), which silently breaks whenever that
    // chain changes.
    const { registry, unmount } = mountHost();
    const children = [makeWrappedChild('a'), makeWrappedChild('b')];

    const Tool = createReactBlock<CounterData>({
      type: 'container',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ BlockChildren }: ReactBlockRenderProps<CounterData>) => (
        <BlockChildren
          childAttributes={(_child, index) => ({ 'data-step-index': String(index) })}
          childContentAttributes={(_child, index) => ({ 'data-step-body': String(index) })}
        />
      ),
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(renderTool(tool));

    const contentOf = (child: BlockAPI): Element | null =>
      child.holder.querySelector('[data-blok-element-content]');

    expect(children[0].holder.getAttribute('data-step-index')).toBe('0');
    expect(contentOf(children[0])?.getAttribute('data-step-body')).toBe('0');
    expect(contentOf(children[1])?.getAttribute('data-step-body')).toBe('1');

    // The hooks must land on DIFFERENT elements — a content hook written onto
    // the holder would collapse the two levels the law distinguishes.
    expect(children[0].holder.hasAttribute('data-step-body')).toBe(false);

    unmount();
  });

  it('drops content-wrapper attributes the callback stopped producing', async () => {
    const { registry, unmount } = mountHost();
    const children = [makeWrappedChild('a')];

    const Tool = createReactBlock<CounterData>({
      type: 'container',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data, BlockChildren }: ReactBlockRenderProps<CounterData>) => (
        <BlockChildren
          childContentAttributes={() =>
            data.count === 0 ? { 'data-tone': 'warn', 'data-legacy': 'x' } : { 'data-tone': 'ok' }
          }
        />
      ),
    });

    const tool = new Tool({
      data: { count: 0 },
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(renderTool(tool));

    const content = children[0].holder.querySelector('[data-blok-element-content]');

    expect(content?.getAttribute('data-legacy')).toBe('x');

    await act(async () => {
      await tool.setData({ count: 1, label: 'n' });
    });

    expect(content?.getAttribute('data-tone')).toBe('ok');
    expect(content?.hasAttribute('data-legacy')).toBe(false);

    unmount();
  });

  it('skips the content hook for a child whose content wrapper does not exist yet', () => {
    // A portal-rendered child commits its DOM a frame later, so the wrapper can
    // be absent on the first pass. That must not throw — the next pass stamps it.
    const { registry, unmount } = mountHost();
    const children = [makeChild('a')];

    const Tool = createReactBlock<CounterData>({
      type: 'container',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ BlockChildren }: ReactBlockRenderProps<CounterData>) => (
        <BlockChildren childContentAttributes={() => ({ 'data-tone': 'ok' })} />
      ),
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    expect(() => document.body.appendChild(renderTool(tool))).not.toThrow();
    expect(children[0].holder.hasAttribute('data-tone')).toBe(false);

    unmount();
  });

  it('drops the attributes the callback stopped producing', async () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a')];

    const Tool = createReactBlock<CounterData>({
      type: 'container',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ data, BlockChildren }: ReactBlockRenderProps<CounterData>) => (
        <BlockChildren
          childAttributes={() =>
            data.count === 0 ? { 'data-active': 'true', 'data-legacy': 'x' } : { 'data-active': 'false' }
          }
        />
      ),
    });

    const tool = new Tool({
      data: { count: 0 },
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(renderTool(tool));

    expect(children[0].holder.getAttribute('data-legacy')).toBe('x');

    await act(async () => {
      await tool.setData({ count: 1, label: 'n' });
    });

    expect(children[0].holder.getAttribute('data-active')).toBe('false');
    expect(children[0].holder.hasAttribute('data-legacy')).toBe(false);

    unmount();
  });

  it('renders the bare slot when no decorator is passed', () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a')];

    const Tool = createReactBlock<CounterData>({
      type: 'container',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      component: ({ BlockChildren }: ReactBlockRenderProps<CounterData>) => <BlockChildren />,
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = renderTool(tool);

    document.body.appendChild(host);

    expect(children[0].holder.parentElement).toBe(host.querySelector('[data-blok-nested-blocks]'));
    expect(children[0].holder.attributes.length).toBe(1);

    unmount();
  });
});
