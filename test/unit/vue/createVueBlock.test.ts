import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { createVueBlock } from '../../../packages/vue/src/createVueBlock';
import { createBlockPortalRegistry, type BlockPortalRegistry } from '../../../packages/vue/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/vue/src/BlockPortalHost';
import type { BlockToolStatics } from '../../../packages/vue/src/createVueBlock';
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

/**
 * Mount the shared portal host so registered tools actually render, then return
 * helpers. Each test constructs tools against the SAME registry.
 */
const mountHost = (): { registry: BlockPortalRegistry; unmount: () => void } => {
  const registry = createBlockPortalRegistry();
  const wrapper = mount(BlockPortalHost, { props: { registry } });

  return { registry, unmount: () => wrapper.unmount() };
};

describe('createVueBlock (Vue authoring factory)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the component into a mutation-free host, defaults-filled', async () => {
    const { registry, unmount } = mountHost();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data }) {
        return () => h('span', { class: 'view' }, `${data.value.label}:${data.value.count}`);
      },
    });

    const tool = new Tool({
      data: { count: 5 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();

    expect(host.getAttribute('data-blok-mutation-free')).toBe('true');
    // count from incoming data (5), label defaulted ('n').
    expect(host.querySelector('.view')?.textContent).toBe('n:5');

    unmount();
  });

  it('save() returns the COMPLETE defaults-filled, toRaw-clean mirror', () => {
    const { registry, unmount } = mountHost();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data }) {
        return () => h('span', data.value.count);
      },
    });

    const tool = new Tool({
      data: { count: 7 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    tool.render();
    const saved = tool.save();

    // Every propSchema key present (count from data, label defaulted) — never
    // partial, so per-key Yjs sync can't resurrect omitted keys.
    expect(saved).toEqual({ count: 7, label: 'n' });
    // A plain frozen object, not a Vue proxy.
    expect(Object.isFrozen(saved)).toBe(true);

    unmount();
  });

  it('setData returns true and updates in place WITHOUT remounting (state preserved)', async () => {
    const { registry, unmount } = mountHost();
    const setupRuns = vi.fn();
    // Ephemeral, NON-data state that only survives if the component is not remounted.
    const ephemeral = ref(0);

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data }) {
        setupRuns();
        ephemeral.value += 1;

        return () => h('span', { class: 'view' }, String(data.value.count));
      },
    });

    const tool = new Tool({
      data: { count: 1 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();
    expect(host.querySelector('.view')?.textContent).toBe('1');
    expect(setupRuns).toHaveBeenCalledTimes(1);

    // Simulate a Yjs replay (undo/redo/remote): core awaits this.
    const result = await tool.setData({ count: 42 });

    expect(result).toBe(true);
    expect(host.querySelector('.view')?.textContent).toBe('42');
    // No remount: setup ran exactly once, ephemeral state intact.
    expect(setupRuns).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('setData is deduped: identical data does not re-render', async () => {
    const { registry, unmount } = mountHost();
    const renders = vi.fn();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data }) {
        return () => {
          renders();

          return h('span', String(data.value.count));
        };
      },
    });

    const tool = new Tool({
      data: { count: 1 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    tool.render();
    await nextTick();
    const rendersAfterMount = renders.mock.calls.length;

    // Same content (deep-equal) → no re-render.
    await tool.setData({ count: 1, label: 'n' });
    await nextTick();

    expect(renders.mock.calls.length).toBe(rendersAfterMount);

    unmount();
  });

  it('commit merges the patch, updates the mirror, and dispatches change exactly once', async () => {
    const { registry, unmount } = mountHost();
    const block = makeBlockApi();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data, commit }) {
        return () =>
          h('button', { class: 'inc', onClick: () => commit({ count: data.value.count + 1 }) }, String(data.value.count));
      },
    });

    const tool = new Tool({
      data: { count: 0 },
      block,
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();

    host.querySelector<HTMLButtonElement>('.inc')!.click();
    await nextTick();

    expect(block.dispatchChange).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.inc')?.textContent).toBe('1');
    // save() reflects the committed value, still complete.
    expect(tool.save()).toEqual({ count: 1, label: 'n' });

    unmount();
  });

  it('commit is idempotent: a patch that changes nothing neither dispatches nor re-renders', async () => {
    const { registry, unmount } = mountHost();
    const block = makeBlockApi();
    const renders = vi.fn();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data, commit }) {
        return () => {
          renders();

          return h(
            'button',
            { class: 'echo', onClick: () => commit({ count: data.value.count }) },
            String(data.value.count)
          );
        };
      },
    });

    const tool = new Tool({
      data: { count: 4 },
      block,
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();

    const rendersBefore = renders.mock.calls.length;

    host.querySelector<HTMLButtonElement>('.echo')?.click();
    await nextTick();

    expect(block.dispatchChange).not.toHaveBeenCalled();
    expect(renders.mock.calls.length).toBe(rendersBefore);
    expect(tool.save()).toEqual({ count: 4, label: 'n' });

    unmount();
  });

  it('removed() unregisters the block so its subtree unmounts', async () => {
    const { registry, unmount } = mountHost();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data }) {
        return () => h('span', { class: 'view' }, String(data.value.count));
      },
    });

    const tool = new Tool({
      data: { count: 3 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();
    expect(host.querySelector('.view')).not.toBeNull();

    tool.removed?.();
    await nextTick();

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
  it('a superseded instance cannot unregister the entry that replaced it', async () => {
    const { registry, unmount } = mountHost();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data }) {
        return () => h('span', { class: 'view' }, String(data.value.count));
      },
    });

    const superseded = new Tool({
      data: { count: 1 },
      block: makeBlockApi('blk-same'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const supersededHost = superseded.render();

    document.body.appendChild(supersededHost);
    await nextTick();

    // Core composes the replacement first — same id, new host.
    const replacement = new Tool({
      data: { count: 2 },
      block: makeBlockApi('blk-same'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const replacementHost = replacement.render();

    document.body.appendChild(replacementHost);
    await nextTick();

    // …and only then tears the old block down (REMOVED, then destroy()).
    superseded.removed?.();
    superseded.destroy?.();
    await nextTick();

    expect(registry.entries.get('blk-same')?.hostEl).toBe(replacementHost);
    expect(replacementHost.querySelector('.view')?.textContent).toBe('2');

    unmount();
  });

  it('exposes the static toolbox config from the spec', () => {
    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      toolbox: { title: 'Counter', icon: '<svg></svg>' },
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data }) {
        return () => h('span', String(data.value.count));
      },
    });

    expect(Tool.toolbox).toEqual({ title: 'Counter', icon: '<svg></svg>' });
  });
});

