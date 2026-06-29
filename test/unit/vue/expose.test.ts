import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { BlokEditor } from '../../../src/vue/BlokEditor';
import type { OutputData } from '@/types';

interface ExposedEditor {
  instance: unknown;
  save: () => Promise<OutputData> | undefined;
  focus: (atEnd?: boolean) => void;
  render: (data: OutputData) => Promise<void> | undefined;
}

describe('BlokEditor exposed instance + facade', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes a null instance before ready and the live instance after', async () => {
    const wrapper = mount(BlokEditor);
    const vm = wrapper.vm as unknown as ExposedEditor;

    expect(vm.instance).toBeNull();

    blokRegistry.last!.resolveReady();
    await flushPromises();

    expect(vm.instance).toBe(blokRegistry.last);
  });

  it('delegates save/focus/render to the live instance', async () => {
    const wrapper = mount(BlokEditor);

    blokRegistry.last!.resolveReady();
    await flushPromises();

    const instance = blokRegistry.last!;
    const vm = wrapper.vm as unknown as ExposedEditor;

    void vm.save();
    vm.focus(true);
    const data = { blocks: [] } as OutputData;

    void vm.render(data);

    expect(instance.save).toHaveBeenCalledTimes(1);
    expect(instance.focus).toHaveBeenCalledWith(true);
    expect(instance.render).toHaveBeenCalledWith(data);
  });

  it('facade methods are no-ops before the editor is ready', () => {
    const wrapper = mount(BlokEditor);
    const vm = wrapper.vm as unknown as ExposedEditor;

    expect(() => vm.save()).not.toThrow();
    expect(() => vm.focus()).not.toThrow();
    expect(() => vm.render({ blocks: [] } as OutputData)).not.toThrow();
  });
});
