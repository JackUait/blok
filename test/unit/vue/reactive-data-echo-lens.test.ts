import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, reactive } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

vi.mock('../../../src/blok', async () => await import('./mock-blok'));

import { blokRegistry } from './mock-blok';
import { useBlok } from '../../../packages/vue/src/useBlok';
import type { UseBlokConfig } from '../../../packages/vue/src/types';

/**
 * Mounts the composable with a reactive config and resolves the editor.
 * @param initial - initial composable config
 * @returns the reactive config object the test mutates
 */
async function mountReady(initial: UseBlokConfig): Promise<{ config: UseBlokConfig }> {
  const config = reactive({ ...initial });

  const Harness = defineComponent({
    setup() {
      useBlok(() => config);

      return () => h('div');
    },
  });

  mount(Harness);
  blokRegistry.last?.resolveReady();
  await flushPromises();

  return { config };
}

describe('useBlok reactive data — echo lens', () => {
  beforeEach(() => {
    blokRegistry.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not re-render a controlled value whose only delta is edit metadata', async () => {
    // A host that persists a stripped copy of the editor's document (no
    // `lastEditedAt` stamp, no envelope) is handing back content the editor
    // already shows. Re-rendering it resets the caret for zero visual change.
    const { config } = await mountReady({
      data: {
        time: 1,
        version: '1',
        blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' }, lastEditedAt: 1700000000000 }],
      },
    });
    const instance = blokRegistry.last;

    config.data = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' } }] };
    await flushPromises();

    expect(instance?.render).not.toHaveBeenCalled();
  });

  it('still renders when the content itself changed', async () => {
    const { config } = await mountReady({
      data: { blocks: [{ id: '1', type: 'paragraph', data: { text: 'a' }, lastEditedAt: 1700000000000 }] },
    });
    const instance = blokRegistry.last;

    config.data = { blocks: [{ id: '1', type: 'paragraph', data: { text: 'b' } }] };
    await flushPromises();

    expect(instance?.render).toHaveBeenCalledTimes(1);
  });
});
