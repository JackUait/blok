import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import { BlokContent } from '../../../packages/vue/src/BlokContent';
import { createVueBlock } from '../../../packages/vue/src/createVueBlock';
import { useBlokInstance } from '../../../packages/vue/src/blok-instance';
import { useBlocks } from '../../../packages/vue/src/useBlocks';
import { createBlockPortalRegistry } from '../../../packages/vue/src/block-portal-registry';
import { setHolder, removeHolder } from '../../../packages/vue/src/holder-map';
import { setRegistry, removeRegistry } from '../../../packages/vue/src/registry-map';
import type { Blok } from '../../../types';
import type { API } from '../../../types';
import type { BlockAPI } from '../../../types/api';

const REGISTRY_CONFIG_KEY = '__blokPortalRegistry';

interface FlatBlock {
  id: string;
  name: string;
  parentId: string | null;
}

/**
 * A minimal stand-in for a live editor: the flat block list `useBlocks` reads
 * through, plus the `block changed` emitter it subscribes to.
 */
const makeFakeEditor = (
  initial: FlatBlock[]
): { editor: Blok; addBlock: (block: FlatBlock) => void } => {
  const list = [...initial];
  const listeners = new Set<() => void>();

  const editor = {
    blocks: {
      getBlocksCount: (): number => list.length,
      getBlockByIndex: (index: number): FlatBlock | undefined => list[index],
      getBlockIndex: (id: string): number => list.findIndex(block => block.id === id),
    },
    on: (event: string, handler: () => void): void => {
      if (event === 'block changed') {
        listeners.add(handler);
      }
    },
    off: (_event: string, handler: () => void): void => {
      listeners.delete(handler);
    },
  } as unknown as Blok;

  return {
    editor,
    addBlock: (block: FlatBlock): void => {
      list.push(block);
      listeners.forEach(handler => handler());
    },
  };
};

const makeBlockApi = (id: string): BlockAPI =>
  ({ id, contentIds: [], getChildren: () => [], dispatchChange: vi.fn() } as unknown as BlockAPI);

const makeApi = (): API => ({ blocks: { isPointerDragActive: false } } as unknown as API);

describe('block components reach the live editor through provide/inject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('useBlokInstance() inside a block component returns the editor that owns it', async () => {
    const { editor } = makeFakeEditor([{ id: 'container', name: 'container', parentId: null }]);
    const registry = createBlockPortalRegistry();

    setHolder(editor, document.createElement('div'));
    setRegistry(editor, registry);

    const seen: (Blok | null)[] = [];

    const Tool = createVueBlock({
      type: 'container',
      propSchema: {},
      setup() {
        const instance = useBlokInstance();

        return () => {
          seen.push(instance.value);

          return h('span', { class: 'view' });
        };
      },
    });

    const wrapper = mount(BlokContent, { props: { editor } });

    const tool = new Tool({
      data: {},
      block: makeBlockApi('container'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });

    document.body.appendChild(tool.render());
    await nextTick();

    expect(seen.at(-1)).toBe(editor);

    wrapper.unmount();
    removeRegistry(editor);
    removeHolder(editor);
  });

  it('re-renders a container block when a NON-Vue child joins its subtree', async () => {
    const { editor, addBlock } = makeFakeEditor([
      { id: 'container', name: 'container', parentId: null },
    ]);
    const registry = createBlockPortalRegistry();

    setHolder(editor, document.createElement('div'));
    setRegistry(editor, registry);

    const Tool = createVueBlock({
      type: 'container',
      propSchema: {},
      setup({ block }) {
        const blocks = useBlocks(useBlokInstance());

        return () => h('span', { class: 'count' }, String(blocks.getChildren(block.id).length));
      },
    });

    const wrapper = mount(BlokContent, { props: { editor } });

    const tool = new Tool({
      data: {},
      block: makeBlockApi('container'),
      api: makeApi(),
      readOnly: false,
      config: { [REGISTRY_CONFIG_KEY]: registry },
    });
    const host = tool.render();

    document.body.appendChild(host);
    await nextTick();

    expect(host.querySelector('.count')?.textContent).toBe('0');

    // A PLAIN CORE child: it registers no portal entry, so nothing in the
    // adapter's own machinery re-renders the parent — only the editor's
    // 'block changed' subscription can.
    addBlock({ id: 'para', name: 'paragraph', parentId: 'container' });
    await nextTick();

    expect(host.querySelector('.count')?.textContent).toBe('1');

    wrapper.unmount();
    removeRegistry(editor);
    removeHolder(editor);
  });
});
