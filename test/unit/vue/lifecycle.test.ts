import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, isReactive, reactive, type Ref } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../src/vue/useBlok';
import type { UseBlokConfig } from '../../../src/vue/types';
import type { Blok } from '@/types';

/** Mounts a harness that drives `useBlok` from a reactive config object. */
function mountUseBlok(config: UseBlokConfig): {
  editor: Ref<Blok | null>;
  unmount: () => void;
} {
  let editorRef: Ref<Blok | null>;

  const Harness = defineComponent({
    setup() {
      const editor = useBlok(() => config);

      editorRef = editor;

      return () => h('div');
    },
  });

  const wrapper = mount(Harness);

  // editorRef is assigned synchronously inside setup during mount.
  return { editor: editorRef!, unmount: () => wrapper.unmount() };
}

describe('useBlok lifecycle', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is null until isReady resolves, then exposes the instance', async () => {
    const { editor } = mountUseBlok({});

    expect(blokRegistry.instances).toHaveLength(1);
    expect(editor.value).toBeNull();

    blokRegistry.last!.resolveReady();
    await flushPromises();

    expect(editor.value).toBe(blokRegistry.last);
  });

  it('creates the editor with a detached holder div in its config', () => {
    mountUseBlok({});

    const passed = blokRegistry.last!.config as { holder: unknown };

    expect(passed.holder).toBeInstanceOf(HTMLDivElement);
  });

  it('hands core a plain (non-reactive) config and data — no Vue proxy reaches core', () => {
    const data = reactive({ blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] });

    mountUseBlok({ data: data as unknown as UseBlokConfig['data'], readOnly: true });

    const passed = blokRegistry.last!.config as { data: unknown; readOnly: unknown };

    expect(isReactive(passed)).toBe(false);
    expect(isReactive(passed.data)).toBe(false);
    expect(passed.readOnly).toBe(true);
  });

  it('destroys the editor exactly once on unmount', async () => {
    const { unmount } = mountUseBlok({});

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const instance = blokRegistry.last!;

    unmount();

    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not expose an editor whose isReady never resolves', async () => {
    const { editor } = mountUseBlok({});

    await flushPromises();

    expect(editor.value).toBeNull();
  });
});
