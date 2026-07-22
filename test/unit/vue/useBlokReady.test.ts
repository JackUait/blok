import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useBlokReady } from '../../../packages/vue/src/useBlokReady';
import {
  registerInstance,
  unregisterInstance,
} from '../../../src/components/utils/ready-registry';

/**
 * A stand-in for a Blok facade: the readiness registry only needs an identity
 * key and a way to find the instance's wrapper element.
 */
interface FakeInstance {
  key: unknown;
  wrapper: HTMLElement;
  settle: () => void;
}

const created: FakeInstance[] = [];

/**
 * Registers a fake booting instance whose wrapper is mounted in `scope`.
 * @param scope - element the wrapper is appended to
 */
const bootInstance = (scope: Element): FakeInstance => {
  const key = {};
  const wrapper = document.createElement('div');

  scope.appendChild(wrapper);

  const instance: FakeInstance = {
    key,
    wrapper,
    settle: registerInstance(key, () => wrapper),
  };

  created.push(instance);

  return instance;
};

/**
 * Drains the registry's coalesced microtask notification and Vue's render queue.
 */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await nextTick();
};

/**
 * Mounts a probe exposing the composable's ref and its scope element.
 * @param settleOn - readiness depth passed to the composable
 * @param scoped - whether to pass the template ref as the scope
 */
const mountProbe = (
  { scoped, settleOn }: { scoped: boolean; settleOn?: 'ready' | 'rendered' }
): { ready: Ref<boolean>; scope: HTMLElement; unmount: () => void } => {
  const holder = { ready: null as Ref<boolean> | null };
  const Probe = defineComponent({
    setup() {
      const scopeRef = ref<HTMLElement | null>(null);

      holder.ready = useBlokReady({
        within: scoped ? scopeRef : undefined,
        settleOn,
      });

      // The scope element carries no Vue-rendered children: the test appends
      // editor wrappers into it imperatively, as BlokContent does.
      return () => h('div', {
        ref: scopeRef,
        'data-testid': 'scope',
      });
    },
  });

  const wrapper = mount(Probe, { attachTo: document.body });

  return {
    ready: holder.ready as Ref<boolean>,
    scope: wrapper.element as HTMLElement,
    unmount: () => wrapper.unmount(),
  };
};

describe('useBlokReady (Vue)', () => {
  afterEach(() => {
    created.forEach((instance) => unregisterInstance(instance.key));
    created.length = 0;
    document.body.replaceChildren();
  });

  it('reports pending while an instance boots and ready once it settles', async () => {
    const probe = mountProbe({ scoped: true });
    const instance = bootInstance(probe.scope);

    await flush();
    expect(probe.ready.value).toBe(false);

    instance.settle();
    await flush();

    expect(probe.ready.value).toBe(true);

    probe.unmount();
  });

  it('ignores instances mounted outside the scope', async () => {
    const outside = document.createElement('div');

    document.body.appendChild(outside);

    const probe = mountProbe({ scoped: true });
    const inside = bootInstance(probe.scope);

    bootInstance(outside);

    await flush();
    expect(probe.ready.value).toBe(false);

    inside.settle();
    await flush();

    expect(probe.ready.value).toBe(true);

    probe.unmount();
  });

  it('re-arms when a post-boot re-render clears the rendered attribute', async () => {
    const probe = mountProbe({
      scoped: true,
      settleOn: 'rendered',
    });
    const instance = bootInstance(probe.scope);

    instance.settle();
    await flush();
    expect(probe.ready.value).toBe(false);

    instance.wrapper.setAttribute('data-blok-rendered', '');
    await flush();
    expect(probe.ready.value).toBe(true);

    instance.wrapper.removeAttribute('data-blok-rendered');
    await flush();
    expect(probe.ready.value).toBe(false);

    probe.unmount();
  });

  it('stops reading after the component is unmounted', async () => {
    const probe = mountProbe({ scoped: true });
    const instance = bootInstance(probe.scope);

    // Settle into the pending reading FIRST, so the assertion below cannot
    // pass on a stale pre-boot value.
    await flush();
    expect(probe.ready.value).toBe(false);

    probe.unmount();
    instance.settle();
    await flush();

    // The subscription was disposed with the effect scope, so the ref of the
    // torn-down component never flips.
    expect(probe.ready.value).toBe(false);
  });
});
