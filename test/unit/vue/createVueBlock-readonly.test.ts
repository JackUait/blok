import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h, nextTick } from 'vue';
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

const makeBlockApi = (id = 'blk-1'): BlockAPI =>
  ({
    id,
    contentIds: [],
    getChildren: () => [],
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI);

const makeApi = (): API => ({ blocks: { isPointerDragActive: false } } as unknown as API);

const mountHost = (): { registry: BlockPortalRegistry; unmount: () => void } => {
  const registry = createBlockPortalRegistry();
  const wrapper = mount(BlockPortalHost, { props: { registry } });

  return { registry, unmount: () => wrapper.unmount() };
};

describe('createVueBlock — read-only support (in-place toggle contract)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('declares static isReadOnlySupported so the editor can enter read-only without crashing', () => {
    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data }) {
        return () => h('span', String(data.value.count));
      },
    });

    // Core's ReadOnly module throws a critical error when read-only is enabled
    // and any tool lacks this static flag.
    expect((Tool as unknown as { isReadOnlySupported?: boolean }).isReadOnlySupported).toBe(true);
  });

  it('exposes a setReadOnly method on the PROTOTYPE (enables core in-place toggle path)', () => {
    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data }) {
        return () => h('span', String(data.value.count));
      },
    });

    // Core's `supportsInPlaceReadOnly` checks the constructable's PROTOTYPE for a
    // setReadOnly function (not an own/instance property) — so it must be a class
    // method, not an arrow field.
    expect(typeof (Tool.prototype as unknown as { setReadOnly?: unknown }).setReadOnly).toBe('function');
  });

  it('passes the initial readOnly state into setup and toggles it IN PLACE (no remount)', async () => {
    const { registry, unmount } = mountHost();
    const setupRuns = vi.fn();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ data, readOnly }) {
        setupRuns();

        return () => h('span', { class: 'view' }, readOnly.value ? 'ro' : `edit:${data.value.count}`);
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
    expect(host.querySelector('.view')?.textContent).toBe('edit:1');

    // Core's in-place path calls block.setReadOnly(state) on each tool.
    (tool as unknown as { setReadOnly: (s: boolean) => void }).setReadOnly(true);
    await nextTick();

    expect(host.querySelector('.view')?.textContent).toBe('ro');
    // No remount: setup ran exactly once across the toggle.
    expect(setupRuns).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('reflects an initial read-only state of true at first render', async () => {
    const { registry, unmount } = mountHost();

    const Tool = createVueBlock<CounterData>({
      type: 'counter',
      propSchema: { count: { default: 0 }, label: { default: 'n' } },
      setup({ readOnly }) {
        return () => h('span', { class: 'view' }, readOnly.value ? 'ro' : 'edit');
      },
    });

    const tool = new Tool({
      data: { count: 1 },
      block: makeBlockApi(),
      api: makeApi(),
      readOnly: true,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();

    expect(host.querySelector('.view')?.textContent).toBe('ro');

    unmount();
  });
});
