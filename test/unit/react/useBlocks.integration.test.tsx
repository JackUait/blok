/**
 * Integration smoke test for `useBlocks` against a REAL BlockHierarchy +
 * BlockRepository + Blocks harness.
 *
 * Purpose: pin the index/parent semantics that the fake editor in
 * useBlocks.test.tsx can only approximate.  Specifically:
 *   – after insert + setBlockParent, getChildren sees the mutated parentId
 *   – nest → unnest round-trips parentId back to null correctly
 *
 * Harness decision: a full `new Blok()` boot is impractical in jsdom because
 * it requires a Tool registry, full module initialisation, and a Yjs document.
 * Every existing unit test that creates a `Blok` instance mocks the Core class.
 * Instead we wire the REAL BlockHierarchy, BlockRepository, and Blocks store
 * directly – the three components that actually own the parentId contract –
 * and expose a minimal `editor.blocks` facade to drive `useBlocks`.  The real
 * `BlockHierarchy.setBlockParent` mutates `block.parentId` synchronously, so
 * `getChildren` reads back the correct value immediately.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBlocks } from '../../../src/react/useBlocks';
import type { Blok } from '../../../types';
import { Blocks } from '../../../src/components/blocks';
import { BlockRepository } from '../../../src/components/modules/blockManager/repository';
import { BlockHierarchy } from '../../../src/components/modules/blockManager/hierarchy';
import type { BlocksStore } from '../../../src/components/modules/blockManager/types';
import type { Block } from '../../../src/components/block';

// ─── Block stub ──────────────────────────────────────────────────────────────

/**
 * Minimal Block stub that satisfies BlockHierarchy (needs parentId, contentIds,
 * holder, id, name) and Blocks (needs holder.parentElement, call).
 */
const createBlockStub = (options: {
  id: string;
  name?: string;
  parentId?: string | null;
}): Block =>
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

// ─── Harness factory ─────────────────────────────────────────────────────────

interface RealEditorHarness {
  /** Cast as Blok for `useBlocks(editor)`. Only `.blocks` and `.on/.off` are real. */
  editor: Blok;
  /** The container element added to document.body — must be removed in afterEach. */
  workingArea: HTMLElement;
}

let insertSeq = 0;

const createRealEditorHarness = (
  initialBlocks: ReadonlyArray<{ id: string; name?: string; parentId?: string | null }>
): RealEditorHarness => {
  const workingArea = document.createElement('div');

  document.body.appendChild(workingArea);

  // Real hierarchy components
  const blocksStore = new Blocks(workingArea);
  const repository = new BlockRepository();

  repository.initialize(blocksStore as unknown as BlocksStore);

  // BlockHierarchy without optional callbacks — sufficient for simple nesting
  const hierarchy = new BlockHierarchy(repository);

  // Seed initial blocks into the real store
  for (const cfg of initialBlocks) {
    blocksStore.push(createBlockStub(cfg) as unknown as Block);
  }

  // Minimal event bus for the 'block changed' subscription in useBlocks
  const listeners = new Set<() => void>();

  /**
   * editor.blocks facade.
   * Reads use blocksStore.array directly (no Proxy needed).
   * Mutations delegate to the REAL Blocks store and BlockHierarchy.
   */
  const editorBlocks = {
    getBlocksCount: (): number => blocksStore.length,

    getBlockByIndex: (
      i: number
    ): { id: string; name: string; parentId: string | null } | undefined => {
      const block = blocksStore.array[i];

      return block === undefined
        ? undefined
        : { id: block.id, name: block.name, parentId: block.parentId };
    },

    getBlockIndex: (id: string): number | undefined => {
      const idx = blocksStore.array.findIndex((b) => b.id === id);

      return idx === -1 ? undefined : idx;
    },

    /**
     * Creates a stub block, inserts it into the real store, and returns an
     * object with `.id` so that `useBlocks.insert` can call setBlockParent.
     */
    insert: (
      type?: string,
      _data?: unknown,
      _cfg?: unknown,
      index?: number
    ): { id: string; name: string; parentId: string | null } => {
      insertSeq += 1;
      const id = `inserted-${insertSeq}`;
      const stub = createBlockStub({ id, name: type ?? 'paragraph' });
      const insertAt =
        index !== undefined ? Math.min(index, blocksStore.length) : blocksStore.length;

      blocksStore.insert(insertAt, stub as unknown as Block);

      return { id: stub.id, name: stub.name, parentId: stub.parentId };
    },

    /**
     * Delegates to the REAL BlockHierarchy.setBlockParent which
     * synchronously mutates block.parentId and contentIds.
     */
    setBlockParent: (childId: string, parentId: string | null): void => {
      const block = blocksStore.array.find((b) => b.id === childId);

      if (block === undefined) {
        return;
      }
      hierarchy.setBlockParent(block, parentId);
    },

    delete: async (_index?: number): Promise<void> => {
      await Promise.resolve();
    },

    move: (_toIndex: number, _fromIndex?: number): void => undefined,

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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useBlocks — real BlockHierarchy integration', () => {
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

  it('insert under a container block shows up as that container child', () => {
    const harness = createRealEditorHarness([{ id: 'container' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.insert({ type: 'paragraph', parentId: 'container' });
    });

    const children = result.current.getChildren('container');

    expect(children).toHaveLength(1);
    expect(children[0].parentId).toBe('container');
  });

  it('nest then unnest round-trips parentId back to null', () => {
    const harness = createRealEditorHarness([
      { id: 'block-a' },
      { id: 'block-b' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    // Initially both are root blocks
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['block-a', 'block-b']);
    expect(result.current.getChildren('block-a')).toHaveLength(0);

    // Nest block-b under block-a using the REAL hierarchy
    act(() => {
      result.current.nest('block-b', 'block-a');
    });

    // Real BlockHierarchy.setBlockParent set block-b.parentId = 'block-a'
    expect(result.current.getChildren('block-a').map((n) => n.id)).toEqual(['block-b']);
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['block-a']);

    // Unnest block-b back to root
    act(() => {
      result.current.unnest('block-b');
    });

    // Real BlockHierarchy.setBlockParent set block-b.parentId = null
    expect(result.current.getChildren('block-a')).toHaveLength(0);
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['block-a', 'block-b']);
  });
});
