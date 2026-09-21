import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../packages/vue/src/useBlok';
import type { UseBlokConfig } from '../../../packages/vue/src/types';
import type { OutputData } from '@/types';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

async function mountReady(initial: UseBlokConfig): Promise<{ config: UseBlokConfig }> {
  const config = reactive({ ...initial });

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

/** The wrapped `onSave` core actually received (it feeds the echo window). */
function coreOnSave(): (data: OutputData) => void {
  return (blokRegistry.last!.config as { onSave: (data: OutputData) => void }).onSave;
}

describe('useBlok emitted-echo window', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ignores a STALE echo of an earlier onSave payload', async () => {
    // The ordinary persist-on-save-and-refetch ordering: two payloads are
    // emitted, and the host's write of the FIRST one resolves last. Rendering it
    // is a whole-document replace, so everything typed between the two saves
    // ceases to exist AND the editor's next save writes the rewound document
    // back over the newer one — permanent loss in the host's store.
    const { config } = await mountReady({ data: doc('a'), onSave: vi.fn() });
    const instance = blokRegistry.last!;

    coreOnSave()(doc('a1'));
    coreOnSave()(doc('a12'));

    config.data = doc('a1');
    await flushPromises();

    expect(instance.render).not.toHaveBeenCalled();
  });

  it('still renders content the editor never emitted', async () => {
    const { config } = await mountReady({ data: doc('a'), onSave: vi.fn() });
    const instance = blokRegistry.last!;

    coreOnSave()(doc('a1'));
    coreOnSave()(doc('a12'));

    const external = doc('from a collaborator');

    config.data = external;
    await flushPromises();

    expect(instance.render).toHaveBeenCalledTimes(1);
    expect(instance.render).toHaveBeenCalledWith(external);
  });

  it('drops remembered payloads once genuinely external content takes over', async () => {
    // After the host imposes its own document, a later deliberate revert to a
    // previously emitted one must render rather than be dismissed as an echo.
    const { config } = await mountReady({ data: doc('a'), onSave: vi.fn() });
    const instance = blokRegistry.last!;

    coreOnSave()(doc('a1'));
    coreOnSave()(doc('a12'));

    config.data = doc('external');
    await flushPromises();

    const revert = doc('a1');

    config.data = revert;
    await flushPromises();

    expect(instance.render).toHaveBeenCalledTimes(2);
    expect(instance.render).toHaveBeenLastCalledWith(revert);
  });
});
