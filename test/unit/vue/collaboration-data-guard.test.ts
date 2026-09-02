import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import type { MockBlokInstance } from './mock-blok';
import { useBlok } from '../../../packages/vue/src/useBlok';
import type { UseBlokConfig } from '../../../packages/vue/src/types';
import type { OutputData } from '@/types';

function doc(text: string): OutputData {
  return { time: 0, version: '0', blocks: [{ id: '1', type: 'paragraph', data: { text } }] };
}

const COLLABORATION: UseBlokConfig = {
  server: 'https://blok.example',
  collaboration: { doc: 'notes' },
};

const lastBlok = (): MockBlokInstance => {
  const last = blokRegistry.last;

  if (last === undefined) {
    throw new Error('no Blok instance was constructed');
  }

  return last;
};

async function mountReady(initial: UseBlokConfig): Promise<{ config: UseBlokConfig }> {
  const config = reactive({ ...initial });

  const Harness = defineComponent({
    setup() {
      useBlok(() => config);

      return () => h('div');
    },
  });

  mount(Harness);
  lastBlok().resolveReady();
  await flushPromises();

  return { config };
}

describe('useBlok controlled data under collaboration', () => {
  let warnings: string[] = [];

  const collaborationWarnings = (): string[] =>
    warnings.filter((message) => message.includes('collaboration is on'));

  beforeEach(() => {
    blokRegistry.reset();
    warnings = [];
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds data at mount without rendering or warning', async () => {
    await mountReady({ ...COLLABORATION, data: doc('seed') });

    expect(lastBlok().config.data).toEqual(doc('seed'));
    expect(lastBlok().render).not.toHaveBeenCalled();
    expect(collaborationWarnings()).toHaveLength(0);
  });

  it('skips the controlled re-render and warns once across repeated data changes', async () => {
    const { config } = await mountReady({ ...COLLABORATION, data: doc('a') });
    const instance = lastBlok();

    // A render the adapter must never reach: reaching it would also surface an
    // unhandled rejection, which is the bug this guard removes.
    instance.render.mockRejectedValue(new Error('blocks.render() is not allowed while collaboration is on'));

    config.data = doc('b');
    await flushPromises();
    config.data = doc('c');
    await flushPromises();

    expect(instance.render).not.toHaveBeenCalled();

    const seen = collaborationWarnings();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('POST /sync/notes/reset');
  });

  it('keeps skipping (and warns) after the host drops the collaboration key', async () => {
    // `collaboration` is mount-fixed: dropping it from the config cannot turn
    // the live editor into a single-player one, so the guard must decide
    // against what the editor was CONSTRUCTED with. Reading the current config
    // lets the change fall through into render(), which rejects with nothing
    // surfaced.
    const { config } = await mountReady({ ...COLLABORATION, data: doc('a') });
    const instance = lastBlok();

    instance.render.mockRejectedValue(new Error('blocks.render() is not allowed while collaboration is on'));

    config.collaboration = undefined;
    config.data = doc('b');
    await flushPromises();

    expect(instance.render).not.toHaveBeenCalled();

    const seen = collaborationWarnings();

    expect(seen).toHaveLength(1);
    // The doc id comes from the MOUNTED config, so the reset endpoint is still
    // nameable after the key is gone.
    expect(seen[0]).toContain('POST /sync/notes/reset');
  });

  it('still re-renders on a data change when collaboration is off', async () => {
    const { config } = await mountReady({ data: doc('a') });
    const instance = lastBlok();

    config.data = doc('b');
    await flushPromises();

    expect(instance.render).toHaveBeenCalledTimes(1);
    expect(collaborationWarnings()).toHaveLength(0);
  });
});
