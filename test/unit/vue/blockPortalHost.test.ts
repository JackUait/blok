import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, inject, nextTick, reactive } from 'vue';
import { mount } from '@vue/test-utils';

import { createBlockPortalRegistry } from '../../../packages/vue/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/vue/src/BlockPortalHost';

const makeHost = (): HTMLElement => {
  const el = document.createElement('div');

  document.body.appendChild(el);

  return el;
};

/** A trivial render-function block component that echoes its props. */
const LabelBlock = defineComponent({
  props: { label: { type: String, default: '' } },
  setup(props) {
    return () => h('span', { class: 'label' }, props.label);
  },
});

describe('BlockPortalHost + registry (Vue)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders a registered component into its host element', async () => {
    const registry = createBlockPortalRegistry();
    const wrapper = mount(BlockPortalHost, { props: { registry } });
    const host = makeHost();

    registry.register('b1', { hostEl: host, component: LabelBlock, props: reactive({ label: 'hello' }) });
    await nextTick();

    expect(host.querySelector('.label')?.textContent).toBe('hello');

    wrapper.unmount();
  });

  it('updates the rendered component when setProps is called (no re-register)', async () => {
    const registry = createBlockPortalRegistry();
    const wrapper = mount(BlockPortalHost, { props: { registry } });
    const host = makeHost();

    registry.register('b1', { hostEl: host, component: LabelBlock, props: reactive({ label: 'first' }) });
    await nextTick();
    expect(host.querySelector('.label')?.textContent).toBe('first');

    registry.setProps('b1', { label: 'second' });
    await nextTick();
    expect(host.querySelector('.label')?.textContent).toBe('second');

    wrapper.unmount();
  });

  it('unregister removes the rendered content from its host', async () => {
    const registry = createBlockPortalRegistry();
    const wrapper = mount(BlockPortalHost, { props: { registry } });
    const host = makeHost();

    registry.register('b1', { hostEl: host, component: LabelBlock, props: reactive({ label: 'x' }) });
    await nextTick();
    expect(host.querySelector('.label')).not.toBeNull();

    registry.unregister('b1');
    await nextTick();
    expect(host.querySelector('.label')).toBeNull();

    wrapper.unmount();
  });

  /**
   * C2: core composes the REPLACEMENT block (which registers under the same id)
   * BEFORE it destroys the old one, so the superseded tool's
   * `removed()`/`destroy()` teardown arrives AFTER the new entry is in the
   * registry. An unconditional delete there wipes the live entry.
   */
  it('a late teardown from a superseded owner cannot clobber a same-id re-register', async () => {
    const registry = createBlockPortalRegistry();
    const wrapper = mount(BlockPortalHost, { props: { registry } });
    const first = makeHost();
    const second = makeHost();

    registry.register('b1', { hostEl: first, component: LabelBlock, props: reactive({ label: 'old' }) });
    registry.register('b1', { hostEl: second, component: LabelBlock, props: reactive({ label: 'new' }) });
    // The superseded owner tears itself down, twice (removed() + destroy()).
    registry.unregister('b1', first);
    registry.unregister('b1', first);
    await nextTick();

    expect(registry.entries.get('b1')?.hostEl).toBe(second);
    expect(second.querySelector('.label')?.textContent).toBe('new');

    wrapper.unmount();
  });

  it('the live owner can still unregister itself', async () => {
    const registry = createBlockPortalRegistry();
    const wrapper = mount(BlockPortalHost, { props: { registry } });
    const host = makeHost();

    registry.register('b1', { hostEl: host, component: LabelBlock, props: reactive({ label: 'x' }) });
    await nextTick();

    registry.unregister('b1', host);
    await nextTick();

    expect(registry.entries.has('b1')).toBe(false);
    expect(host.querySelector('.label')).toBeNull();

    wrapper.unmount();
  });

  it('renders many blocks through ONE host into their own targets', async () => {
    const registry = createBlockPortalRegistry();
    const wrapper = mount(BlockPortalHost, { props: { registry } });
    const hostA = makeHost();
    const hostB = makeHost();

    registry.register('a', { hostEl: hostA, component: LabelBlock, props: reactive({ label: 'A' }) });
    registry.register('b', { hostEl: hostB, component: LabelBlock, props: reactive({ label: 'B' }) });
    await nextTick();

    expect(hostA.querySelector('.label')?.textContent).toBe('A');
    expect(hostB.querySelector('.label')?.textContent).toBe('B');

    wrapper.unmount();
  });

  it('is idempotent on double register and double unregister', async () => {
    const registry = createBlockPortalRegistry();
    const wrapper = mount(BlockPortalHost, { props: { registry } });
    const host = makeHost();

    registry.register('b1', { hostEl: host, component: LabelBlock, props: reactive({ label: 'once' }) });
    registry.register('b1', { hostEl: host, component: LabelBlock, props: reactive({ label: 'twice' }) });
    await nextTick();

    // A single rendered instance (no duplicate), reflecting the latest registration.
    expect(host.querySelectorAll('.label')).toHaveLength(1);
    expect(host.querySelector('.label')?.textContent).toBe('twice');

    registry.unregister('b1');
    expect(() => registry.unregister('b1')).not.toThrow();

    wrapper.unmount();
  });

  it('teleported blocks inherit the app provide/inject context', async () => {
    const registry = createBlockPortalRegistry();
    const host = makeHost();

    const InjectingBlock = defineComponent({
      setup() {
        const provided = inject<string>('shared-token', 'MISSING');

        return () => h('span', { class: 'injected' }, provided);
      },
    });

    // Provide a token in a parent that also mounts the host; a teleported block
    // must see it (Teleport preserves the component render context, not the DOM
    // target's) — this is the shared-DI guarantee the design relies on.
    const Parent = defineComponent({
      provide: { 'shared-token': 'FROM_APP' },
      setup() {
        return () => h(BlockPortalHost, { registry });
      },
    });

    const wrapper = mount(Parent);

    registry.register('b1', { hostEl: host, component: InjectingBlock, props: reactive({}) });
    await nextTick();

    expect(host.querySelector('.injected')?.textContent).toBe('FROM_APP');

    wrapper.unmount();
  });
});
