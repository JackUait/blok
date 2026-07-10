import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, computed, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useBlocks } from '../../../src/vue/useBlocks';
import type { UseBlocksApi } from '../../../src/vue/blocks-snapshot';
import type { Blok } from '../../../types';
import { Blocks } from '../../../src/components/blocks';
import { BlockRepository } from '../../../src/components/modules/blockManager/repository';
import { BlockHierarchy } from '../../../src/components/modules/blockManager/hierarchy';
import type { BlocksStore } from '../../../src/components/modules/blockManager/types';
import type { Block } from '../../../src/components/block';

/**
 * Vue counterpart to the React `useBlocks — real BlockHierarchy integration`
 * test. The whole point of the shared `createBlocksApiForEditor` core is that the
 * Vue wrapper carries the IDENTICAL behavior; this drives the Vue `useBlocks`
 * against the REAL Blocks store + BlockRepository + BlockHierarchy (not fakes),
 * so subtree-aware nest/move/remove and reactivity are proven end-to-end through
 * the Vue reactivity layer — not just delegation-mocked.
 */

const createBlockStub = (options: { id: string; name?: string; parentId?: string | null }): Block =>
  ({
    id: options.id,
    name: options.name ?? 'paragraph',
    parentId: options.parentId ?? null,
    contentIds: [] as string[],
    indent: 0,
    holder: (() => {
      const el = document.createElement('div');

      el.setAttribute('data-blok-element', '');

      return el;
    })(),
    call: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Block);

interface RealEditorHarness {
  editor: Blok;
  workingArea: HTMLElement;
}

let insertSeq = 0;

const createRealEditorHarness = (
  initialBlocks: ReadonlyArray<{ id: string; name?: string; parentId?: string | null }>
): RealEditorHarness => {
  const workingArea = document.createElement('div');

  document.body.appendChild(workingArea);

  const blocksStore = new Blocks(workingArea);
  const repository = new BlockRepository();

  repository.initialize(blocksStore as unknown as BlocksStore);

  const hierarchy = new BlockHierarchy(repository);

  for (const cfg of initialBlocks) {
    blocksStore.push(createBlockStub(cfg) as unknown as Block);
  }

  const listeners = new Set<() => void>();
  const notify = (): void => listeners.forEach((cb) => cb());

  const editorBlocks = {
    getBlocksCount: (): number => blocksStore.length,

    getBlockByIndex: (i: number): { id: string; name: string; parentId: string | null } | undefined => {
      const block = blocksStore.array[i];

      return block === undefined ? undefined : { id: block.id, name: block.name, parentId: block.parentId };
    },

    getBlockIndex: (id: string): number | undefined => {
      const idx = blocksStore.array.findIndex((b) => b.id === id);

      return idx === -1 ? undefined : idx;
    },

    insert: (
      type?: string,
      _data?: unknown,
      _cfg?: unknown,
      index?: number,
      _needToFocus?: boolean,
      _replace?: boolean,
      explicitId?: string
    ): { id: string; name: string; parentId: string | null } => {
      insertSeq += 1;
      const id = explicitId ?? `inserted-${insertSeq}`;
      const stub = createBlockStub({ id, name: type ?? 'paragraph' });
      const insertAt = index !== undefined ? Math.min(index, blocksStore.length) : blocksStore.length;

      blocksStore.insert(insertAt, stub as unknown as Block);
      notify();

      return { id: stub.id, name: stub.name, parentId: stub.parentId };
    },

    insertMany: (
      blocks: ReadonlyArray<{ id?: string; type?: string; parent?: string | null }>,
      index?: number
    ): Array<{ id: string }> => {
      const startAt = index !== undefined ? Math.min(Math.max(index, 0), blocksStore.length) : blocksStore.length;
      const created = blocks.map((cfg, offset) => {
        insertSeq += 1;
        const id = cfg.id ?? `inserted-${insertSeq}`;
        const stub = createBlockStub({ id, name: cfg.type ?? 'paragraph', parentId: null });

        blocksStore.insert(startAt + offset, stub as unknown as Block);

        if (cfg.parent !== null && cfg.parent !== undefined) {
          hierarchy.setBlockParent(stub as unknown as Block, cfg.parent);
        }

        return { id };
      });

      notify();

      return created;
    },

    setBlockParent: (childId: string, parentId: string | null): void => {
      const block = blocksStore.array.find((b) => b.id === childId);

      if (block === undefined) {
        return;
      }
      hierarchy.setBlockParent(block, parentId);
      notify();
    },

    delete: async (index?: number): Promise<void> => {
      if (index !== undefined && index >= 0 && index < blocksStore.length) {
        blocksStore.remove(index);
        notify();
      }
      await Promise.resolve();
    },

    // Faithful to core Blocks.move(): post-removal index space + cross-container
    // auto-heal (the moved block adopts the parent of the block at toIndex), which
    // routes through the REAL BlockHierarchy.setBlockParent (throws on a cycle, as
    // core does — the subtree-relocation self-overlap guard depends on this).
    move: (toIndex: number, fromIndex?: number): void => {
      if (fromIndex === undefined) {
        return;
      }
      const count = blocksStore.length;

      if (toIndex < 0 || toIndex >= count || fromIndex < 0 || fromIndex >= count) {
        return;
      }
      const movingBlock = blocksStore.array[fromIndex];
      const neighborBlock = blocksStore.array[toIndex];
      const destinationParentId = neighborBlock !== undefined ? neighborBlock.parentId : null;

      blocksStore.move(toIndex, fromIndex);

      if (movingBlock !== undefined && movingBlock.parentId !== destinationParentId) {
        hierarchy.setBlockParent(movingBlock, destinationParentId);
      }
      notify();
    },

    transact: (fn: () => void): void => fn(),
  };

  const editor = {
    blocks: editorBlocks,
    on: (_name: string, cb: () => void): void => {
      listeners.add(cb);
    },
    off: (_name: string, cb: () => void): void => {
      listeners.delete(cb);
    },
  } as unknown as Blok;

  return { editor, workingArea };
};

/** Mount useBlocks and expose the api + a computed probe over the tree. */
const mountUseBlocks = (
  editorRef: Ref<Blok | null>
): { api: UseBlocksApi; rootIds: () => string[]; unmount: () => void } => {
  let apiRef: UseBlocksApi;
  let rootIdsRef: () => string[];

  const Harness = defineComponent({
    setup() {
      const blocks = useBlocks(editorRef);

      apiRef = blocks;
      const roots = computed(() => blocks.getChildren(null).map((n) => n.id));

      rootIdsRef = (): string[] => roots.value;

      return () => h('div');
    },
  });
  const wrapper = mount(Harness);

  return { api: apiRef!, rootIds: rootIdsRef!, unmount: () => wrapper.unmount() };
};

const flatIds = (editor: Blok): string[] => {
  const out: string[] = [];

  for (let i = 0; i < editor.blocks.getBlocksCount(); i++) {
    const n = editor.blocks.getBlockByIndex(i);

    if (n !== undefined) {
      out.push(n.id);
    }
  }

  return out;
};

describe('useBlocks (Vue) — real BlockHierarchy integration', () => {
  let workingArea: HTMLElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    insertSeq = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    workingArea?.remove();
    workingArea = null;
  });

  it('insert under a container lands as that container child (real hierarchy)', () => {
    const harness = createRealEditorHarness([{ id: 'container' }]);

    workingArea = harness.workingArea;
    const { api } = mountUseBlocks(ref<Blok | null>(harness.editor));

    const node = api.insert({ type: 'paragraph', parentId: 'container' });

    expect(node?.parentId).toBe('container');
    expect(api.getChildren('container').map((n) => n.id)).toEqual([node?.id]);
  });

  it('insertMany lands every block as contiguous children of a container', () => {
    const harness = createRealEditorHarness([{ id: 'container' }, { id: 'tail' }]);

    workingArea = harness.workingArea;
    const { api } = mountUseBlocks(ref<Blok | null>(harness.editor));

    const created = api.insertMany([
      { type: 'paragraph', parentId: 'container' },
      { type: 'header', parentId: 'container' },
    ]);

    expect(created).toHaveLength(2);
    expect(api.getChildren('container').map((n) => n.id)).toEqual(created.map((n) => n.id));
    expect(api.getChildren(null).map((n) => n.id)).toEqual(['container', 'tail']);
  });

  it('nest is subtree-aware: a block WITH a child relocates the whole subtree under the new parent', () => {
    // Seed: container, x (a block with its own child xc), and a trailing root.
    const harness = createRealEditorHarness([
      { id: 'container' },
      { id: 'x' },
      { id: 'xc', parentId: 'x' },
      { id: 'tail' },
    ]);

    workingArea = harness.workingArea;
    const { api } = mountUseBlocks(ref<Blok | null>(harness.editor));

    api.nest('x', 'container');

    // x is now a child of container, and its OWN child xc still belongs to x.
    expect(api.getById('x')?.parentId).toBe('container');
    expect(api.getById('xc')?.parentId).toBe('x');

    // The subtree stays DFS-contiguous: x immediately followed by xc.
    const flat = flatIds(harness.editor);

    expect(flat.indexOf('xc')).toBe(flat.indexOf('x') + 1);
    // tail remains a root sibling.
    expect(api.getChildren(null).map((n) => n.id)).toContain('tail');
  });

  it('remove is subtree-aware: deletes the block AND all descendants (real store)', () => {
    const harness = createRealEditorHarness([
      { id: 'p' },
      { id: 'c1', parentId: 'p' },
      { id: 'c2', parentId: 'p' },
      { id: 'keep' },
    ]);

    workingArea = harness.workingArea;
    const { api } = mountUseBlocks(ref<Blok | null>(harness.editor));

    api.remove('p');

    expect(flatIds(harness.editor)).toEqual(['keep']);
    expect(api.getById('p')).toBeNull();
    expect(api.getById('c1')).toBeNull();
    expect(api.getById('c2')).toBeNull();
  });

  it('move relocates a subtree as a sibling of the ref (real hierarchy)', () => {
    const harness = createRealEditorHarness([
      { id: 'a' },
      { id: 'b' },
      { id: 'bc', parentId: 'b' },
      { id: 'c' },
    ]);

    workingArea = harness.workingArea;
    const { api } = mountUseBlocks(ref<Blok | null>(harness.editor));

    // Move b (with child bc) to after c — the whole subtree travels together.
    api.move('b', { after: 'c' });

    const flat = flatIds(harness.editor);

    expect(flat.indexOf('b')).toBeGreaterThan(flat.indexOf('c'));
    expect(flat.indexOf('bc')).toBe(flat.indexOf('b') + 1);
    expect(api.getById('bc')?.parentId).toBe('b');
  });

  it('reads are reactive against the real store: a computed re-runs after a mutation', async () => {
    const harness = createRealEditorHarness([{ id: 'r1' }]);

    workingArea = harness.workingArea;
    const { api, rootIds } = mountUseBlocks(ref<Blok | null>(harness.editor));

    expect(rootIds()).toEqual(['r1']);

    api.insert({ type: 'paragraph' });
    await nextTick();

    expect(rootIds()).toHaveLength(2);
  });

  it('an editor that resolves null → ready starts as EMPTY_API then becomes live', async () => {
    const editorRef = ref<Blok | null>(null);
    const { api, rootIds } = mountUseBlocks(editorRef);

    // Pre-ready: no-op surface.
    expect(api.insert({ type: 'paragraph' })).toBeNull();
    expect(rootIds()).toEqual([]);

    // Editor resolves (as useBlok's shallowRef does null → Blok).
    const harness = createRealEditorHarness([{ id: 'seed' }]);

    workingArea = harness.workingArea;
    editorRef.value = harness.editor;
    await nextTick();

    expect(rootIds()).toEqual(['seed']);
    const node = api.insert({ type: 'paragraph' });

    expect(node).not.toBeNull();
    expect(rootIds()).toHaveLength(2);
  });
});
