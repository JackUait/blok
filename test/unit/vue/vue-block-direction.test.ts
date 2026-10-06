/**
 * A Vue block teleports its content on the next tick, after core's render().
 * Its direction stamp has to land once the text is there.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h } from 'vue';
import { mount, flushPromises } from '@vue/test-utils';

import { Blok } from '../../../src/blok';
import { createVueBlock } from '../../../packages/vue/src/createVueBlock';
import { BLOK_PORTAL_REGISTRY_CONFIG_KEY, createBlockPortalRegistry } from '../../../packages/vue/src/block-portal-registry';
import { BlockPortalHost } from '../../../packages/vue/src/BlockPortalHost';

const NoteTool = createVueBlock({
  type: 'note',
  propSchema: { text: { default: '' } },
  setup({ data }) {
    return () => h('div', { contenteditable: 'true' }, String((data.value as { text: string }).text));
  },
});

const frames = async (count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  }
};

describe('per-block direction of a Vue block', () => {
  let holder: HTMLElement;
  let editor: Blok | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);
  });

  afterEach(async () => {
    if (editor !== null) {
      await editor.isReady;
      editor.destroy();
      editor = null;
    }
    holder.remove();
    vi.restoreAllMocks();
  });

  it('stamps the block once its teleport has rendered the text', async () => {
    const registry = createBlockPortalRegistry();
    const host = mount(BlockPortalHost, { props: { registry } });

    editor = new Blok({
      holder,
      tools: { note: { class: NoteTool, config: { [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry } } },
      data: { blocks: [{ id: 'n', type: 'note', data: { text: 'مرحبا' } }] },
    });
    await editor.isReady;
    await flushPromises();
    await frames(3);

    const content = holder.querySelector('[data-blok-id="n"] [data-blok-element-content]');

    expect(content?.textContent).toBe('مرحبا');
    expect(content?.getAttribute('dir')).toBe('rtl');
    host.unmount();
  });

  it('re-stamps after an update re-renders the text', async () => {
    const registry = createBlockPortalRegistry();
    const host = mount(BlockPortalHost, { props: { registry } });

    editor = new Blok({
      holder,
      tools: { note: { class: NoteTool, config: { [BLOK_PORTAL_REGISTRY_CONFIG_KEY]: registry } } },
      data: { blocks: [{ id: 'n', type: 'note', data: { text: 'Hello' } }] },
    });
    await editor.isReady;
    await flushPromises();

    await (editor as unknown as { blocks: { update: (id: string, data: Record<string, unknown>) => Promise<unknown> } }).blocks.update('n', { text: 'مرحبا' });
    await flushPromises();
    await frames(3);

    const content = holder.querySelector('[data-blok-id="n"] [data-blok-element-content]');

    expect(content?.textContent).toBe('مرحبا');
    expect(content?.getAttribute('dir')).toBe('rtl');
    host.unmount();
  });
});
