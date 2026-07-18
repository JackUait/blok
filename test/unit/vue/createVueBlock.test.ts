import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { createVueBlock } from '../../../packages/vue/src/createVueBlock';
import { createBlockPortalRegistry, type BlockPortalRegistry } from '../../../packages/vue/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/vue/src/BlockPortalHost';
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
