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

/** The wrapped `onSave` core actually received (sets the dedup baseline). */
function coreOnSave(): (data: OutputData) => void {
  return (blokRegistry.last!.config as { onSave: (data: OutputData) => void }).onSave;
}

describe('useBlok v-model:data baseline (onSave dedup)', () => {
  const seed = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] } as OutputData;
  const payload = {
    blocks: [{ id: '1', type: 'paragraph', data: { text: 'ab' } }],
    time: 123,
    version: '1',
  } as OutputData;

  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards the editor-emitted payload to the user onSave', async () => {
    const onSave = vi.fn();

    await mountReady({ data: seed, onSave });

    coreOnSave()(payload);

    expect(onSave).toHaveBeenCalledWith(payload);
  });

  it('does not re-render when controlled data echoes the onSave payload (caret-stable)', async () => {
    const onSave = vi.fn();

    const { config } = await mountReady({ data: seed, onSave });
    const instance = blokRegistry.last!;

    // Editor emits its serialized output (a user edit). The wrapper records it as
    // the baseline BEFORE the consumer echoes it back into `data`.
    coreOnSave()(payload);

    config.data = payload;
    await flushPromises();

    expect(instance.render).not.toHaveBeenCalled();
  });

  it('still renders a genuine external change that differs from the last payload', async () => {
    const onSave = vi.fn();
    const external = { blocks: [{ id: '2', type: 'paragraph', data: { text: 'elsewhere' } }] } as OutputData;

    const { config } = await mountReady({ data: seed, onSave });
    const instance = blokRegistry.last!;

    coreOnSave()(payload);

    config.data = external;
    await flushPromises();

    expect(instance.render).toHaveBeenCalledTimes(1);
    expect(instance.render).toHaveBeenCalledWith(
      expect.objectContaining({ blocks: [{ id: '2', type: 'paragraph', data: { text: 'elsewhere' } }] })
    );
  });

  it('does not wire a core onSave when the consumer provides none', async () => {
    await mountReady({ data: seed });

    expect((blokRegistry.last!.config as { onSave?: unknown }).onSave).toBeUndefined();
  });
});
