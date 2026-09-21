import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, reactive, ref, type Ref } from 'vue';
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

function mountHarness(
  initial: UseBlokConfig,
  recreateKey?: Ref<unknown>
): { config: UseBlokConfig } {
  const config = reactive({ ...initial });

  const Harness = defineComponent({
    setup() {
      useBlok(
        () => config,
        recreateKey === undefined ? undefined : () => recreateKey.value
      );

      return () => h('div');
    },
  });

  mount(Harness);

  return { config };
}

/** Let Node's microtask queue drain far enough for an unhandled rejection to be reported. */
async function settleMacrotasks(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe('useBlok collaboration warning and render chain', () => {
  let warnings: string[] = [];

  const collaborationWarnings = (): string[] => warnings.filter((message) => message.includes('collaboration is on'));

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

  describe('collaboration warning is keyed by editor', () => {
    it('warns again for the editor a recreateKey bump builds', async () => {
      const key = ref('a');
      const { config } = mountHarness({ ...COLLABORATION, data: doc('seed') }, key);

      lastBlok().resolveReady();
      await flushPromises();

      config.data = doc('first');
      await flushPromises();

      expect(collaborationWarnings()).toHaveLength(1);

      key.value = 'b';
      await flushPromises();
      lastBlok().resolveReady();
      await flushPromises();

      const second = lastBlok();

      config.data = doc('second');
      await flushPromises();

      // The SECOND editor also ignores the host's data; it must say so rather
      // than inherit the first editor's "already warned" flag.
      expect(collaborationWarnings()).toHaveLength(2);
      expect(second.render).not.toHaveBeenCalled();
    });

    it('still warns only once for a single editor', async () => {
      const { config } = mountHarness({ ...COLLABORATION, data: doc('seed') });

      lastBlok().resolveReady();
      await flushPromises();

      config.data = doc('a');
      await flushPromises();
      config.data = doc('b');
      await flushPromises();

      expect(collaborationWarnings()).toHaveLength(1);
      expect(lastBlok().render).not.toHaveBeenCalled();
    });
  });

  describe('render chain owns a failed render', () => {
    it('leaves no unhandled rejection when render() rejects', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };

      process.on('unhandledRejection', onUnhandled);

      try {
        const { config } = mountHarness({ data: doc('a') });

        lastBlok().resolveReady();
        await flushPromises();

        lastBlok().render.mockRejectedValue(new Error('render blew up'));

        config.data = doc('b');
        await flushPromises();
        await settleMacrotasks();

        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    it('keeps rendering later data after a failed render', async () => {
      const { config } = mountHarness({ data: doc('a') });

      lastBlok().resolveReady();
      await flushPromises();

      const instance = lastBlok();

      instance.render.mockRejectedValueOnce(new Error('render blew up'));

      config.data = doc('b');
      await flushPromises();
      await settleMacrotasks();

      config.data = doc('c');
      await flushPromises();
      await settleMacrotasks();

      expect(instance.render).toHaveBeenCalledTimes(2);
    });
  });

  describe('the success baseline survives a failed render', () => {
    it('re-renders the same content after the first attempt failed', async () => {
      const { config } = mountHarness({ data: doc('a') });

      lastBlok().resolveReady();
      await flushPromises();

      const instance = lastBlok();

      instance.render.mockRejectedValueOnce(new Error('render blew up'));

      config.data = doc('b');
      await flushPromises();
      await settleMacrotasks();

      expect(instance.render).toHaveBeenCalledTimes(1);

      // The editor still shows 'a' — the failed render changed nothing. A host
      // that pushes the same content again must get a real render, not a
      // dedupe against a baseline the editor never reached.
      config.data = doc('b');
      await flushPromises();
      await settleMacrotasks();

      expect(instance.render).toHaveBeenCalledTimes(2);
    });

    it('still dedupes an echo of content that rendered successfully', async () => {
      const { config } = mountHarness({ data: doc('a') });

      lastBlok().resolveReady();
      await flushPromises();

      const instance = lastBlok();

      config.data = doc('b');
      await flushPromises();
      await settleMacrotasks();

      expect(instance.render).toHaveBeenCalledTimes(1);

      config.data = doc('b');
      await flushPromises();
      await settleMacrotasks();

      expect(instance.render).toHaveBeenCalledTimes(1);
    });
  });
});