describe('createVueBlock — core tool-contract passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('resolves getToolbarAnchorElement against the rendered host, at call time', async () => {
    const { registry, unmount } = mountHost();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup() {
        return () => h('div', [h('div', { class: 'chrome' }), h('div', { 'data-anchor': '', class: 'anchor' })]);
      },
      getToolbarAnchorElement: host => host.querySelector<HTMLElement>('[data-anchor]'),
    });

    const tool = new Tool({
      data: {},
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();

    expect(tool.getToolbarAnchorElement()).toBe(host.querySelector('.anchor'));

    unmount();
  });

  it('reports no anchor when the spec declares none (core keeps its default positioning)', async () => {
    const { registry, unmount } = mountHost();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup() {
        return () => h('div', { class: 'view' });
      },
    });

    const tool = new Tool({
      data: {},
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());
    await nextTick();

    expect(tool.getToolbarAnchorElement()).toBeUndefined();

    unmount();
  });

  it('forwards authored statics onto the generated tool class', () => {
    const conversionConfig = { export: 'text', import: 'text' };

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup() {
        return () => h('div');
      },
      statics: { ownsChildren: true, conversionConfig, shortcut: 'CMD+SHIFT+K' },
    });

    const asCoreTool = Tool as unknown as BlockToolConstructable;

    expect(asCoreTool.ownsChildren).toBe(true);
    expect(asCoreTool.conversionConfig).toBe(conversionConfig);
    expect(asCoreTool.shortcut).toBe('CMD+SHIFT+K');
  });

  it('never lets authored statics clobber the members the adapter owns', () => {
    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      toolbox: { title: 'Counter', icon: '<svg></svg>' },
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup() {
        return () => h('div');
      },
      statics: { toolbox: undefined, isReadOnlySupported: false } as BlockToolStatics,
    });

    expect(Tool.toolbox).toEqual({ title: 'Counter', icon: '<svg></svg>' });
    expect(Tool.isReadOnlySupported).toBe(true);
    expect(Tool.__isBlokVueBlock).toBe(true);
  });
});

describe('createVueBlock — editor api and per-child decoration', () => {
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

  const makeContainerApi = (children: BlockAPI[]): BlockAPI =>
    ({
      id: 'container',
      contentIds: children.map(child => child.id),
      getChildren: () => children,
      dispatchChange: vi.fn(),
    } as unknown as BlockAPI);

  it('hands the editor api to the block setup', async () => {
    const { registry, unmount } = mountHost();
    const api = makeApi();
    const seen: API[] = [];

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup(ctx) {
        seen.push(ctx.api);

        return () => h('span', { class: 'view' });
      },
    });

    const tool = new Tool({
      data: {},
      block: makeBlockApi(),
      api,
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());
    await nextTick();

    expect(seen.at(-1)).toBe(api);

    unmount();
  });

  it('stamps per-child attributes on the holders, which stay DIRECT slot children', async () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a'), makeChild('b')];

    const Tool = createVueBlock<CounterData>({
      type: 'container',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ BlockChildren }) {
        return () =>
          h(BlockChildren, {
            childAttributes: (child: BlockAPI, index: number) => ({
              'data-step-index': String(index),
              'data-child-id': child.id,
            }),
          });
      },
    });

    const tool = new Tool({
      data: {},
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();

    const slot = host.querySelector('[data-blok-nested-blocks]');

    expect(children[0].holder.getAttribute('data-step-index')).toBe('0');
    expect(children[0].holder.getAttribute('data-child-id')).toBe('a');
    expect(children[1].holder.getAttribute('data-step-index')).toBe('1');
    // Anti-wrapper guard: holders must remain DIRECT children of the slot.
    expect(children[0].holder.parentElement).toBe(slot);
    expect(children[1].holder.parentElement).toBe(slot);

    unmount();
  });

  it('drops the attributes the callback stopped producing', async () => {
    const { registry, unmount } = mountHost();
    const children = [makeChild('a')];

    const Tool = createVueBlock<CounterData>({
      type: 'container',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data, BlockChildren }) {
        // Read the reactive snapshot in RENDER (not only inside the closure) so
        // Vue tracks it and the slot re-renders when the data changes.
        return () => {
          const active = data.value.count === 0;

          return h(BlockChildren, {
            childAttributes: () =>
              active ? { 'data-active': 'true', 'data-legacy': 'x' } : { 'data-active': 'false' },
          });
        };
      },
    });

    const tool = new Tool({
      data: { count: 0 },
      block: makeContainerApi(children),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());
    await nextTick();

    expect(children[0].holder.getAttribute('data-legacy')).toBe('x');

    await tool.setData({ count: 1, label: 'n' });
    await nextTick();

    expect(children[0].holder.getAttribute('data-active')).toBe('false');
    expect(children[0].holder.hasAttribute('data-legacy')).toBe(false);

    unmount();
  });
});
