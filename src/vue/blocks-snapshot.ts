// src/vue/blocks-snapshot.ts
//
// The block-tree data types and pure flat-index resolvers are framework-agnostic
// and live in the shared core module (`components/utils/blocks-tree`). This file
// re-exports the data shapes the Vue adapter needs and declares the Vue
// `useBlocks` connection API — the id/parentId-relative surface that hides the
// flat-index math, mirroring the React adapter's `useBlocks`.
export type {
  BlockNode,
  CaretTarget,
  InsertPosition,
  InsertSpec,
  MoveTarget,
} from '../components/utils/blocks-tree';

import type { BlockNode, InsertSpec, MoveTarget } from '../components/utils/blocks-tree';

/**
 * Reactive, id/parentId-relative view of the block tree returned by
 * {@link useBlocks}. Reads are reactive (they re-run inside a `computed`/template
 * when the editor emits `block changed`); mutators delegate to the editor-level
 * `blocks` API through core's existing chokepoints, so undo/redo and Yjs sync
 * come for free. Every node is a fresh, snapshot-volatile {@link BlockNode} —
 * read it now, depend on the `id`, don't stash it.
 */
export interface UseBlocksApi {
  /** The block with this id as a snapshot node, or null when unknown. */
  getById(id: string): BlockNode | null;
  /** Direct children of `parentId` (or root with `null`), in document order. */
  getChildren(parentId: string | null): BlockNode[];
  /** Total number of blocks. */
  getBlocksCount(): number;
  /** Absolute flat index of a block by id, or null when unknown. */
  getBlockIndex(id: string): number | null;
  /**
   * Insert one block; returns the created node or null when rejected (dangling
   * `parentId`, or an object `position` whose ref is missing). Atomic — one undo
   * step. A `parentId`-targeted insert honors the requested `type` (it inserts
   * at the resolved flat slot, then reparents) rather than forcing the default
   * block type.
   */
  insert(spec?: InsertSpec): BlockNode | null;
  /** Relocate a block to a flat slot (`before`/`after`/`toIndex`). */
  move(id: string, target: MoveTarget): void;
  /** Reparent `id` under `parentId` (= setBlockParent). */
  nest(id: string, parentId: string): void;
  /** Reparent `id` to the root level (= setBlockParent(id, null)). */
  unnest(id: string): void;
  /** Remove the block by id. */
  remove(id: string): void;
  /** Run `fn` as one atomic operation (a single undo step). */
  transact(fn: () => void): void;
}
