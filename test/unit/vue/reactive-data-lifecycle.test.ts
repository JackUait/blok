import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import type { MockBlokInstance } from './mock-blok';
import { useBlok } from '../../../packages/vue/src/useBlok';
import type { UseBlokConfig } from '../../../packages/vue/src/types';

const doc = (text: string): UseBlokConfig['data'] => ({ blocks: [{ id: '1', type: 'paragraph', data: { text } }] });

const lastInstance = (): MockBlokInstance => {
  const instance = blokRegistry.last;

  if (instance === undefined) {
    throw new Error('no editor was constructed');
  }

  return instance;
};

const mountHarness = (initial: UseBlokConfig): { config: UseBlokConfig; unmount: () => void } => {
  const config = reactive({ ...initial });

  const Harness = defineComponent({
    setup() {
      useBlok(() => config);

      return () => h('div');
    },
  });

  const wrapper = mount(Harness);

  return { config, unmount: () => wrapper.unmount() };
};

describe('useBlok data changes around the editor lifecycle', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders data that changed after construction but before the editor was ready', async () => {
    const { config } = mountHarness({ data: doc('seed') });
    const instance = lastInstance();

    config.data = doc('loaded');
    await flushPromises();
    instance.resolveReady();
    await flushPromises();

    expect(instance.render).toHaveBeenCalledTimes(1);
    expect(instance.render).toHaveBeenCalledWith(expect.objectContaining(doc('loaded')));
  });

  it('does not render when the data still equals what the editor was built with', async () => {
    mountHarness({ data: doc('seed') });
    const instance = lastInstance();

    instance.resolveReady();
    await flushPromises();

    expect(instance.render).not.toHaveBeenCalled();
  });

  it('does not run a queued render on an editor destroyed while an earlier render was in flight', async () => {
    const { config, unmount } = mountHarness({ data: doc('seed') });
    const instance = lastInstance();

    instance.resolveReady();
    await flushPromises();

    const finishFirst: Array<() => void> = [];

    instance.render.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishFirst.push(resolve);
    }));

    config.data = doc('first');
    await flushPromises();
    config.data = doc('second');
    await flushPromises();

    expect(instance.render).toHaveBeenCalledTimes(1);

    unmount();
    finishFirst.forEach((resolve) => resolve());
    await flushPromises();

    expect(instance.destroy).toHaveBeenCalled();
    expect(instance.render).toHaveBeenCalledTimes(1);
  });
});
