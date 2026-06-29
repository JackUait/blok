// src/react/useBlocks.ts
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Blok } from '../../types';
import type { BlockToolData } from '../../types/tools';
import type { BlockTuneData } from '../../types/block-tunes/block-tune-data';
import {
  snapshotNodes,
  resolveInsertIndex,
  resolveMoveIndex,
  parentMap,
  isDescendantOf,
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

/**
 * Stable API returned while the editor is null (before `useBlok` resolves).
 * Every read returns empty/null and every MUTATOR is a no-op — EXCEPT
 * `transact`, which still invokes its callback so a consumer wrapping
 * conditional work in `transact` still runs that work even pre-ready.
 */
const EMPTY_API: UseBlocksApi = {
  getById: () => null,
  getChildren: () => [],
  insert: () => null,
  insertMany: () => [],
  move: () => undefined,
  nest: () => undefined,
  unnest: () => undefined,
  remove: () => undefined,
  update: () => undefined,
  convert: () => undefined,
  // Not a no-op: still runs the callback (see EMPTY_API doc above).
  transact: (fn: () => void) => fn(),
};

/**
 * React hook exposing an id/parentId-relative, reactive view of the block tree.
 * Re-renders whenever the editor emits 'block changed' — including programmatic
 * `nest`/`unnest` reparents, which Blok now surfaces as a structural mutation.
 *
 * Reactivity contract: reads refresh ONLY in response to the editor's
 * 'block changed' event. A mutation that advances the editor state WITHOUT
 * emitting it (a tool that mutates its own data without a sync, say) would leave
 * these reads frozen on the previous snapshot until the next emission. The
 * built-in mutators here all route through paths that emit, so this only bites
 * out-of-band tool writes.
 *
 * Pre-ready contract: while `editor` is null (before `useBlok` resolves) the
 * returned API is the stable {@link EMPTY_API} — every MUTATOR is a no-op,
 * `insert`/`getById` return `null`, and `getChildren` returns `[]`. The one
 * exception is `transact`, which still invokes its callback even pre-ready.
 * Mutator calls made before the editor is ready are silently dropped, so guard
 * on a non-null editor (or render-gate on it) when an insert must not be lost.
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

  // Reset the monotonic version when the editor INSTANCE changes so a fresh
  // editor doesn't inherit a stale version from a previous one. Done in render
  // (idempotent: editorRef is updated in the same pass, so a re-render with the
  // same editor won't reset again) — safe for useSyncExternalStore, which just
  // re-reads getSnapshot and re-renders if the value differs.
  const editorRef = useRef(editor);

  if (editorRef.current !== editor) {
    editorRef.current = editor;
    versionRef.current = 0;
  }

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
      const visited = new Set<string>();
      const stack: string[] = [rootId];

      // A parentId cycle (possible from a concurrent remote Yjs reparent) would
      // make this DFS spin forever — track visited ids and skip re-entry so each
      // block is emitted at most once and the traversal always terminates.
      while (stack.length > 0) {
        const id = stack.pop() as string;

        if (visited.has(id)) {
          continue;
        }
        visited.add(id);
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
    const relocateSubtree = (rootId: string, preRemovalSlot: number): boolean => {
      // Subtree members in current flat (document) order — root first.
      const members = collectSubtreeIds(rootId)
        .map((id) => ({ id, idx: editor.blocks.getBlockIndex(id) }))
        .filter((m): m is { id: string; idx: number } => m.idx !== undefined)
        .sort((a, b) => a.idx - b.idx)
        .map((m) => m.id);

      const rootFrom = editor.blocks.getBlockIndex(rootId);

      if (rootFrom === undefined) {
        return false;
      }

      // Defensive clamp into [0, count-1]: Blok's move() silently no-ops on an
      // out-of-range index, so an over-large preRemovalSlot would strand the
      // root instead of appending it. (In practice resolveInsertIndex stays in
      // range; this guards a concurrently-shrunk tree.)
      const lastIndex = Math.max(0, editor.blocks.getBlocksCount() - 1);
      const rootTarget = Math.min(
        Math.max(rootFrom < preRemovalSlot ? preRemovalSlot - 1 : preRemovalSlot, 0),
        lastIndex
      );

      editor.blocks.move(rootTarget, rootFrom);

      // Detect a BLOCKED relocation: Blok's move() clamps a cross-`column`-
      // boundary move to a no-op. If the root could not reach its target (it
      // didn't move and wasn't already there), the relocation failed — report
      // it so the caller skips the reparent that would otherwise corrupt DFS
      // contiguity (a child wedged outside its parent's flat run). A legitimate
      // no-op (already at target, rootFrom === rootTarget) still counts as
      // relocated so an in-place nest/unnest reparents as intended.
      if (rootFrom !== rootTarget && editor.blocks.getBlockIndex(rootId) === rootFrom) {
        return false;
      }

      // Place each descendant immediately after the previously-positioned member,
      // re-reading the anchor's LIVE index every iteration. A cached root index
      // (rootNew + k + 1) only holds for a BACKWARD relocation, where descendants
      // already sit after the root. For a FORWARD relocation each descendant
      // move() splices an element out from BEFORE the root, sliding the root (and
      // a cached index) down one slot per step — so the target overshoots, trips
      // Blocks.move()'s out-of-range no-op guard, and strands the descendant.
      // Re-anchoring to the predecessor's current slot absorbs the drift in both
      // directions and keeps the subtree DFS-contiguous. A descendant already in
      // place (carried by resortNestedBlocks for a DOM-nested child) is skipped.
      // The anchor for the k-th descendant is the (k-1)-th — read live each step.
      const descendants = members.filter((memberId) => memberId !== rootId);

      descendants.forEach((memberId, k) => {
        const anchorId = k === 0 ? rootId : descendants[k - 1];
        const from = editor.blocks.getBlockIndex(memberId);
        const anchor = editor.blocks.getBlockIndex(anchorId);

        if (from === undefined || anchor === undefined) {
          return;
        }
        const target = anchor + 1;

        if (from !== target) {
          editor.blocks.move(from < target ? target - 1 : target, from);
        }
      });

      return true;
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

    /**
     * Nest `id` (and its whole subtree) under `parentId`, as one undo step.
     * No-op when either id is unknown (probed via the silent snapshot, NOT
     * getBlockIndex, which warns on unknown ids), or when `parentId` is `id`
     * itself or one of `id`'s own descendants — that would form a cycle, which
     * core's setBlockParent THROWS on, so the hook guards it up front.
     *
     * Column boundary caveat: nesting a block that lives inside a `column` (or
     * into one) is a GRACEFUL no-op — Blok's move() clamps cross-column-boundary
     * moves, so the relocation can't run; the hook detects the blocked
     * relocation and skips the reparent, leaving the parent unchanged. Use the
     * drag UI for column membership changes. Returns void.
     */
    const nest = (id: string, parentId: string): void => {
      if (getById(parentId) === null || getById(id) === null) {
        return;
      }

      // Cycle guard: a block can't become a child of itself or of one of its
      // own descendants. Without this, the relocate/reparent reaches core's
      // setBlockParent, which throws on a cycle and crashes the caller.
      if (parentId === id || isDescendantOf(parentMap(reader), parentId, id)) {
        return;
      }

      // Relocate id's whole subtree to after the new parent's existing subtree,
      // THEN assert the parents. Blok keeps the flat array as the canonical
      // document order, and the flat-index insert API only resolves a parent's
      // "end" slot when that parent's descendants are contiguous — a bare reparent
      // (no relocation) would wedge unrelated blocks between the parent and its new
      // child, corrupting later inserts/reads. Mirrors the drag move-then-reparent.
      //
      // Only reparent when the relocation actually placed the block: a clamped
      // cross-column move leaves it where it was, and reparenting in place would
      // break DFS contiguity.
      const members = captureSubtreeParents(id);

      transact(() => {
        if (relocateSubtree(id, resolveInsertIndex(reader, parentId, 'end'))) {
          reparentSubtree(members, id, parentId);
        }
      });
    };

    /**
     * Promote `id` (and its subtree) to root, as one undo step. No-op when the
     * id is unknown or already at root. Same column-boundary caveat as
     * {@link nest}: unnesting out of a `column` is a graceful no-op. Returns void.
     */
    const unnest = (id: string): void => {
      const node = getById(id);

      if (node === null) {
        return;
      }
      const parentId = node.parentId;

      if (parentId === null) {
        return;
      }

      // Move id's subtree out past its former parent's whole subtree before
      // clearing the parent, so the promoted block doesn't strand itself between
      // the parent and its remaining children (which would break contiguity).
      // As with nest, only clear the parent when the relocation succeeded — a
      // clamped cross-column move must stay a graceful no-op.
      const members = captureSubtreeParents(id);

      transact(() => {
        if (relocateSubtree(id, resolveInsertIndex(reader, parentId, 'end'))) {
          reparentSubtree(members, id, null);
        }
      });
    };

    const remove = (id: string): void => {
      if (editor.blocks.getBlockIndex(id) === undefined) {
        return;
      }

      // Remove the block AND its descendants. Blok's single-block delete promotes
      // a (non-columns) container's children to root, which would orphan the
      // nested structure the caller meant to discard. Delete deepest-first (by
      // descending flat index) so a parent is childless by the time it's deleted
      // (no promotion). One undo step.
      //
      // Re-resolve each member's index by id AT DELETE TIME rather than reusing a
      // pre-captured snapshot: a core delete can cascade (deleting a column's last
      // child auto-removes the empty column) or shift indices, so a stale index
      // could target the wrong — or an already-gone — block.
      const orderedIds = collectSubtreeIds(id)
        .map((subId) => ({ subId, index: editor.blocks.getBlockIndex(subId) }))
        .filter((m): m is { subId: string; index: number } => m.index !== undefined)
        .sort((a, b) => b.index - a.index)
        .map((m) => m.subId);

      transact(() => {
        for (const subId of orderedIds) {
          const index = editor.blocks.getBlockIndex(subId);

          // Already removed by a cascading delete of one of its descendants.
          if (index === undefined) {
            continue;
          }
          void editor.blocks.delete(index, false);
        }
      });
    };

    /**
     * Move `id` to a flat slot, as a single operation. No-op when `id` is
     * unknown (probed via the silent snapshot, NOT getBlockIndex, which warns on
     * unknown ids); when a relative `{ before|after }` target references `id`
     * itself, one of its descendants (a block can't be a sibling of its own
     * child), or a ref that does not exist (an unresolved relative target must
     * not silently dump the block at the document end); or when an absolute
     * `{ toIndex }` lands inside `id`'s OWN subtree (that would auto-heal the
     * block under its own child — a cycle core throws on). Guards run BEFORE the
     * index is resolved into a final move.
     *
     * Parent-adoption side effect: `before`/`after` are POSITION targets, so the
     * moved block ADOPTS the parent of wherever it lands (moving into a
     * container's children nests it; moving out to a root sibling unnests it).
     * Use {@link nest}/{@link unnest} to change the parent without choosing a
     * sibling slot. Returns void.
     */
    const move = (id: string, target: MoveTarget): void => {
      // Silent existence probe (NOT getBlockIndex, which warns on unknown ids).
      if (getById(id) === null) {
        return;
      }
      // id is known, so getBlockIndex won't warn.
      const fromIndex = editor.blocks.getBlockIndex(id);

      if (fromIndex === undefined) {
        return;
      }

      if (!('toIndex' in target)) {
        const ref = 'before' in target ? target.before : target.after;

        // A relative target can't reference the block itself or any of its own
        // descendants — a block can't become a sibling of its child.
        if (ref === id || isDescendantOf(parentMap(reader), ref, id)) {
          return;
        }

        // An unresolved relative ref must NOT fall through to a relocate-to-end:
        // a missing target is a no-op, not a surprise jump to the document end.
        if (getById(ref) === null) {
          return;
        }
      } else {
        // An absolute toIndex landing inside id's own subtree would make core
        // auto-heal the block under one of its descendants — a parent/child
        // cycle that core's setBlockParent THROWS on. Compute the block's own
        // flat subtree range and no-op when the (clamped) target falls within
        // it. A leaf's range is a single slot, so this never blocks a real move.
        const subtreeEnd = collectSubtreeIds(id)
          .map((memberId) => editor.blocks.getBlockIndex(memberId))
          .filter((i): i is number => i !== undefined)
          .reduce((max, i) => Math.max(max, i), fromIndex);
        const requested = resolveMoveIndex(reader, target);

        if (requested > fromIndex && requested <= subtreeEnd) {
          return;
        }
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

    /**
     * Perform one insert (create + intended-parent assertion) WITHOUT opening a
     * transaction — the caller owns the undo grouping. `insert` wraps a single
     * call in its own transact; `insertMany` shares ONE transact across the whole
     * batch so the bulk insert is a single undo step. Returns the created node,
     * or null when nothing was inserted (idempotent hit returns the existing
     * node; a guard failure returns null).
     */
    const insertWithinTransaction = (spec: InsertSpec): BlockNode | null => {
      const parentId = spec.parentId ?? null;
      const position = spec.position ?? 'end';
      const data = spec.data ?? {};
      // Programmatic insert must not steal the caret unless explicitly asked.
      const needToFocus = spec.focus ?? false;
      const replace = spec.replace ?? false;

      // Idempotent insert-if-absent: a stable explicit id that already exists
      // returns the existing node without inserting a duplicate, so a re-running
      // effect is safe. Probe via the silent snapshot getById, NOT
      // editor.blocks.getBlockIndex — the latter logs a `warn` for any unknown
      // id, which would spam the console on this (expected-absent) happy path.
      //
      // Skipped under `replace`: a replace is an explicit overwrite, not an
      // insert, so an existing id must not short-circuit it (the two would
      // otherwise silently conflict and replace nothing).
      if (spec.id !== undefined && !replace) {
        const existing = getById(spec.id);

        if (existing !== null) {
          return existing;
        }
      }

      // A dangling parentId would make core throw (dev) or silently misplace the
      // block at the document end (prod). Honor the null contract instead. Probe
      // via the silent snapshot getById, NOT editor.blocks.getBlockIndex, which
      // logs a `warn` for any unknown id and would spam the console on this
      // expected-absent no-op path. Skipped under replace: a replace ignores
      // parentId entirely (the overwritten block's own parent governs), so a
      // stale parentId must not abort the overwrite.
      if (!replace && parentId !== null && getById(parentId) === null) {
        return null;
      }

      // A replace targets the before/after ref block ITSELF (the "turn into"
      // block being overwritten), not a sibling anchor. It therefore REQUIRES an
      // object position naming that ref:
      //   - with position 'start'/'end' (or omitted) there is no target ref, so
      //     a replace has nothing to overwrite — return null rather than silently
      //     overwriting whatever block happens to sit at the resolved slot;
      //   - with an object position whose ref doesn't exist there is likewise
      //     nothing to overwrite — return null instead of falling through to
      //     resolveInsertIndex's end-slot fallback (which would insert/replace at
      //     the wrong place and reparent a dangling target).
      // Validation is skipped for a plain insert (above), so this is the only
      // guard that protects the replace path.
      if (replace) {
        if (typeof position !== 'object') {
          return null;
        }

        const replaceTargetRef = 'before' in position ? position.before : position.after;

        if (getById(replaceTargetRef) === null) {
          return null;
        }
      }

      const flatIndex = resolveInsertIndex(reader, parentId, position, replace);

      // A replace is a positional type-swap that PRESERVES the replaced block's
      // parent link, so the intended parent is the target's existing parent, not
      // the caller's (root-defaulting) parentId. Capture it from the pre-insert
      // snapshot so the post-insert assertion re-nests the replacement correctly
      // instead of un-nesting it to root. A plain insert uses parentId as-is.
      const positionRef = ((): string | null => {
        if (typeof position !== 'object') {
          return null;
        }

        return 'before' in position ? position.before : position.after;
      })();
      const replaceRef = replace ? positionRef : null;
      const intendedParentId =
        replaceRef !== null ? getById(replaceRef)?.parentId ?? null : parentId;

      const created = ((): { id: string } | null | undefined => {
        try {
          return editor.blocks.insert(spec.type, data, {}, flatIndex, needToFocus, replace, spec.id, spec.tunes);
        } catch (error) {
          // The only EXPECTED throw here is an unknown/missing tool — core
          // reports it as "…not found" (also covers a missing replace target).
          // Honor the null contract for that; re-throw anything else so a
          // genuine bug surfaces instead of being masked as a null return.
          if (error instanceof Error && error.message.includes('not found')) {
            return null;
          }
          throw error;
        }
      })();

      if (created === undefined || created === null) {
        return null;
      }

      // Assert the intended parent. Core derives a new block's parent from its
      // flat predecessor, so a block appended right after a `column` child is
      // auto-nested into that column. We know the caller's intent: for a
      // parented insert set the parent; for a root insert (parentId === null)
      // override back to root ONLY if core nested it, keeping the natural
      // `insert({ position: 'end' })` a root sibling instead of a stowaway. For
      // a replace, intendedParentId is the overwritten block's own parent, so
      // the replacement keeps its place in the tree.
      const landedParentId = getById(created.id)?.parentId ?? null;

      if (landedParentId !== intendedParentId) {
        editor.blocks.setBlockParent(created.id, intendedParentId);
      }

      return getById(created.id);
    };

    /**
     * Insert one block. Returns the created {@link BlockNode}, or null when the
     * insert is rejected — an unknown tool type (core "…not found"), a dangling
     * `parentId`, or a `replace` whose target ref doesn't exist. An explicit
     * `id` that already exists is insert-if-absent: the existing node is returned
     * and nothing is created (skipped under `replace`, which is an explicit
     * overwrite). Validation runs BEFORE the slot is resolved; a `replace`
     * preserves the overwritten block's parent. Always one atomic undo step.
     *
     * The returned node is a fresh-snapshot view (its `contentIds` are derived
     * per call) — read it immediately; do NOT place it in a `useMemo`/`useEffect`
     * dependency array expecting per-mutation identity.
     */
    const insert = (spec: InsertSpec = {}): BlockNode | null => {
      // Mutable property on a const holder (no `let`): the node captured from
      // inside the transact closure for the post-transact return.
      const result: { node: BlockNode | null } = { node: null };

      // Always atomic: a single undo step removes the new block (and, for a
      // parented insert, its reparent) — and gives the insert its own boundary
      // instead of merging into adjacent typing history.
      transact(() => {
        result.node = insertWithinTransaction(spec);
      });

      return result.node;
    };

    const insertMany = (specs: InsertSpec[]): BlockNode[] => {
      // An empty batch opens no transaction (no spurious undo boundary).
      if (specs.length === 0) {
        return [];
      }

      const created: BlockNode[] = [];

      // ONE transact for the whole batch → a single atomic undo step. Each spec
      // still runs the full single-insert path (parent assertion, positioning).
      // Specs that fail to insert return null and are dropped from the result.
      transact(() => {
        for (const spec of specs) {
          const node = insertWithinTransaction(spec);

          if (node !== null) {
            created.push(node);
          }
        }
      });

      return created;
    };

    const update = (
      id: string,
      data?: BlockToolData,
      tunes?: { [name: string]: BlockTuneData }
    ): void => {
      // Silent existence probe (NOT getBlockIndex, which warns on unknown ids).
      if (getById(id) === null) {
        return;
      }

      // Core update is async and forms its own undo/Yjs step, so it is NOT
      // wrapped in transact (that would close the group before the write lands).
      // Swallow any rejection so it can't surface as an unhandled rejection.
      void Promise.resolve(editor.blocks.update(id, data, tunes)).catch(() => undefined);
    };

    const convert = (id: string, newType: string, dataOverrides?: BlockToolData): void => {
      if (getById(id) === null) {
        return;
      }

      // Core convert is async and rejects when a tool lacks a conversionConfig.
      // Like update, it owns its own history step (no transact). Swallow the
      // rejection so a non-convertible block is a graceful no-op.
      void Promise.resolve(editor.blocks.convert(id, newType, dataOverrides)).catch(() => undefined);
    };

    return {
      ...EMPTY_API,
      getById,
      getChildren,
      insert,
      insertMany,
      move,
      nest,
      unnest,
      remove,
      update,
      convert,
      transact,
    };
  }, [editor]);
}
