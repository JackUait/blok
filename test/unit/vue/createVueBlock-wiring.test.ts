import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick, reactive, type Ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../packages/vue/src/useBlok';
import { BlokContent } from '../../../packages/vue/src/BlokContent';
import { createVueBlock } from '../../../packages/vue/src/createVueBlock';
import { getRegistry } from '../../../packages/vue/src/registry-map';
import { createBlockPortalRegistry } from '../../../packages/vue/src/block-portal-registry';
import { setHolder } from '../../../packages/vue/src/holder-map';
import type { UseBlokConfig } from '../../../packages/vue/src/types';
import type { Blok } from '../../../types';

const VueBlock = createVueBlock({
  type: 'vblock',
  propSchema: { text: { default: '' } },
  setup({ data }) {
    return () => h('span', { class: 'vb' }, String((data.value as { text: string }).text));
  },
});

class VanillaTool {
  public render(): HTMLElement {
    return document.createElement('div');
  }
  public save(): { text: string } {
    return { text: '' };
  }
}

const mountUseBlok = (config: UseBlokConfig): { editor: Ref<Blok | null>; unmount: () => void } => {
  let editorRef: Ref<Blok | null>;

  const Harness = defineComponent({
    setup() {
      editorRef = useBlok(() => config);

      return () => h('div');
    },
  });
  const wrapper = mount(Harness);

  return { editor: editorRef!, unmount: () => wrapper.unmount() };
};

const coreConfig = (): Record<string, unknown> => blokRegistry.last!.config;

describe('createVueBlock end-to-end wiring', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marks the factory output as a Vue block', () => {
    expect((VueBlock as unknown as { __isBlokVueBlock?: boolean }).__isBlokVueBlock).toBe(true);
  });

  it('injects the editor portal registry into a vue-block tool config', () => {
    const { unmount } = mountUseBlok({
      tools: { vblock: { class: VueBlock } },
    });

    const tools = coreConfig().tools as Record<string, { config?: Record<string, unknown> }>;
    const injected = tools.vblock.config?.__blokPortalRegistry;

    expect(injected).toBeDefined();
    // The SAME registry is associated with the editor (so BlokContent finds it).
    expect(injected).toBe(getRegistry(blokRegistry.last as unknown as Blok));

    unmount();
  });

  it('does NOT inject a registry into a vanilla tool config', () => {
    const { unmount } = mountUseBlok({
      tools: { vanilla: { class: VanillaTool } },
    });

    const tools = coreConfig().tools as Record<string, { config?: Record<string, unknown> }>;

    expect(tools.vanilla.config?.__blokPortalRegistry).toBeUndefined();

    unmount();
  });

  it('BlokContent mounts the portal host for an editor that has a registry', async () => {
    const registry = createBlockPortalRegistry();
    const holder = document.createElement('div');
    const editor = { id: 'ed' } as unknown as Blok;

    setHolder(editor, holder);
    // Associate a registry as useBlok would.
    const { setRegistry } = await import('../../../packages/vue/src/registry-map');

    setRegistry(editor, registry);

    const wrapper = mount(BlokContent, { props: { editor } });

    // Register a block into the registry; BlokContent's host must render it.
    const host = document.createElement('div');

    document.body.appendChild(host);
    const Block = defineComponent({
      setup() {
        return () => h('i', { class: 'rendered' }, 'ok');
      },
    });

    registry.register('b1', { hostEl: host, component: Block, props: reactive({}) });
    await nextTick();
    await flushPromises();

    expect(host.querySelector('.rendered')?.textContent).toBe('ok');

    wrapper.unmount();
  });
});
