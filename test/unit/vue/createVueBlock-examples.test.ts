/**
 * Canonical `createVueBlock` examples that double as verification:
 *  - Callout — a LEAF block (no children).
 *  - Toggle  — a CONTAINER block using the engine-owned `BlockChildren` slot,
 *              exercising the nesting path (mountChildBlocks into the slot).
 *
 * Both are authored as `.ts` render functions (no `.vue` SFC) — Risk R1.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import { createVueBlock } from '../../../src/vue/createVueBlock';
import { createBlockPortalRegistry, type BlockPortalRegistry } from '../../../src/vue/block-portal-registry';
import { BlockPortalHost } from '../../../src/vue/BlockPortalHost';
import type { BlockAPI } from '../../../types/api';

const REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

const mountHost = (): { registry: BlockPortalRegistry; unmount: () => void } => {
  const registry = createBlockPortalRegistry();
  const wrapper = mount(BlockPortalHost, { props: { registry } });

  return { registry, unmount: () => wrapper.unmount() };
};

const makeBlockApi = (
  id: string,
  children: { holder: HTMLElement }[] = []
): BlockAPI & { dispatchChange: ReturnType<typeof vi.fn> } =>
  ({
    id,
    contentIds: children.map((_, i) => `${id}-c${i}`),
    getChildren: () => children as unknown as BlockAPI[],
    dispatchChange: vi.fn(),
  } as unknown as BlockAPI & { dispatchChange: ReturnType<typeof vi.fn> });

const makeApi = (): unknown => ({ blocks: { isPointerDragActive: false } });

interface CalloutData {
  emoji: string;
  tone: 'info' | 'warn';
  text: string;
}

const Callout = createVueBlock<CalloutData>({
  type: 'callout',
  toolbox: { title: 'Callout', icon: '<svg></svg>' },
  propSchema: {
    emoji: { default: '💡' },
    tone: { default: 'info', values: ['info', 'warn'] },
    text: { default: '' },
  },
  setup({ data, commit }) {
    const next = (e: string): string => (e === '💡' ? '⚠️' : '💡');

    return () =>
      h('aside', { class: `callout callout--${data.value.tone}` }, [
        h('button', { class: 'emoji', onClick: () => commit({ emoji: next(data.value.emoji) }) }, data.value.emoji),
        h('p', { class: 'text' }, data.value.text),
      ]);
  },
});

interface ToggleData {
  open: boolean;
  summary: string;
}

const Toggle = createVueBlock<ToggleData>({
  type: 'toggle',
  toolbox: { title: 'Toggle', icon: '<svg></svg>' },
  propSchema: { open: { default: true }, summary: { default: '' } },
  setup({ data, commit, BlockChildren }) {
    return () =>
      h('div', { class: 'toggle' }, [
        h(
          'button',
          { class: 'summary', onClick: () => commit({ open: !data.value.open }) },
          data.value.summary
        ),
        data.value.open ? h(BlockChildren) : null,
      ]);
  },
});

describe('createVueBlock examples', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('Callout (leaf): renders defaults-filled and commits a field change', async () => {
    const { registry, unmount } = mountHost();
    const tool = new Callout({
      data: { text: 'Heads up' },
      block: makeBlockApi('callout-1'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as never);

    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();

    expect(host.querySelector('.callout--info')).not.toBeNull();
    expect(host.querySelector('.emoji')?.textContent).toBe('💡');
    expect(host.querySelector('.text')?.textContent).toBe('Heads up');

    host.querySelector<HTMLButtonElement>('.emoji')!.click();
    await nextTick();

    expect(host.querySelector('.emoji')?.textContent).toBe('⚠️');
    expect(tool.save()).toEqual({ emoji: '⚠️', tone: 'info', text: 'Heads up' });

    unmount();
  });

  it('Toggle (container): mounts child block holders into the BlockChildren slot', async () => {
    const { registry, unmount } = mountHost();

    // Two fake child block holders (as core would expose via getChildren()).
    const childA = document.createElement('div');

    childA.className = 'child-a';
    const childB = document.createElement('div');

    childB.className = 'child-b';

    const tool = new Toggle({
      data: { open: true, summary: 'Details' },
      block: makeBlockApi('toggle-1', [{ holder: childA }, { holder: childB }]),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as never);

    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();
    await nextTick();

    // The engine-owned slot exists and the child holders were appended into it.
    const slot = host.querySelector('[data-blok-nested-blocks]');

    expect(slot).not.toBeNull();
    expect(slot?.querySelector('.child-a')).not.toBeNull();
    expect(slot?.querySelector('.child-b')).not.toBeNull();

    unmount();
  });

  it('Toggle (container): collapsing hides the child slot', async () => {
    const { registry, unmount } = mountHost();
    const childA = document.createElement('div');

    childA.className = 'child-a';

    const tool = new Toggle({
      data: { open: true, summary: 'Details' },
      block: makeBlockApi('toggle-2', [{ holder: childA }]),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    } as never);

    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();
    expect(host.querySelector('[data-blok-nested-blocks]')).not.toBeNull();

    // Collapse via the summary toggle.
    host.querySelector<HTMLButtonElement>('.summary')!.click();
    await nextTick();

    expect(host.querySelector('[data-blok-nested-blocks]')).toBeNull();

    unmount();
  });
});
