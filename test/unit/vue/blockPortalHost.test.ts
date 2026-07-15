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
