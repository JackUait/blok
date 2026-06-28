// src/react/useBlocks.ts
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Blok } from '../../types';
import {
  snapshotNodes,
  resolveInsertIndex,
  resolveMoveIndex,
  type BlockNode,
  type IndexReader,
  type InsertSpec,
  type MoveTarget,
  type UseBlocksApi,
} from './blocks-snapshot';

const BLOCK_CHANGED_EVENT = 'block changed';

/** Adapt the live editor to the IndexReader the snapshot helpers expect. */
const readerFor = (editor: Blok): IndexReader => {
  const blocks = editor.blocks;

  return {
    getBlocksCount: () => blocks.getBlocksCount(),
    getBlockByIndex: (i: number) => {
      const b = blocks.getBlockByIndex(i);

      return b === undefined ? undefined : { id: b.id, name: b.name, parentId: b.parentId };
    },
    getBlockIndex: (id: string) => blocks.getBlockIndex(id),
  };
};

const EMPTY_API: UseBlocksApi = {
  getById: () => null,
  getChildren: () => [],
  insert: () => null,
  move: () => undefined,
  nest: () => undefined,
  unnest: () => undefined,
  remove: () => undefined,
  transact: (fn: () => void) => fn(),
};

/**
 * React hook exposing an id/parentId-relative, reactive view of the block tree.
 * Re-renders whenever the editor emits 'block changed' — including programmatic
 * `nest`/`unnest` reparents, which Blok now surfaces as a structural mutation.
 *
 * Pre-ready contract: while `editor` is null (before `useBlok` resolves) the
 * returned API is the stable {@link EMPTY_API} — every method is a no-op,
 * `insert`/`getById` return `null`, and `getChildren` returns `[]`. Calls made
 * before the editor is ready are silently dropped, so guard on a non-null editor
 * (or render-gate on it) when an insert must not be lost.
 *
 * Referential stability: the returned API object is stable across renders (it
 * only changes when `editor` does), but each `getById`/`getChildren` call
 * allocates fresh `BlockNode` objects/arrays from a live snapshot. Read them in
 * render and re-read after a change — do NOT put a `getById`/`getChildren`
 * result (or the api handle) in a `useMemo`/`useEffect` dependency array
 * expecting it to change identity per mutation; depend on the node `id`s instead.
 * @param editor - the Blok instance from useBlok, or null before it is ready
 */
