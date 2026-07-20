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
import { useBlocks } from '../../../packages/react/src/useBlocks';
import type { BlockNode } from '../../../packages/react/src/blocks-snapshot';
import { ToolNotFoundError } from '../../../src/components/errors/tool-not-found';
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
  /** Read the raw `data` stored on a seeded/inserted block (not exposed on BlockNode). */
  getBlockData: (id: string) => { text?: string; level?: number } | undefined;
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
    blocksStore.push(createBlockStub(cfg));
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
      index?: number,
      _needToFocus?: boolean,
      replace?: boolean,
      explicitId?: string
    ): { id: string; name: string; parentId: string | null } => {
      insertSeq += 1;
      // Faithful to core: an explicit id (7th positional arg) is honored when
      // present, otherwise core generates one. Lets a batch spec reference an
      // earlier-created block by a stable id.
      const id = explicitId ?? `inserted-${insertSeq}`;
      const stub = createBlockStub({ id, name: type ?? 'paragraph' });
      const insertAt =
        index !== undefined ? Math.min(index, blocksStore.length) : blocksStore.length;

      // Faithful to core block-insertion.ts replace path: a replace overwrites the
      // block AT the target index, capturing its children BEFORE it leaves the
      // store so they can be RE-HOMED onto the new block (reparentChildrenTo) — a
      // replaced container (toggle/callout) must not orphan its descendants. The
      // replaced block's OWN parent link is reasserted by useBlocks afterwards.
      if (replace === true) {
        const replaced = blocksStore.array[insertAt];
        const childIds =
          replaced !== undefined
            ? blocksStore.array.filter((b) => b.parentId === replaced.id).map((b) => b.id)
            : [];

        if (replaced !== undefined) {
          blocksStore.remove(insertAt);
        }
        blocksStore.insert(insertAt, stub);

        const reparentChildrenTo = (ids: string[], newParentId: string): void => {
          for (const childId of ids) {
            const child = blocksStore.array.find((b) => b.id === childId);

            if (child !== undefined) {
              hierarchy.setBlockParent(child, newParentId);
            }
          }
        };

        reparentChildrenTo(childIds, stub.id);

        notify();

        return { id: stub.id, name: stub.name, parentId: stub.parentId };
      }

      blocksStore.insert(insertAt, stub);

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
        hierarchy.setBlockParent(stub, predecessorParent.id);
      }

      notify();

      return { id: stub.id, name: stub.name, parentId: stub.parentId };
    },

    /**
     * Faithful to core's public `blocks.insertMany(blocks, index)`: composes a
     * block per OutputBlockData entry (honoring its `id`, `type`, `data`, and
     * `parent`/`content` links), splices them CONTIGUOUSLY into the real store
     * starting at the clamped flat `index`, and returns a BlockAPI-like `{ id }[]`.
     * The input array is DFS pre-order, so contiguous insertion keeps a subtree
     * contiguous in the flat document order. A `parent` link is applied through
     * the REAL BlockHierarchy so the parent's contentIds stay in sync (parents in
     * the same batch sit before their children, so the lookup resolves).
     */
    insertMany: (
      blocks: ReadonlyArray<{
        id?: string;
        type?: string;
        data?: unknown;
        parent?: string | null;
        content?: string[];
      }>,
      index?: number
    ): Array<{ id: string }> => {
      const startAt =
        index !== undefined
          ? Math.min(Math.max(index, 0), blocksStore.length)
          : blocksStore.length;

      const created = blocks.map((cfg, offset) => {
        insertSeq += 1;
        const id = cfg.id ?? `inserted-${insertSeq}`;
        const stub = createBlockStub({ id, name: cfg.type ?? 'paragraph', parentId: null });

        (stub as unknown as { data: unknown }).data = cfg.data;
        blocksStore.insert(startAt + offset, stub);

        if (cfg.parent !== null && cfg.parent !== undefined) {
          hierarchy.setBlockParent(stub, cfg.parent);
        }

        return { id };
      });

      notify();

      return created;
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
    //      pre-removal array, as core does). This routes through the REAL
    //      BlockHierarchy.setBlockParent, which THROWS on a parent/child cycle
    //      exactly as core does — and core's block-mutation.move wraps the heal
    //      in try/finally with NO catch, so the throw propagates to the caller.
    //      The harness must mirror that faithfully: it must NOT pre-empt or
    //      swallow the cycle throw, or it would mask a real production crash in
    //      useBlocks' subtree relocation (a move whose neighbour is one of the
    //      moved block's own descendants → setBlockParent(B, B)).
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

      // (2) Cross-container auto-heal — faithful to core block-mutation.ts:
      // routes through the REAL BlockHierarchy.setBlockParent, which THROWS on a
      // cycle (and core does not catch it). No pre-check: the harness surfaces
      // the same throw real core would (see method doc).
      if (movingBlock !== undefined && movingBlock.parentId !== destinationParentId) {
        hierarchy.setBlockParent(movingBlock, destinationParentId);
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
     * Faithful to core's Blocks.convert — routes through replace(), which REMOVES
     * the old block and inserts a fresh one under a BRAND-NEW id. Returns the new
     * BlockAPI-like `{ id }` (the resolved id the caret repositioning depends on)
     * and notifies. Keeping the old id would mask the stale-id caret bug.
     */
    convert: async (
      id: string,
      newType: string,
      _dataOverrides?: unknown
    ): Promise<{ id: string; name: string; parentId: string | null } | undefined> => {
      const idx = blocksStore.array.findIndex((b) => b.id === id);

      if (idx === -1) {
        await Promise.resolve();

        return undefined;
      }
      insertSeq += 1;
      const newId = `converted-${insertSeq}`;
      const parentId = blocksStore.array[idx].parentId;

      blocksStore.remove(idx);
      const stub = createBlockStub({ id: newId, name: newType, parentId });

      blocksStore.insert(idx, stub);
      notify();
      await Promise.resolve();

      return { id: newId, name: newType, parentId };
    },

    /**
     * Faithful to core's Blocks.splitBlock: ATOMICALLY (one transact) updates the
     * current block's data (truncated content) and inserts a fresh block at
     * `insertIndex` (extracted content). Returns the new BlockAPI-like `{ id }`
     * and notifies once.
     */
    splitBlock: (
      currentBlockId: string,
      currentBlockData: unknown,
      newBlockType: string,
      newBlockData: unknown,
      insertIndex: number
    ): { id: string; name: string; parentId: string | null } => {
      const current = blocksStore.array.find((b) => b.id === currentBlockId);

      if (current !== undefined) {
        (current as unknown as { data: unknown }).data = currentBlockData;
      }
      insertSeq += 1;
      const newId = `split-${insertSeq}`;
      const stub = createBlockStub({ id: newId, name: newBlockType, parentId: null });

      (stub as unknown as { data: unknown }).data = newBlockData;
      blocksStore.insert(Math.min(Math.max(insertIndex, 0), blocksStore.length), stub);
      notify();

      return { id: newId, name: newBlockType, parentId: null };
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

  const getBlockData = (id: string): { text?: string; level?: number } | undefined => {
    const block = blocksStore.array.find((b) => b.id === id);

    return block === undefined
      ? undefined
      : ((block as unknown as { data?: { text?: string; level?: number } }).data ?? undefined);
  };

  return { editor, workingArea, getBlockData };
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

  it('insertMany resolves a later spec position against a block created EARLIER in the same batch', () => {
    // The second spec's `{ after: 'first' }` references a block that only comes
    // into existence one step earlier in the SAME batch. Each spec runs through
    // the live index model inside one shared transact, so the relative position
    // must resolve against the just-created 'first' — landing the second block
    // immediately after it, not at a stale slot.
    const harness = createRealEditorHarness([{ id: 'root' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let created: ReturnType<typeof result.current.insertMany> = [];

    act(() => {
      created = result.current.insertMany([
        { id: 'first', type: 'header' },
        { type: 'paragraph', position: { after: 'first' } },
      ]);
    });

    expect(created).toHaveLength(2);
    expect(created[0].id).toBe('first');

    const secondId = created[1].id;

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    // The batch's second block sits directly after the batch's first block.
    expect(flat).toEqual(['root', 'first', secondId]);
    expect(flat.indexOf(secondId)).toBe(flat.indexOf('first') + 1);
  });

  it('root insert with position "start" lands the new block at the document head', () => {
    // Root `position: 'start'` resolves to flat index 0 end-to-end through
    // insert() — the new block becomes the FIRST root sibling, ahead of the
    // existing blocks, and stays at root (parentId null).
    const harness = createRealEditorHarness([{ id: 'a' }, { id: 'b' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let insertedId: string | null = null;

    act(() => {
      const node = result.current.insert({ type: 'header', position: 'start' });

      insertedId = node?.id ?? null;
    });

    expect(insertedId).not.toBeNull();
    expect(result.current.getById(insertedId as unknown as string)?.parentId).toBeNull();
    // New block is the first root sibling, ahead of the pre-existing a, b.
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual([insertedId, 'a', 'b']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual([insertedId, 'a', 'b']);
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

  it('re-nesting a block-with-child into its CURRENT parent is a graceful no-op (nest skip path)', () => {
    // [P(toggle), X⊂P, X1⊂X] — X is already P's (only, last) child and has its own
    // child X1. nest('X','P') resolves the destination to the end of P's subtree,
    // which already IS X's own footprint → relocateSubtree returns 'skipped' (no
    // physical move). nest must still reparent gracefully (X stays under P, X1
    // under X) and leave the subtree intact — exercising nest's 'skipped' branch.
    const harness = createRealEditorHarness([
      { id: 'P', name: 'toggle' },
      { id: 'X', parentId: 'P' },
      { id: 'X1', parentId: 'X' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.nest('X', 'P');
    });

    expect(result.current.getById('X')?.parentId).toBe('P');
    expect(result.current.getChildren('X').map((n) => n.id)).toEqual(['X1']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['P', 'X', 'X1']);
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

  it('turn-into (replace) of a container re-homes its children onto the replacement', () => {
    // [P(toggle), c1⊂P, c2⊂P, tail]. A replace of P ("turn into") overwrites P at
    // its own slot; core's reparentChildrenTo re-homes P's children onto the new
    // block so they are NOT orphaned. useBlocks must forward replace=true and
    // preserve P's (root) parent on the replacement WITHOUT stranding c1/c2.
    const harness = createRealEditorHarness([
      { id: 'P', name: 'toggle' },
      { id: 'c1', parentId: 'P' },
      { id: 'c2', parentId: 'P' },
      { id: 'tail' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let newId: string | null = null;

    act(() => {
      const created = result.current.insert({ type: 'header', position: { before: 'P' }, replace: true });

      newId = created?.id ?? null;
    });

    expect(newId).not.toBeNull();
    const replacementId = newId as unknown as string;

    // The replacement is a header at root, and P's children moved onto it.
    expect(result.current.getById(replacementId)?.type).toBe('header');
    expect(result.current.getById(replacementId)?.parentId).toBeNull();
    expect(result.current.getChildren(replacementId).map((n) => n.id)).toEqual(['c1', 'c2']);
    // P is gone; the replacement and tail are the root blocks.
    expect(result.current.getById('P')).toBeNull();
    expect(result.current.getChildren(null).map((n) => n.id)).toEqual([replacementId, 'tail']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual([replacementId, 'c1', 'c2', 'tail']);
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

  it('nest INTO a column is a graceful no-op (column membership is drag-UI only)', () => {
    // [A, col(column), c1] — nesting the ROOT block A INTO the column must be a
    // no-op: column membership is owned by the drag UI. Critically, A is NOT a
    // column member, so core's column-boundary clamp never fires (it only clamps
    // a block ALREADY in a column) — the relocation would SUCCEED and leak A into
    // the column. Only the explicit `getById(parentId)?.type === 'column'` guard
    // stops it. This pins that half of nest's column guard, which the
    // blocked-relocation detection cannot cover.
    const harness = createRealEditorHarness([
      { id: 'A' },
      { id: 'col', name: 'column' },
      { id: 'c1', parentId: 'col' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.nest('A', 'col');
    });

    // A stayed at root; the column is untouched.
    expect(result.current.getById('A')?.parentId).toBeNull();
    expect(result.current.getChildren('col').map((n) => n.id)).toEqual(['c1']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['A', 'col', 'c1']);
  });

  it('unnest of a column child is a graceful no-op (stays in the column, tree intact)', () => {
    // Mirror of the nest column test: a `column` member is detached only via the
    // drag UI, so unnest('c2') must leave c2 a child of the column and the flat
    // array untouched — NOT promote it to root.
    const harness = createRealEditorHarness([
      { id: 'A' },
      { id: 'col', name: 'column' },
      { id: 'c1', parentId: 'col' },
      { id: 'c2', parentId: 'col' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.unnest('c2');
    });

    // c2 is still the column's child; nothing was promoted to root.
    expect(result.current.getById('c2')?.parentId).toBe('col');
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

  it('move of a parent carries its indent descendants and keeps the subtree contiguous', () => {
    // [P(toggle), c1, c2, X] with c1/c2 parentId-nested under P. Core's single
    // move() only carries DOM-contained descendants (resortNestedBlocks); indent
    // (parentId-only) children are NOT carried — so a naive one-shot move of P
    // would strand c1/c2 BEFORE P, breaking DFS contiguity (children precede
    // their parent in flat order) and corrupting saved document order. move()
    // must relocate the WHOLE subtree: after `move('P', { after: 'X' })` the flat
    // order is [X, P, c1, c2] with c1/c2 still children of P.
    const harness = createRealEditorHarness([
      { id: 'P', name: 'toggle' },
      { id: 'c1', parentId: 'P' },
      { id: 'c2', parentId: 'P' },
      { id: 'X' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.move('P', { after: 'X' });
    });

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['X', 'P', 'c1', 'c2']);
    expect(result.current.getById('P')?.parentId).toBeNull();
    expect(result.current.getChildren('P').map((n) => n.id)).toEqual(['c1', 'c2']);
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

  it('move of a subtree to before the block right after it STILL adopts the new parent (skip-path heal)', () => {
    // [P(toggle), id⊂P, k⊂id, X(root)] — id's subtree [id,k] already abuts X, so
    // relocateSubtree hits its self-overlap guard and skips the physical move.
    // But `move`'s parent-adoption contract still applies: moving id `before` the
    // root block X must make id a ROOT sibling (adopt X's parent = null). The skip
    // path must NOT silently leave id under P — that would make the SAME call
    // produce different trees depending only on whether an unrelated block happens
    // to sit between id's subtree and X (see the CONTROL case below).
    const harness = createRealEditorHarness([
      { id: 'P', name: 'toggle' },
      { id: 'id', parentId: 'P' },
      { id: 'k', parentId: 'id' },
      { id: 'X' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.move('id', { before: 'X' });
    });

    // id adopted X's (root) parent; k stays id's child; flat order unchanged.
    expect(result.current.getById('id')?.parentId).toBeNull();
    expect(result.current.getChildren('P')).toHaveLength(0);
    expect(result.current.getChildren('id').map((n) => n.id)).toEqual(['k']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['P', 'id', 'k', 'X']);
  });

  it('move of a subtree before X is CONSISTENT whether or not an unrelated block sits between (control)', () => {
    // Same as above but with Y wedged between k and X, so the relocation is NOT a
    // skip — the real move runs and core auto-heals. The OUTCOME for id must be
    // identical to the skip-path case: id adopts root. This pins the consistency
    // the skip-path heal restores.
    const harness = createRealEditorHarness([
      { id: 'P', name: 'toggle' },
      { id: 'id', parentId: 'P' },
      { id: 'k', parentId: 'id' },
      { id: 'Y' },
      { id: 'X' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.move('id', { before: 'X' });
    });

    // Identical id outcome to the skip-path case: id is a root block, k its child.
    expect(result.current.getById('id')?.parentId).toBeNull();
    expect(result.current.getChildren('id').map((n) => n.id)).toEqual(['k']);
  });

  it('move a subtree AFTER a ref that itself has descendants makes it the ref SIBLING, not its child', () => {
    // [id(toggle), idc⊂id, X(toggle), Xc⊂X] — move id AFTER X. resolveMoveIndex
    // clears X's whole subtree, so id lands AFTER Xc at ROOT level → id is X's
    // SIBLING and must adopt X's parent (null). Core's auto-heal would instead
    // read the landing-slot neighbour (Xc, whose parent is X) and nest id UNDER X
    // — position says sibling, parent says child. move() must adopt the ref's
    // parent so position and parent agree (and so this matches the skip-path heal).
    const harness = createRealEditorHarness([
      { id: 'id', name: 'toggle' },
      { id: 'idc', parentId: 'id' },
      { id: 'X', name: 'toggle' },
      { id: 'Xc', parentId: 'X' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.move('id', { after: 'X' });
    });

    expect(result.current.getById('id')?.parentId).toBeNull();
    expect(result.current.getChildren('id').map((n) => n.id)).toEqual(['idc']);
    expect(result.current.getChildren('X').map((n) => n.id)).toEqual(['Xc']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['X', 'Xc', 'id', 'idc']);
  });

  it('move a subtree BEFORE a ref nested in a container adopts that container (sibling-of-ref)', () => {
    // [id(toggle), idc⊂id, C(toggle), X⊂C] — move id BEFORE X. id lands at X's
    // slot INSIDE C → id is X's sibling within C and must adopt C. Core's auto-heal
    // would read the block before X's slot (C itself, parent null) and leave id at
    // root — position inside C, parent root. move() must adopt the ref's parent.
    const harness = createRealEditorHarness([
      { id: 'id', name: 'toggle' },
      { id: 'idc', parentId: 'id' },
      { id: 'C', name: 'toggle' },
      { id: 'X', parentId: 'C' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.move('id', { before: 'X' });
    });

    expect(result.current.getById('id')?.parentId).toBe('C');
    expect(result.current.getChildren('id').map((n) => n.id)).toEqual(['idc']);

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['C', 'id', 'idc', 'X']);
  });

  it('move a LEAF after a ref that has descendants makes it the ref SIBLING, not its child', () => {
    // The same sibling-of-ref rule must hold for the single-block (leaf) path:
    // [L, X(toggle), Xc⊂X] — move L AFTER X lands L after Xc at root → L is X's
    // sibling, adopts X's parent (null), NOT X (which the landing-slot auto-heal
    // would give since the neighbour Xc's parent is X).
    const harness = createRealEditorHarness([
      { id: 'L' },
      { id: 'X', name: 'toggle' },
      { id: 'Xc', parentId: 'X' },
    ]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.move('L', { after: 'X' });
    });

    expect(result.current.getById('L')?.parentId).toBeNull();

    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['X', 'Xc', 'L']);
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

    // Convert recreates the block under a fresh id, so the original is gone and
    // the surviving block at index 0 carries the new type.
    expect(result.current.getById('a')).toBeNull();
    expect(result.current.getBlockByIndex(0)?.type).toBe('header');
    expect(renderCount).toBeGreaterThan(before);
    // convert owns its own async history step — it must not open a transact.
    expect(transactSpy).not.toHaveBeenCalled();
  });

  it('insertTree inserts a two-level subtree: root + nested child', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let rootId: string | null = null;

    act(() => {
      const root = result.current.insertTree({
        type: 'header',
        children: [{ type: 'paragraph' }],
      });

      rootId = root?.id ?? null;
    });

    expect(rootId).not.toBeNull();

    const children = result.current.getChildren(rootId);

    expect(children).toHaveLength(1);
    expect(children[0].parentId).toBe(rootId);
    expect(children[0].type).toBe('paragraph');
    expect(result.current.getById(rootId as unknown as string)?.type).toBe('header');
  });

  it('insertTree preserves a three-level deep nesting chain', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let rootId: string | null = null;

    act(() => {
      const root = result.current.insertTree({
        type: 'header',
        children: [{ type: 'paragraph', children: [{ type: 'paragraph' }] }],
      });

      rootId = root?.id ?? null;
    });

    expect(rootId).not.toBeNull();

    const level1 = result.current.getChildren(rootId);

    expect(level1).toHaveLength(1);

    const level2 = result.current.getChildren(level1[0].id);

    expect(level2).toHaveLength(1);
    expect(level2[0].parentId).toBe(level1[0].id);

    // Flat document order is DFS pre-order: root, child, grandchild — contiguous
    // after the pre-existing anchor block.
    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['anchor', rootId, level1[0].id, level2[0].id]);
  });

  it('insertTree inserts the whole subtree in a SINGLE transaction (one undo step)', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    const transactSpy = vi.spyOn(harness.editor.blocks, 'transact');

    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.insertTree({
        type: 'header',
        children: [{ type: 'paragraph' }, { type: 'paragraph' }],
      });
    });

    // A single transact wraps the entire subtree insert → one atomic undo step.
    expect(transactSpy).toHaveBeenCalledTimes(1);
  });

  it('insertTree with parentId nests the whole subtree under an existing block', () => {
    const harness = createRealEditorHarness([{ id: 'container' }, { id: 'tail' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let rootId: string | null = null;

    act(() => {
      const root = result.current.insertTree({
        type: 'paragraph',
        parentId: 'container',
        children: [{ type: 'paragraph' }],
      });

      rootId = root?.id ?? null;
    });

    expect(rootId).not.toBeNull();
    expect(result.current.getById(rootId as unknown as string)?.parentId).toBe('container');
    expect(result.current.getChildren('container').map((n) => n.id)).toEqual([rootId]);

    const grandchildren = result.current.getChildren(rootId);

    expect(grandchildren).toHaveLength(1);

    // The subtree sits between the container and the next root sibling.
    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['container', rootId, grandchildren[0].id, 'tail']);
  });

  it('insertTree returns the root BlockNode', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let rootType: string | undefined;
    let rootParent: string | null | undefined;

    act(() => {
      const root = result.current.insertTree({ type: 'header', children: [{ type: 'paragraph' }] });

      rootType = root?.type;
      rootParent = root?.parentId;
    });

    expect(rootType).toBe('header');
    expect(rootParent).toBeNull();
  });

  it('insertTree with a dangling parentId returns null and inserts nothing', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    const countBefore = harness.editor.blocks.getBlocksCount();

    let root: ReturnType<typeof result.current.insertTree> = null;

    act(() => {
      root = result.current.insertTree({
        type: 'paragraph',
        parentId: 'ghost',
        children: [{ type: 'paragraph' }],
      });
    });

    expect(root).toBeNull();
    expect(harness.editor.blocks.getBlocksCount()).toBe(countBefore);
  });

  it('insertTree returns null (does not throw) when a node tool type is unknown', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    // Core's insertMany maps composeBlock over every node and THROWS a typed
    // ToolNotFoundError on the first unknown tool. insertTree must honor the same
    // null-on-unknown contract as insert/insertMany, not surface the throw.
    vi.spyOn(harness.editor.blocks, 'insertMany').mockImplementationOnce(() => {
      throw new ToolNotFoundError('nope', 'Could not compose Block. Tool «nope» not found.');
    });

    const countBefore = harness.editor.blocks.getBlocksCount();
    const { result } = renderHook(() => useBlocks(harness.editor));

    let root: ReturnType<typeof result.current.insertTree> = null;
    let threw = false;

    act(() => {
      try {
        root = result.current.insertTree({ type: 'header', children: [{ type: 'nope' }] });
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    expect(root).toBeNull();
    expect(harness.editor.blocks.getBlocksCount()).toBe(countBefore);
  });

  it('insertTree re-throws an UNEXPECTED core error instead of masking it as null', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    vi.spyOn(harness.editor.blocks, 'insertMany').mockImplementationOnce(() => {
      throw new Error('kaboom: unexpected core failure');
    });

    const { result } = renderHook(() => useBlocks(harness.editor));

    let threw = false;

    act(() => {
      try {
        result.current.insertTree({ type: 'header' });
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(true);
  });

  it('insertTree with a colliding explicit id returns null and inserts nothing', () => {
    const harness = createRealEditorHarness([{ id: 'dup' }]);

    workingArea = harness.workingArea;

    const insertManySpy = vi.spyOn(harness.editor.blocks, 'insertMany');
    const countBefore = harness.editor.blocks.getBlocksCount();
    const { result } = renderHook(() => useBlocks(harness.editor));

    let root: ReturnType<typeof result.current.insertTree> = null;

    act(() => {
      root = result.current.insertTree({ id: 'dup', type: 'header', children: [{ type: 'paragraph' }] });
    });

    expect(root).toBeNull();
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(harness.editor.blocks.getBlocksCount()).toBe(countBefore);
  });

  it('insertTree REJECTS a within-spec duplicate id (two nodes share an id, none pre-existing)', () => {
    // The collision guard must catch an id reused by ANOTHER node in the SAME
    // spec, not only one already in the document. Two nodes both { id: 'x' } with
    // no pre-existing 'x' → nothing inserted, returns null.
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    const insertManySpy = vi.spyOn(harness.editor.blocks, 'insertMany');
    const countBefore = harness.editor.blocks.getBlocksCount();
    const { result } = renderHook(() => useBlocks(harness.editor));

    let root: ReturnType<typeof result.current.insertTree> = null;

    act(() => {
      root = result.current.insertTree({
        id: 'x',
        type: 'header',
        children: [{ id: 'x', type: 'paragraph' }],
      });
    });

    expect(root).toBeNull();
    expect(insertManySpy).not.toHaveBeenCalled();
    expect(harness.editor.blocks.getBlocksCount()).toBe(countBefore);
  });

  it('insertTree honors an explicit root position (before an existing block)', () => {
    // [a, b] then insertTree({ position: { before: 'b' } }) lands the WHOLE
    // subtree at b's slot, so the flat order is [a, root, child, b].
    const harness = createRealEditorHarness([{ id: 'a' }, { id: 'b' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let rootId: string | undefined;

    act(() => {
      const root = result.current.insertTree({
        type: 'header',
        position: { before: 'b' },
        children: [{ type: 'paragraph' }],
      });

      rootId = root?.id;
    });

    expect(rootId).toBeDefined();

    const childId = result.current.getChildren(rootId as string)[0]?.id;
    const flat: string[] = [];

    for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
      const node = harness.editor.blocks.getBlockByIndex(i);

      if (node !== undefined) {
        flat.push(node.id);
      }
    }
    expect(flat).toEqual(['a', rootId, childId, 'b']);
  });

  it('insertTree IGNORES a nested child placement (parentId/position) — child nests under its enclosing node', () => {
    // A child node may carry parentId/position (TreeInsertSpec allows them on
    // every node) but they are ROOT-ONLY: a child is always nested under its
    // enclosing node, regardless of those fields.
    const harness = createRealEditorHarness([{ id: 'a' }]);

    workingArea = harness.workingArea;

    const { result } = renderHook(() => useBlocks(harness.editor));

    let rootId: string | undefined;
    let childId: string | undefined;

    act(() => {
      const root = result.current.insertTree({
        type: 'header',
        children: [{ type: 'paragraph', parentId: 'a', position: 'start' }],
      });

      rootId = root?.id;
      childId = result.current.getChildren(rootId as string)[0]?.id;
    });

    // The child ignored parentId:'a'/position:'start' — it is nested under root.
    expect(childId).toBeDefined();
    expect(result.current.getById(childId as string)?.parentId).toBe(rootId);
    expect(result.current.getChildren('a')).toHaveLength(0);
  });

  it('insertTree propagates tunes onto the flattened blocks', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    const insertManySpy = vi.spyOn(harness.editor.blocks, 'insertMany');
    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.insertTree({
        type: 'header',
        tunes: { align: { alignment: 'center' } },
        children: [{ type: 'paragraph', tunes: { align: { alignment: 'right' } } }],
      });
    });

    const flat = insertManySpy.mock.calls[0][0] as Array<{ type?: string; tunes?: unknown }>;

    expect(flat[0].tunes).toEqual({ align: { alignment: 'center' } });
    expect(flat[1].tunes).toEqual({ align: { alignment: 'right' } });
  });

  it('insertTree stamps an empty content array for a childless leaf', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    const insertManySpy = vi.spyOn(harness.editor.blocks, 'insertMany');
    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.insertTree({ type: 'header', children: [{ type: 'paragraph', children: [] }] });
    });

    const flat = insertManySpy.mock.calls[0][0] as Array<{ content?: string[] }>;

    // root has one child id; the leaf has an empty content array.
    expect(flat[0].content).toHaveLength(1);
    expect(flat[1].content).toEqual([]);
  });

  it('insertTree omits the type key for a typeless node (core falls back to its default block)', () => {
    const harness = createRealEditorHarness([{ id: 'anchor' }]);

    workingArea = harness.workingArea;

    const insertManySpy = vi.spyOn(harness.editor.blocks, 'insertMany');
    const { result } = renderHook(() => useBlocks(harness.editor));

    act(() => {
      result.current.insertTree({ children: [{ type: 'paragraph' }] });
    });

    const flat = insertManySpy.mock.calls[0][0] as unknown as Array<Record<string, unknown>>;

    // The comment promises the field is OMITTED (not present-with-undefined) so
    // core's `type || defaultBlock` fallback kicks in cleanly.
    expect('type' in flat[0]).toBe(false);
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

  it('splitBlock against the real harness truncates the current block, inserts the new one, and re-renders', () => {
    const harness = createRealEditorHarness([{ id: 'a' }, { id: 'b' }]);

    workingArea = harness.workingArea;

    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;

      return useBlocks(harness.editor);
    });

    const before = renderCount;
    // Object-property holder defeats control-flow narrowing of an in-closure assign.
    const captured: { node: BlockNode | null } = { node: null };

    act(() => {
      captured.node = result.current.splitBlock('a', { text: 'he' }, 'paragraph', { text: 'llo' }, 1);
    });

    // The new block is created and returned as a live snapshot node...
    expect(captured.node).not.toBeNull();
    expect(captured.node?.type).toBe('paragraph');
    // ...the current block keeps its truncated data, the new block its extracted data...
    expect(harness.getBlockData('a')?.text).toBe('he');
    expect(harness.getBlockData(captured.node?.id ?? '')?.text).toBe('llo');
    // ...the new block lands at the requested flat slot (between 'a' and 'b')...
    expect(result.current.getBlockByIndex(1)?.id).toBe(captured.node?.id);
    // ...and the structural mutation re-renders reactive consumers.
    expect(renderCount).toBeGreaterThan(before);
  });

  describe('insertMarkdown — additive markdown → blocks', () => {
    it('converts markdown and inserts the blocks additively at the document end', async () => {
      const harness = createRealEditorHarness([{ id: 'seed' }]);

      workingArea = harness.workingArea;

      const { result } = renderHook(() => useBlocks(harness.editor));

      let created: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [];

      await act(async () => {
        created = await result.current.insertMarkdown('# Hello\n\nWorld');
      });

      // The pre-existing block is NOT cleared (additive, unlike core importMarkdown).
      expect(result.current.getById('seed')).not.toBeNull();

      // A header('Hello') followed by a paragraph('World').
      expect(created.map((n) => n.type)).toEqual(['header', 'paragraph']);
      expect(harness.getBlockData(created[0].id)?.text).toBe('Hello');
      expect(harness.getBlockData(created[0].id)?.level).toBe(1);
      expect(harness.getBlockData(created[1].id)?.text).toBe('World');

      // Appended after the seed, at root, in order.
      expect(result.current.getChildren(null).map((n) => n.id)).toEqual([
        'seed',
        created[0].id,
        created[1].id,
      ]);
    });

    it('returns the created BlockNodes (length, ids, types)', async () => {
      const harness = createRealEditorHarness([]);

      workingArea = harness.workingArea;

      const { result } = renderHook(() => useBlocks(harness.editor));

      let created: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [];

      await act(async () => {
        created = await result.current.insertMarkdown('# Title\n\nBody');
      });

      expect(created).toHaveLength(2);
      expect(created.map((n) => n.type)).toEqual(['header', 'paragraph']);
      // Each returned node is a live snapshot view, re-readable by id.
      expect(created.map((n) => result.current.getById(n.id)?.id)).toEqual(created.map((n) => n.id));
    });

    it('is atomic — the whole batch flows through a single transact', async () => {
      const harness = createRealEditorHarness([]);

      workingArea = harness.workingArea;

      const transactSpy = vi.spyOn(harness.editor.blocks, 'transact');
      const insertManySpy = vi.spyOn(harness.editor.blocks, 'insertMany');

      const { result } = renderHook(() => useBlocks(harness.editor));

      await act(async () => {
        await result.current.insertMarkdown('# A\n\nB\n\nC');
      });

      expect(transactSpy).toHaveBeenCalledTimes(1);
      // insertMany runs inside the transact (one undo step for the whole import).
      expect(insertManySpy).toHaveBeenCalledTimes(1);
    });

    it('position: { after } and "start" place the blocks at the right root slot', async () => {
      const harness = createRealEditorHarness([{ id: 'one' }, { id: 'two' }]);

      workingArea = harness.workingArea;

      const { result } = renderHook(() => useBlocks(harness.editor));

      let afterCreated: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [];

      await act(async () => {
        afterCreated = await result.current.insertMarkdown('# Mid', { position: { after: 'one' } });
      });

      expect(result.current.getChildren(null).map((n) => n.id)).toEqual([
        'one',
        afterCreated[0].id,
        'two',
      ]);

      let startCreated: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [];

      await act(async () => {
        startCreated = await result.current.insertMarkdown('# Head', { position: 'start' });
      });

      expect(result.current.getChildren(null)[0].id).toBe(startCreated[0].id);
    });

    it('empty / whitespace markdown returns [] and opens no transaction', async () => {
      const harness = createRealEditorHarness([{ id: 'seed' }]);

      workingArea = harness.workingArea;

      const transactSpy = vi.spyOn(harness.editor.blocks, 'transact');
      const insertManySpy = vi.spyOn(harness.editor.blocks, 'insertMany');

      const { result } = renderHook(() => useBlocks(harness.editor));

      let created: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [{
        id: 'x',
        type: 'paragraph',
        parentId: null,
        contentIds: [],
      }];

      await act(async () => {
        created = await result.current.insertMarkdown('   \n  ');
      });

      expect(created).toEqual([]);
      expect(transactSpy).not.toHaveBeenCalled();
      expect(insertManySpy).not.toHaveBeenCalled();
      // The seed is untouched.
      expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['seed']);
    });

    it('a dangling parentId is a no-op (returns [], opens no transaction)', async () => {
      const harness = createRealEditorHarness([{ id: 'seed' }]);

      workingArea = harness.workingArea;

      const transactSpy = vi.spyOn(harness.editor.blocks, 'transact');

      const { result } = renderHook(() => useBlocks(harness.editor));

      let created: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [];

      await act(async () => {
        created = await result.current.insertMarkdown('# X', { parentId: 'ghost' });
      });

      expect(created).toEqual([]);
      expect(transactSpy).not.toHaveBeenCalled();
      expect(result.current.getChildren(null).map((n) => n.id)).toEqual(['seed']);
    });

    it('parentId nests the converted blocks under the container as contiguous children', async () => {
      const harness = createRealEditorHarness([{ id: 'container' }, { id: 'tail' }]);

      workingArea = harness.workingArea;

      const { result } = renderHook(() => useBlocks(harness.editor));

      let created: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [];

      await act(async () => {
        created = await result.current.insertMarkdown('# Hello\n\nWorld', { parentId: 'container' });
      });

      // Both top-level blocks land under the container, in order.
      expect(result.current.getChildren('container').map((n) => n.id)).toEqual(
        created.map((n) => n.id)
      );
      expect(created.every((n) => n.parentId === 'container')).toBe(true);

      // Contiguous after the container, before the next root block.
      const flat: string[] = [];

      for (let i = 0; i < harness.editor.blocks.getBlocksCount(); i++) {
        const node = harness.editor.blocks.getBlockByIndex(i);

        if (node !== undefined) {
          flat.push(node.id);
        }
      }
      expect(flat).toEqual(['container', created[0].id, created[1].id, 'tail']);
    });

    it('nesting markdown with INTERNAL structure (a table) under a parentId reparents only the top level', async () => {
      const harness = createRealEditorHarness([{ id: 'container', name: 'toggle' }]);

      workingArea = harness.workingArea;

      const { result } = renderHook(() => useBlocks(harness.editor));

      let created: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [];

      // A GFM table converts to a top-level table block whose cell children carry
      // an INTERNAL `parent` (the table id). The parentId seeding must reparent
      // only the top-level table onto the container and leave the cells pointing
      // at the table — otherwise the table's internal structure is flattened.
      await act(async () => {
        created = await result.current.insertMarkdown('| a | b |\n|---|---|\n| c | d |', {
          parentId: 'container',
        });
      });

      // The top-level table sits under the container.
      const topLevel = created.filter((n) => n.parentId === 'container');

      expect(topLevel).toHaveLength(1);

      const tableId = topLevel[0].id;

      // At least one converted block keeps an internal parent (the table), NOT
      // reparented to the container — the internal-structure-preservation branch.
      const internalChildren = created.filter((n) => n.parentId === tableId);

      expect(internalChildren.length).toBeGreaterThan(0);
      expect(internalChildren.every((n) => n.parentId !== 'container')).toBe(true);
    });

    it('forwards config to the REAL converter end-to-end (gfm:false disables table parsing)', async () => {
      const harness = createRealEditorHarness([{ id: 'seed' }]);

      workingArea = harness.workingArea;

      const { result } = renderHook(() => useBlocks(harness.editor));
      const table = '| a | b |\n|---|---|\n| c | d |';

      // Uses the REAL markdown converter (not a mock): proves the config bag is
      // actually wired through to markdownToBlocks AND honored. With GFM on
      // (default) the pipes parse to a `table` block; with gfm:false they are
      // plain text, so no table block is produced.
      let withGfm: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [];

      await act(async () => {
        withGfm = await result.current.insertMarkdown(table);
      });

      expect(withGfm.some((n) => n.type === 'table')).toBe(true);

      let withoutGfm: Awaited<ReturnType<typeof result.current.insertMarkdown>> = [];

      await act(async () => {
        withoutGfm = await result.current.insertMarkdown(table, { config: { gfm: false } });
      });

      expect(withoutGfm.some((n) => n.type === 'table')).toBe(false);
      expect(withoutGfm.every((n) => n.type === 'paragraph')).toBe(true);
    });
  });
});
