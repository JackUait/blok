import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { BlokEditor } from '../../../packages/vue/src/BlokEditor';

describe('BlokEditor recreate semantics', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not recreate when only tools change', async () => {
    const wrapper = mount(BlokEditor, { props: { recreateKey: 'a', tools: { paragraph: {} } } });

    blokRegistry.last!.resolveReady();
    await flushPromises();
    const first = blokRegistry.last!;

    await wrapper.setProps({ tools: { paragraph: {}, header: {} } });
    await flushPromises();

    expect(blokRegistry.instances).toHaveLength(1);
    expect(first.destroy).not.toHaveBeenCalled();
  });

  it('destroys and recreates when recreateKey identity changes', async () => {
    const wrapper = mount(BlokEditor, { props: { recreateKey: 'a' } });

    blokRegistry.last!.resolveReady();
    await flushPromises();
    const first = blokRegistry.last!;

    await wrapper.setProps({ recreateKey: 'b' });
    await flushPromises();

    expect(blokRegistry.instances).toHaveLength(2);
    expect(first.destroy).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale isReady from a superseded editor after recreate', async () => {
    const wrapper = mount(BlokEditor, { props: { recreateKey: 'a' } });
    const first = blokRegistry.last!;

    // Recreate BEFORE the first editor resolves.
    await wrapper.setProps({ recreateKey: 'b' });
    const second = blokRegistry.last!;

    second.resolveReady();
    await flushPromises();

    const vm = wrapper.vm as unknown as { instance: unknown };

    expect(vm.instance).toBe(second);

    // The superseded first editor resolves late — it must not become the instance.
    first.resolveReady();
    await flushPromises();

    expect(vm.instance).toBe(second);
  });
});