export function useBlocks(editor: Blok | null): UseBlocksApi {
  // Monotonic version bumped on every 'block changed'; drives useSyncExternalStore.
  const versionRef = useRef(0);

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      if (editor === null) {
        return () => undefined;
      }

      const handler = (): void => {
        versionRef.current += 1;
        onStoreChange();
      };

      editor.on(BLOCK_CHANGED_EVENT, handler);

      return () => editor.off(BLOCK_CHANGED_EVENT, handler);
    },
    [editor]
  );

  const getSnapshot = useCallback((): number => versionRef.current, []);

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo<UseBlocksApi>(() => {
    if (editor === null) {
      return EMPTY_API;
    }

    const reader = readerFor(editor);

    const getById = (id: string): BlockNode | null => {
      const nodes = snapshotNodes(reader);

      return nodes.find((n) => n.id === id) ?? null;
    };

    const getChildren = (parentId: string | null): BlockNode[] =>
      snapshotNodes(reader).filter((n) => n.parentId === parentId);

    const transact = (fn: () => void): void => {
      if (editor.blocks.transact !== undefined) {
        editor.blocks.transact(fn);
      } else {
        fn();
      }
    };

    /** Flat list of id + all transitive descendants, via the parentId graph. */
    const collectSubtreeIds = (rootId: string): string[] => {
      const nodes = snapshotNodes(reader);
      const childrenOf = new Map<string, string[]>();

      for (const n of nodes) {
        if (n.parentId === null) {
          continue;
        }
        const bucket = childrenOf.get(n.parentId) ?? [];

        bucket.push(n.id);
        childrenOf.set(n.parentId, bucket);
      }

      const out: string[] = [];
      const stack: string[] = [rootId];

      while (stack.length > 0) {
        const id = stack.pop() as string;

        out.push(id);
        const kids = childrenOf.get(id);

        if (kids !== undefined) {
          stack.push(...kids);
        }
      }

      return out;
    };

    /** Each subtree member's parentId, captured from the current snapshot. */
    const captureSubtreeParents = (rootId: string): Array<{ id: string; parentId: string | null }> => {
      const parentOf = new Map(snapshotNodes(reader).map((n) => [n.id, n.parentId]));

      return collectSubtreeIds(rootId).map((id) => ({ id, parentId: parentOf.get(id) ?? null }));
    };

    /**
     * Relocate id AND its whole subtree to sit contiguously starting at a
     * PRE-removal flat slot. Blok's Blocks.move() is post-removal index space and
     * only carries DOM-contained descendants (resortNestedBlocks) — indent /
     * parentId-nested children are NOT, so move each subtree member that a single
     * root move didn't already pull into place. Keeps the flat array DFS-contiguous,
     * the invariant the flat-index insert API and getChildren ordering depend on.
     */
    const relocateSubtree = (rootId: string, preRemovalSlot: number): void => {
      // Subtree members in current flat (document) order — root first.
      const members = collectSubtreeIds(rootId)
        .map((id) => ({ id, idx: editor.blocks.getBlockIndex(id) }))
        .filter((m): m is { id: string; idx: number } => m.idx !== undefined)
        .sort((a, b) => a.idx - b.idx)
        .map((m) => m.id);

      const rootFrom = editor.blocks.getBlockIndex(rootId);

      if (rootFrom === undefined) {
        return;
      }
      editor.blocks.move(rootFrom < preRemovalSlot ? preRemovalSlot - 1 : preRemovalSlot, rootFrom);

      // Root's new index is stable: every descendant lands AFTER it, so the k-th
      // descendant's home is rootNew + k + 1. A descendant already there was
      // carried by resortNestedBlocks (DOM-nested child) — leave it.
      const rootNew = editor.blocks.getBlockIndex(rootId) ?? rootFrom;

      members
        .filter((memberId) => memberId !== rootId)
        .forEach((memberId, k) => {
          const from = editor.blocks.getBlockIndex(memberId);
          const target = rootNew + k + 1;

          if (from === undefined || from === target) {
            return;
          }
          editor.blocks.move(from < target ? target - 1 : target, from);
        });
    };

    // Reparent `id` (root → newParentId, descendants → their original parent).
    // Re-asserting after relocateSubtree heals move()'s auto-reparent (which sets
    // a moved block's parentId to its new neighbour) and never relocates the flat
    // array, so contiguity established by relocateSubtree is preserved.
    const reparentSubtree = (
      members: Array<{ id: string; parentId: string | null }>,
      rootId: string,
      newParentId: string | null
    ): void => {
      for (const m of members) {
        editor.blocks.setBlockParent(m.id, m.id === rootId ? newParentId : m.parentId);
      }
    };

    // Note: nesting/unnesting a block that lives inside a `column` is not fully
    // supported — Blok's move() clamps cross-column-boundary moves to a no-op, so
    // the relocation can't run; use the drag UI for column membership changes.
    const nest = (id: string, parentId: string): void => {
      if (
        editor.blocks.getBlockIndex(parentId) === undefined ||
        editor.blocks.getBlockIndex(id) === undefined
      ) {
        return;
      }

      // Relocate id's whole subtree to after the new parent's existing subtree,
      // THEN assert the parents. Blok keeps the flat array as the canonical
      // document order, and the flat-index insert API only resolves a parent's
      // "end" slot when that parent's descendants are contiguous — a bare reparent
      // (no relocation) would wedge unrelated blocks between the parent and its new
      // child, corrupting later inserts/reads. Mirrors the drag move-then-reparent.
      const members = captureSubtreeParents(id);

      transact(() => {
        relocateSubtree(id, resolveInsertIndex(reader, parentId, 'end'));
        reparentSubtree(members, id, parentId);
      });
    };

    const unnest = (id: string): void => {
      if (editor.blocks.getBlockIndex(id) === undefined) {
        return;
      }
      const parentId = getById(id)?.parentId ?? null;

      if (parentId === null) {
        return;
      }

      // Move id's subtree out past its former parent's whole subtree before
      // clearing the parent, so the promoted block doesn't strand itself between
      // the parent and its remaining children (which would break contiguity).
      const members = captureSubtreeParents(id);

      transact(() => {
        relocateSubtree(id, resolveInsertIndex(reader, parentId, 'end'));
        reparentSubtree(members, id, null);
      });
    };

    const remove = (id: string): void => {
      if (editor.blocks.getBlockIndex(id) === undefined) {
        return;
      }

      // Remove the block AND its descendants. Blok's single-block delete promotes
      // a (non-columns) container's children to root, which would orphan the
      // nested structure the caller meant to discard. Delete deepest-first by
      // descending flat index so each captured index stays valid and a parent is
      // childless by the time it's deleted (no promotion). One undo step.
      const indices = collectSubtreeIds(id)
        .map((subId) => editor.blocks.getBlockIndex(subId))
        .filter((i): i is number => i !== undefined)
        .sort((a, b) => b - a);

      transact(() => {
        for (const index of indices) {
          void editor.blocks.delete(index);
        }
      });
    };

    const move = (id: string, target: MoveTarget): void => {
      const fromIndex = editor.blocks.getBlockIndex(id);

      if (fromIndex === undefined) {
        return;
      }

      const resolved = resolveMoveIndex(reader, target);

      // Blok's Blocks.move() removes the block (splice fromIndex) BEFORE
      // re-inserting at toIndex, so toIndex lives in the POST-removal index
      // space. For a relative (before/after) forward move the reference index
      // shifts down by one once the block is removed, so compensate — this also
      // keeps a move-to-end within Blok's `toIndex < length` bound. A literal
      // { toIndex } is the caller's explicit final resting index: pass through.
      const isRelative = !('toIndex' in target);
      const toIndex = isRelative && fromIndex < resolved ? resolved - 1 : resolved;

      editor.blocks.move(toIndex, fromIndex);
    };

    const insert = (spec: InsertSpec = {}): BlockNode | null => {
      const parentId = spec.parentId ?? null;
      const position = spec.position ?? 'end';
      const data = spec.data ?? {};
      // Programmatic insert must not steal the caret unless explicitly asked.
      const needToFocus = spec.focus ?? false;

      // A dangling parentId would make core throw (dev) or silently misplace the
      // block at the document end (prod). Honor the null contract instead.
      if (parentId !== null && editor.blocks.getBlockIndex(parentId) === undefined) {
        return null;
      }

      const flatIndex = resolveInsertIndex(reader, parentId, position);

      let createdId: string | null = null;

      // Always atomic: a single undo step removes the new block (and, for a
      // parented insert, its reparent) — and gives the insert its own boundary
      // instead of merging into adjacent typing history.
      transact(() => {
        const created = ((): { id: string } | null | undefined => {
          try {
            return editor.blocks.insert(spec.type, data, {}, flatIndex, needToFocus);
          } catch {
            // Unknown tool type: core throws "Tool not found" — honor null contract.
            return null;
          }
        })();

        if (created === undefined || created === null) {
          return;
        }
        createdId = created.id;

        if (parentId !== null) {
          editor.blocks.setBlockParent(created.id, parentId);
        }
      });

      return createdId === null ? null : getById(createdId);
    };

    return {
      ...EMPTY_API,
      getById,
      getChildren,
      insert,
      move,
      nest,
      unnest,
      remove,
      transact,
    };
  }, [editor]);
}
