import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../src/vue/useBlok';
import type { UseBlokConfig } from '../../../src/vue/types';

/** Mounts useBlok over a reactive config and resolves the editor immediately. */
async function mountReady(initial: UseBlokConfig): Promise<{ config: UseBlokConfig; unmount: () => void }> {
  const config = reactive({ ...initial }) as UseBlokConfig;

  const Harness = defineComponent({
    setup() {
      useBlok(() => config);

      return () => h('div');
    },
  });

  const wrapper = mount(Harness);

  blokRegistry.last!.resolveReady();
  await flushPromises();

  return { config, unmount: () => wrapper.unmount() };
}

describe('useBlok reactive props', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('syncs readOnly, coercing undefined to false', async () => {
    const { config } = await mountReady({ readOnly: false });
    const instance = blokRegistry.last!;

    expect(instance.readOnly.set).toHaveBeenCalledWith(false);

    config.readOnly = true;
    await nextTick();
    expect(instance.readOnly.set).toHaveBeenLastCalledWith(true);

    config.readOnly = undefined;
    await nextTick();
    expect(instance.readOnly.set).toHaveBeenLastCalledWith(false);
  });

  it('syncs theme only when defined', async () => {
    const { config } = await mountReady({});
    const instance = blokRegistry.last!;

    expect(instance.theme.set).not.toHaveBeenCalled();

    config.theme = 'dark';
    await nextTick();
    expect(instance.theme.set).toHaveBeenCalledWith('dark');
  });

  it('syncs width only when defined', async () => {
    const { config } = await mountReady({});
    const instance = blokRegistry.last!;

    expect(instance.width.set).not.toHaveBeenCalled();

    config.width = 'narrow';
    await nextTick();
    expect(instance.width.set).toHaveBeenCalledWith('narrow');
  });

  it('syncs placeholder, guarding on undefined (not falsiness)', async () => {
    const { config } = await mountReady({ placeholder: 'First' });
    const instance = blokRegistry.last!;

    expect(instance.placeholder.set).toHaveBeenCalledWith('First');

    // placeholder=false is a real value (clear) — must propagate.
    config.placeholder = false;
    await nextTick();
    expect(instance.placeholder.set).toHaveBeenLastCalledWith(false);
  });

  it('calls focus when autofocus is truthy, not when falsy', async () => {
    const { config } = await mountReady({ autofocus: false });
    const instance = blokRegistry.last!;

    expect(instance.focus).not.toHaveBeenCalled();

    config.autofocus = true;
    await nextTick();
    expect(instance.focus).toHaveBeenCalledTimes(1);
  });

  it('applies reactive props once after the instance appears (not before ready)', async () => {
    const config = reactive({ readOnly: true } as UseBlokConfig);

    const Harness = defineComponent({
      setup() {
        useBlok(() => config);

        return () => h('div');
      },
    });

    mount(Harness);
    const instance = blokRegistry.last!;

    // Editor not ready yet — nothing applied.
    expect(instance.readOnly.set).not.toHaveBeenCalled();

    instance.resolveReady();
    await flushPromises();

    // Applied exactly once when the instance became available.
    expect(instance.readOnly.set).toHaveBeenCalledTimes(1);
    expect(instance.readOnly.set).toHaveBeenCalledWith(true);
  });
});
