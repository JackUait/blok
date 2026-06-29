import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../src/vue/useBlok';
import type { UseBlokConfig } from '../../../src/vue/types';
import type { OutputData } from '@/types';

async function mountReady(initial: UseBlokConfig): Promise<{ config: UseBlokConfig }> {
  const config = reactive({ ...initial }) as UseBlokConfig;

  const Harness = defineComponent({
    setup() {
      useBlok(() => config);

      return () => h('div');
    },
  });

  mount(Harness);
  blokRegistry.last!.resolveReady();
  await flushPromises();

  return { config };
}

describe('useBlok reactive data', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render on initial mount (data seeded at construction)', async () => {
    await mountReady({ data: { blocks: [] } as OutputData });

    expect(blokRegistry.last!.render).not.toHaveBeenCalled();
  });

  it('renders new data reactively when content changes, without recreating', async () => {
    const { config } = await mountReady({
      data: { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] } as OutputData,
    });
    const instance = blokRegistry.last!;

    expect(instance.render).not.toHaveBeenCalled();

    config.data = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'b' } }] } as OutputData;
    await flushPromises();

    expect(blokRegistry.instances).toHaveLength(1);
    expect(instance.render).toHaveBeenCalledTimes(1);
    expect(instance.render).toHaveBeenCalledWith(
      expect.objectContaining({ blocks: [{ id: '1', type: 'paragraph', data: { text: 'b' } }] })
    );
  });

  it('does not render when new data reference has identical content (deep-equal dedup)', async () => {
    const { config } = await mountReady({
      data: { blocks: [{ id: '1', type: 'paragraph', data: { text: 'x' } }] } as OutputData,
    });
    const instance = blokRegistry.last!;

    config.data = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'x' } }] } as OutputData;
    await flushPromises();

    expect(instance.render).not.toHaveBeenCalled();
  });

  it('serializes successive data changes in order', async () => {
    const { config } = await mountReady({
      data: { blocks: [{ id: '1', type: 'paragraph', data: { text: '1' } }] } as OutputData,
    });
    const instance = blokRegistry.last!;

    config.data = { blocks: [{ id: '1', type: 'paragraph', data: { text: '2' } }] } as OutputData;
    await flushPromises();
    config.data = { blocks: [{ id: '1', type: 'paragraph', data: { text: '3' } }] } as OutputData;
    await flushPromises();

    const lastArg = instance.render.mock.calls.at(-1)?.[0] as OutputData;

    expect(lastArg).toMatchObject({ blocks: [{ id: '1', type: 'paragraph', data: { text: '3' } }] });
  });

  it('passes a plain (non-reactive) object to render — no Vue proxy reaches core', async () => {
    const { config } = await mountReady({
      data: { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] } as OutputData,
    });
    const instance = blokRegistry.last!;

    config.data = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'b' } }] } as OutputData;
    await flushPromises();

    const { isReactive } = await import('vue');
    const renderedArg = instance.render.mock.calls.at(-1)?.[0] as OutputData;

    expect(isReactive(renderedArg)).toBe(false);
  });
});
