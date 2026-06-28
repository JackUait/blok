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
  // The real editor fires 'block changed' after every structural mutation; the
  // facade mirrors that so the hook's reactivity can be exercised end-to-end.
  const notify = (): void => listeners.forEach((cb) => cb());

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

      // Faithful to core block-insertion.ts: a non-parented insert whose flat
      // PREDECESSOR lives inside a `column` auto-inherits that column as its
      // parent (the "Duplicate inside a column" path). Replicated here so the
      // harness exercises the real wrong-parent trap the adapter must counter.
      const predecessor = blocksStore.array[insertAt - 1];
      const predecessorParent =
        predecessor?.parentId !== null && predecessor?.parentId !== undefined
          ? blocksStore.array.find((b) => b.id === predecessor.parentId)
          : undefined;

      if (predecessorParent !== undefined && predecessorParent.name === 'column') {
        hierarchy.setBlockParent(stub as unknown as Block, predecessorParent.id);
      }

      notify();

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
      notify();
    },

    delete: async (index?: number): Promise<void> => {
      if (index !== undefined && index >= 0 && index < blocksStore.length) {
        blocksStore.remove(index);
        notify();
      }
      await Promise.resolve();
    },

    // Faithful to Blok's Blocks.move() (block-mutation.ts): toIndex is the
    // POST-removal index space (splice out fromIndex, then splice in at
    // toIndex). Two core side effects are mirrored so the hook is exercised
    // against real semantics:
    //
    //   1. Column-boundary clamp: a block that lives in a `column` cannot be
    //      moved next to a block of a DIFFERENT parent (it would be ejected
    //      from its column). Core no-ops such a move; mirrored here.
    //   2. Cross-container auto-heal: after the flat reorder, the moved block
    //      ADOPTS the parent of the block that sat at `toIndex` (read on the
    //      pre-removal array, as core does). A heal that would form a cycle
    //      (target parent is the moved block itself or one of its descendants)
    //      is skipped — real core's BlockHierarchy.setBlockParent refuses such
    //      a cycle, so the heal never lands; skipping keeps the harness from
    //      throwing on the transient self-parent the subtree relocation hits
    //      before useBlocks re-asserts the final parents.
    move: (toIndex: number, fromIndex?: number): void => {
      if (fromIndex === undefined) {
        return;
      }

      const count = blocksStore.length;

      // Mirror repository.validateIndex: 0 <= index < length.
      if (toIndex < 0 || toIndex >= count || fromIndex < 0 || fromIndex >= count) {
        return;
      }

      const movingBlock = blocksStore.array[fromIndex];
      const neighborBlock = blocksStore.array[toIndex];
      const destinationParentId = neighborBlock !== undefined ? neighborBlock.parentId : null;

      // (1) Column-boundary clamp.
      const movingParent =
        movingBlock?.parentId !== null && movingBlock?.parentId !== undefined
          ? blocksStore.array.find((b) => b.id === movingBlock.parentId)
          : undefined;

      if (movingParent?.name === 'column' && destinationParentId !== movingBlock.parentId) {
        return;
      }

      blocksStore.move(toIndex, fromIndex);

      // (2) Cross-container auto-heal (cycle-guarded — see method doc).
      if (movingBlock !== undefined && movingBlock.parentId !== destinationParentId) {
        const wouldFormCycle = ((): boolean => {
          let cursor: string | null = destinationParentId;
          const seen = new Set<string>();

          while (cursor !== null) {
            if (cursor === movingBlock.id || seen.has(cursor)) {
              return true;
            }
            seen.add(cursor);
            cursor = blocksStore.array.find((b) => b.id === cursor)?.parentId ?? null;
          }

          return false;
        })();

        if (!wouldFormCycle) {
          hierarchy.setBlockParent(movingBlock, destinationParentId);
        }
      }

      notify();
    },

    /**
     * Async like core's Blocks.update — mutates the block's data (not exposed on
     * BlockNode) and notifies so the hook re-renders. Drives reactivity tests.
     */
    update: async (
      id: string,
      data?: unknown,
      _tunes?: unknown
    ): Promise<void> => {
      const block = blocksStore.array.find((b) => b.id === id);

      if (block !== undefined) {
        (block as unknown as { data: unknown }).data = data;
        notify();
      }
      await Promise.resolve();
    },

    /**
     * Async like core's Blocks.convert — swaps the block's tool name (the
     * observable `type` on a BlockNode) and notifies.
     */
    convert: async (id: string, newType: string, _dataOverrides?: unknown): Promise<void> => {
      const block = blocksStore.array.find((b) => b.id === id);

      if (block !== undefined) {
        (block as unknown as { name: string }).name = newType;
        notify();
      }
      await Promise.resolve();
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

  it('insertMany places every block under a container as contiguous children', () => {
    // Bulk insert must route each spec through the same single-insert parent
    // assertion path against the REAL hierarchy — not a bare flat append — so
    // all three land as children of `container` in array order.
    const harness = createRealEditorHarness([{ id: 'container' }, { id: 'tail' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let created: ReturnType<typeof result.current.insertMany> = [];

    act(() => {
      created = result.current.insertMany([
        { type: 'paragraph', parentId: 'container' },
        { type: 'header', parentId: 'container' },
        { type: 'paragraph', parentId: 'container' },
      ]);
    });

    expect(created).toHaveLength(3);

    const children = result.current.getChildren('container');

    expect(children.map((n) => n.parentId)).toEqual(['container', 'container', 'container']);
    expect(children.map((n) => n.type)).toEqual(['paragraph', 'header', 'paragraph']);
    expect(children.map((n) => n.id)).toEqual(created.map((n) => n.id));

    // The pre-existing root sibling is untouched and still a root block.
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['container', 'tail']);
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

  it('nesting a NON-adjacent block keeps the flat array DFS-contiguous', () => {
    // [A, B, C] all root. Nesting C under A naively (bare setBlockParent) would
    // leave the flat array as [A, B, C] with C.parentId=A — B wedged between A
    // and its own child. useBlocks must relocate C so the model stays contiguous.
    const harness = createRealEditorHarness([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.nest('C', 'A');
    });

    // C is now A's child AND sits immediately after A in flat order.
    expect(result.current.getChildren('A').map((n) => n.id)).toEqual(['C']);
    expect(result.current.getById('C')?.parentId).toBe('A');
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['A', 'B']);
    // Flat (document) order: A, then its child C, then root sibling B.
    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['A', 'C', 'B']);
  });

  it('nesting a block that itself has children relocates the WHOLE subtree contiguously', () => {
    // [A, B, C, C1] with C1 nested under C (e.g. a list item with a sub-item,
    // nested via the flat indent model — child holder NOT DOM-contained, so
    // Blok's resortNestedBlocks can't carry it). nest('C','A') must move C AND
    // C1, not strand C1 after root sibling B.
    const harness = createRealEditorHarness([
      { id: 'A' },
      { id: 'B' },
      { id: 'C' },
      { id: 'C1', parentId: 'C' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    expect(result.current.getChildren('C').map((n) => n.id)).toEqual(['C1']);

    act(() => {
      result.current.nest('C', 'A');
    });

    expect(result.current.getChildren('A').map((n) => n.id)).toEqual(['C']);
    expect(result.current.getChildren('C').map((n) => n.id)).toEqual(['C1']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    // C's whole subtree sits contiguously after A, before root sibling B.
    expect(flat).toEqual(['A', 'C', 'C1', 'B']);
  });

  it('FORWARD nest (parent later in the doc) of a block with 2 children stays contiguous', () => {
    // [C, C1, C2, A] — C is root with two indent-nested children C1, C2; A is a
    // LATER root block. nest('C','A') relocates C's subtree FORWARD (past where
    // its descendants were left). The relocation must re-anchor each descendant
    // to its predecessor's LIVE slot; a cached root index drifts and strands the
    // 2nd descendant (C2) — leaving a child before its own parent in flat order.
    const harness = createRealEditorHarness([
      { id: 'C' },
      { id: 'C1', parentId: 'C' },
      { id: 'C2', parentId: 'C' },
      { id: 'A' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.nest('C', 'A');
    });

    expect(result.current.getById('C')?.parentId).toBe('A');
    expect(result.current.getChildren('C').map((n) => n.id)).toEqual(['C1', 'C2']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    // A precedes C, and C's whole subtree sits contiguously right after it.
    expect(flat).toEqual(['A', 'C', 'C1', 'C2']);
  });

  it('unnest of a block with 2 children relocates the WHOLE subtree contiguously', () => {
    // [P, B, B1, B2] — B nested under P, with B1, B2 nested under B. unnest('B')
    // ALWAYS relocates forward (to the end of P's subtree), so it is the broadest
    // trigger of the cached-root drift: without the fix B2 is stranded.
    const harness = createRealEditorHarness([
      { id: 'P' },
      { id: 'B', parentId: 'P' },
      { id: 'B1', parentId: 'B' },
      { id: 'B2', parentId: 'B' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.unnest('B');
    });

    expect(result.current.getById('B')?.parentId).toBe(null);
    expect(result.current.getChildren('B').map((n) => n.id)).toEqual(['B1', 'B2']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    // B promoted to root with its children still contiguous behind it.
    expect(flat).toEqual(['P', 'B', 'B1', 'B2']);
  });

  it('mutators re-render the hook (insert, nest, unnest, move, remove emit "block changed")', () => {
    // The real editor emits 'block changed' on every structural mutation; the
    // harness mirrors that. Each useBlocks mutator must therefore drive a hook
    // re-render so consumers reading getById/getChildren in render stay in sync.
    const harness = createRealEditorHarness([{ id: 'a' }, { id: 'b' }]);

    workingArea = harness.workingArea;

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;

      return useBlocks(harness.editor);
    });

    const expectRerender = (run: () => void): void => {
      const before = renderCount;

      act(run);
      expect(renderCount).toBeGreaterThan(before);
    };

    expectRerender(() => result.current.insert({ type: 'paragraph' }));
    expectRerender(() => result.current.nest('b', 'a'));
    expectRerender(() => result.current.unnest('b'));
    expectRerender(() => result.current.move('b', { toIndex: 0 }));
    expectRerender(() => result.current.remove('b'));
  });

  it('root insert at document end after a column child stays at ROOT (does not inherit the trailing column)', () => {
    // Column container whose only child is the LAST block in flat order. A
    // root-level append (`insert({ position: 'end' })`, no parentId) must remain
    // a root sibling — NOT get auto-nested into the trailing column by core's
    // predecessor-inherit. The adapter must assert the intended root parent.
    const harness = createRealEditorHarness([
      { id: 'col', name: 'column' },
      { id: 'col-child', parentId: 'col' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let insertedId: string | null = null;

    act(() => {
      const created = result.current.insert({ position: 'end' });

      insertedId = created?.id ?? null;
    });

    expect(insertedId).not.toBeNull();
    // The new block is a ROOT sibling, NOT a child of the column.
    expect(result.current.getById(insertedId as unknown as string)?.parentId).toBeNull();
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['col', insertedId]);
    expect(result.current.getChildren('col').map((n) => n.id)).toEqual(['col-child']);
  });

  it('insert at a reparented container end lands after its existing children, before the next root block', () => {
    const harness = createRealEditorHarness([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.nest('C', 'A');
    });

    let insertedId: string | null = null;

    act(() => {
      const created = result.current.insert({ type: 'paragraph', parentId: 'A', position: 'end' });

      insertedId = created?.id ?? null;
    });

    // The new child must be A's LAST child and sit between C and root-sibling B.
    expect(insertedId).not.toBeNull();
    expect(result.current.getChildren('A').map((n) => n.id)).toEqual(['C', insertedId]);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['A', 'C', insertedId, 'B']);
  });

  it('nest across a column boundary is a graceful no-op (parent unchanged, tree intact)', () => {
    // [A, col(column), c1, c2] — c1/c2 live inside the column. Core's move()
    // clamps any attempt to relocate a column member next to a different-parent
    // block, so the relocation can't run. The hook must then SKIP the reparent
    // (relocation blocked) — leaving c2 a child of the column and the flat array
    // untouched — instead of corrupting DFS contiguity by reparenting in place.
    const harness = createRealEditorHarness([
      { id: 'A' },
      { id: 'col', name: 'column' },
      { id: 'c1', parentId: 'col' },
      { id: 'c2', parentId: 'col' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.nest('c2', 'A');
    });

    // c2 is still the column's child; A adopted nothing.
    expect(result.current.getById('c2')?.parentId).toBe('col');
    expect(result.current.getChildren('A')).toHaveLength(0);
    expect(result.current.getChildren('col').map((n) => n.id)).toEqual(['c1', 'c2']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['A', 'col', 'c1', 'c2']);
  });

  it('move ADOPTS the parent of the slot it lands in (parent-adoption side effect)', () => {
    // [X, col(column), c] — X is a root block. Moving X to sit after the column
    // child c lands it among the column's children, so X ADOPTS `col` as its
    // parent. This is core's flat-position auto-heal, asserted via parentId.
    const harness = createRealEditorHarness([
      { id: 'X' },
      { id: 'col', name: 'column' },
      { id: 'c', parentId: 'col' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    expect(result.current.getById('X')?.parentId).toBeNull();

    act(() => {
      result.current.move('X', { after: 'c' });
    });

    expect(result.current.getById('X')?.parentId).toBe('col');
    expect(result.current.getChildren('col').map((n) => n.id)).toContain('X');
  });

  it('move with an unknown relative ref is a no-op (does not relocate to the document end)', () => {
    const harness = createRealEditorHarness([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.move('a', { after: 'ghost' });
    });

    // Order unchanged — the unknown ref did not dump 'a' at the end.
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('convert against the real harness swaps the type, re-renders, and is NOT wrapped in transact', () => {
    const harness = createRealEditorHarness([{ id: 'a', name: 'paragraph' }]);

    workingArea = harness.workingArea;

    const transactSpy = vi.spyOn(harness.editor.blocks, 'transact');

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;

      return useBlocks(harness.editor);
    });

    const before = renderCount;

    act(() => {
      result.current.convert('a', 'header');
    });

    expect(result.current.getById('a')?.type).toBe('header');
    expect(renderCount).toBeGreaterThan(before);
    // convert owns its own async history step — it must not open a transact.
    expect(transactSpy).not.toHaveBeenCalled();
  });

  it('update against the real harness re-renders and is NOT wrapped in transact', () => {
    const harness = createRealEditorHarness([{ id: 'a' }]);

    workingArea = harness.workingArea;

    const transactSpy = vi.spyOn(harness.editor.blocks, 'transact');

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;

      return useBlocks(harness.editor);
    });

    const before = renderCount;

    act(() => {
      result.current.update('a', { text: 'updated' });
    });

    expect(renderCount).toBeGreaterThan(before);
    // update delegates to core's async update — no synchronous transact wrapper.
    expect(transactSpy).not.toHaveBeenCalled();
  });
});
