// src/components/utils/blocks-api.ts
import type { Blok } from '../../../types';
import type { BlockToolData } from '../../../types/tools';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';
import type { MarkdownImportConfig } from '../../markdown/types';
import { ToolNotFoundError } from '../errors/tool-not-found';

import { generateBlockId } from './id-generator';
import {
  snapshotNodes,
  resolveInsertIndex,
  resolveMoveIndex,
  parentMap,
  isDescendantOf,
  type BlockNode,
  type CaretTarget,
  type IndexReader,
  type InsertPosition,
  type InsertSpec,
  type MoveTarget,
  type TreeInsertSpec,
  type UseBlocksApi,
} from './blocks-tree';

/** Adapt the live editor to the IndexReader the snapshot helpers expect. */
export const readerFor = (editor: Blok): IndexReader => {
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
 * Stable API returned while the editor is null (before the adapter resolves).
 * Every read returns empty/null and every MUTATOR is a no-op — EXCEPT
 * `transact`/`transactWithoutCapture`, which still invoke their callback so a
 * consumer wrapping conditional work in `transact` still runs that work even
 * pre-ready.
 */
export const EMPTY_API: UseBlocksApi = {
  getById: () => null,
  getChildren: () => [],
  insert: () => null,
  insertMany: () => [],
  insertTree: () => null,
  insertMarkdown: async () => [],
  move: () => undefined,
  nest: () => undefined,
  unnest: () => undefined,
  remove: () => undefined,
  update: () => undefined,
  convert: () => undefined,
  // Not a no-op: still runs the callback (see EMPTY_API doc above).
  transact: (fn: () => void) => fn(),
  // Like transact, still runs the callback even pre-ready.
  transactWithoutCapture: (fn: () => void) => fn(),
  getBlocksCount: () => 0,
  getCurrentBlockIndex: () => -1,
  getBlockByIndex: () => null,
  getBlockByElement: () => null,
  getBlockData: () => null,
  getBlockIndex: () => null,
  composeBlockData: async () => ({}),
  renderFromHTML: async () => undefined,
  insertOutputData: () => [],
  splitBlock: () => null,
  insertInsideParent: () => null,
  render: async () => undefined,
  clear: async () => undefined,
  isSyncingFromYjs: () => false,
};

/**
 * Build the framework-agnostic, id/parentId-relative block-tree API over a LIVE
 * editor. Mutators route through the editor-level `blocks` API (core's
 * chokepoints), so undo/redo and Yjs sync are inherited rather than
 * re-implemented; readers enumerate the live tree on every call.
 *
 * This is the shared engine behind both the React (`useSyncExternalStore`) and
 * Vue (`shallowRef` version) `useBlocks` wrappers — one implementation so the
 * two adapters cannot drift. Each adapter supplies the `onRead` seam:
 *
 * - React leaves it the default no-op: `useSyncExternalStore` re-renders the
 *   whole component on `block changed`, and the reads run live during that
 *   render, so no per-call dependency tracking is needed.
 * - Vue passes `() => { void version.value }` so a read inside a `computed` /
 *   template touches the reactive version ref and re-runs on every structural
 *   mutation.
 *
 * `onRead` is invoked at the top of every read method; mutators never call it.
 * The editor MUST be the raw (non-proxied) instance — adapters `toRaw`-unwrap
 * before calling, so a Vue reactive proxy never reaches core (Risk R0).
 *
 * @param editor - the live Blok instance (never null; callers gate on EMPTY_API)
 * @param onRead - reactivity seam called at the start of each read (default no-op)
 */
export const createBlocksApiForEditor = (
  editor: Blok,
  onRead: () => void = () => undefined
): UseBlocksApi => {
  const reader = readerFor(editor);

  const getById = (id: string): BlockNode | null => {
    onRead();
    const nodes = snapshotNodes(reader);

    return nodes.find((n) => n.id === id) ?? null;
  };

  const getChildren = (parentId: string | null): BlockNode[] => {
    onRead();

    return snapshotNodes(reader).filter((n) => n.parentId === parentId);
  };

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
  const relocateSubtree = (rootId: string, preRemovalSlot: number): 'moved' | 'skipped' | 'blocked' => {
    // Subtree members in current flat (document) order — root first.
    const members = collectSubtreeIds(rootId)
      .map((id) => ({ id, idx: editor.blocks.getBlockIndex(id) }))
      .filter((m): m is { id: string; idx: number } => m.idx !== undefined)
      .sort((a, b) => a.idx - b.idx)
      .map((m) => m.id);

    const rootFrom = editor.blocks.getBlockIndex(rootId);

    if (rootFrom === undefined) {
      return 'blocked';
    }

    // Self-overlap guard. `preRemovalSlot` is the destination the caller
    // computed as the END of the (new or former) parent's WHOLE subtree — and
    // when that parent is an ANCESTOR of the relocating block (always so for
    // unnest, and for a nest into a block this one already sits under), that
    // span still CONTAINS this block's own subtree. Moving the root to a slot
    // at the tail of (or inside) its own footprint splices it in right after
    // one of its OWN descendants; core's post-move auto-heal then reparents the
    // block under that descendant (setBlockParent(B, B) when the neighbour is
    // the block's last child), which BlockHierarchy REFUSES with a thrown cycle
    // error — crashing the caller. But the block is already DFS-contiguous at
    // that destination (its subtree is the tail of the parent's subtree), so
    // the relocation is a no-op: skip the move and report 'skipped', leaving the
    // caller to assert the reparent. Window: `rootFrom < preRemovalSlot <=
    // subtreeEnd + 1`. A backward move (`preRemovalSlot <= rootFrom`) or a
    // genuine forward move past unrelated content (`preRemovalSlot > subtreeEnd
    // + 1`) is untouched.
    //
    // 'skipped' (vs 'moved') is reported DISTINCTLY because no `editor.blocks.
    // move()` ran — so core's post-move parent auto-heal never fired. nest/unnest
    // re-assert the root's parent explicitly (reparentSubtree), so they don't
    // care; but move() leans on that auto-heal for the root's parent-adoption, so
    // it must apply the adopted parent itself on this path (see move()).
    const subtreeEnd = collectSubtreeIds(rootId)
      .map((memberId) => editor.blocks.getBlockIndex(memberId))
      .filter((i): i is number => i !== undefined)
      .reduce((max, i) => Math.max(max, i), rootFrom);

    if (preRemovalSlot > rootFrom && preRemovalSlot <= subtreeEnd + 1) {
      return 'skipped';
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
      return 'blocked';
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

    return 'moved';
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

  // Re-assert ONLY the descendants' captured parents after a subtree relocation,
  // leaving the ROOT's parent as core's post-move auto-heal set it — used by
  // move(), whose documented side effect is that the root ADOPTS the parent of
  // the slot it lands in while its subtree travels with it.
  const reassertDescendantParents = (
    members: Array<{ id: string; parentId: string | null }>,
    rootId: string
  ): void => {
    members
      .filter((m) => m.id !== rootId)
      .forEach((m) => editor.blocks.setBlockParent(m.id, m.parentId));
  };

  /**
   * Whether `id` is a DIRECT child of a `column` block. Column membership is
   * owned by the drag UI, so a programmatic nest/unnest that would change it is
   * a graceful no-op (see the nest/unnest docs). Checking this EXPLICITLY makes
   * that contract reliable: relying on core's move-clamp alone leaks, because
   * when the relocation needs no actual move (a tail column child already sits
   * at its relocation target) no boundary-crossing move fires, so nothing
   * clamps and the reparent would slip through.
   */
  const isColumnChild = (id: string): boolean => {
    const parent = getById(id)?.parentId ?? null;

    return parent !== null && getById(parent)?.type === 'column';
  };

  /**
   * Nest `id` (and its whole subtree) under `parentId`, as one undo step.
   * No-op when either id is unknown (probed via the silent snapshot, NOT
   * getBlockIndex, which warns on unknown ids), or when `parentId` is `id`
   * itself or one of `id`'s own descendants — that would form a cycle, which
   * core's setBlockParent THROWS on, so the hook guards it up front.
   *
   * Column boundary caveat: nesting a block that lives inside a `column`, or
   * nesting directly INTO one, is a GRACEFUL no-op — column membership is owned
   * by the drag UI. This is detected explicitly (via the block's and target's
   * parent type), so the no-op holds even when no boundary-crossing move fires.
   * Returns void.
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

    // Column-boundary no-op: pulling a block out of a `column`, or pushing one
    // directly into a column, changes column membership — owned by the drag UI.
    if (isColumnChild(id) || getById(parentId)?.type === 'column') {
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
      // reparentSubtree sets the root's parent EXPLICITLY, so nest is correct on
      // both the 'moved' and 'skipped' paths — it only bails on a 'blocked'
      // (clamped cross-column) relocation.
      if (relocateSubtree(id, resolveInsertIndex(reader, parentId, 'end')) !== 'blocked') {
        reparentSubtree(members, id, parentId);
      }
    });
  };

  /**
   * Promote `id` (and its subtree) to root, as one undo step. No-op when the
   * id is unknown or already at root. Same column-boundary caveat as
   * {@link nest}: unnesting a `column` member out to root is a graceful no-op
   * (column membership changes go through the drag UI). Returns void.
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

    // Column-boundary no-op: a column member is detached only via the drag UI.
    if (isColumnChild(id)) {
      return;
    }

    // Move id's subtree out past its former parent's whole subtree before
    // clearing the parent, so the promoted block doesn't strand itself between
    // the parent and its remaining children (which would break contiguity).
    // As with nest, only clear the parent when the relocation succeeded — a
    // clamped cross-column move must stay a graceful no-op.
    const members = captureSubtreeParents(id);

    transact(() => {
      // As with nest, reparentSubtree asserts the root's (null) parent on both
      // 'moved' and 'skipped'; only a 'blocked' clamp keeps it a no-op.
      if (relocateSubtree(id, resolveInsertIndex(reader, parentId, 'end')) !== 'blocked') {
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
   * not silently dump the block at the document end); or for ANY absolute
   * `{ toIndex }` of a block that HAS descendants (a multi-block subtree can't
   * land on one index — see the subtree note below). Guards run BEFORE the
   * index is resolved into a final move.
   *
   * Parent-adoption side effect: `before`/`after` make the moved block a
   * SIBLING of the ref — it adopts the REF's parent (moving before/after a
   * child of a container nests it into that container; moving before/after a
   * root block unnests it to root). `after` clears the ref's WHOLE subtree, so
   * the block lands past the ref's descendants, not among them. The adopted
   * parent is the ref's — NOT the parent of whatever block happens to sit at the
   * landing slot, which would nest under the ref for `after` a ref-with-children.
   * Use {@link nest}/{@link unnest} to change the parent without choosing a
   * sibling slot. Returns void.
   *
   * Subtree-aware: a block WITH descendants relocates its WHOLE subtree as one
   * undo step (core's single move() carries only DOM-contained descendants, so
   * a naive move would strand indent/parentId-nested children before their
   * parent and corrupt DFS contiguity). Only relative `{ before|after }`
   * targets name an unambiguous slot for a multi-block subtree; an absolute
   * `{ toIndex }` of a block that HAS descendants is ambiguous (k blocks can't
   * all land on one index) and is a graceful no-op — use `{ before|after }` to
   * relocate a subtree.
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
    }
    // NB: an absolute { toIndex } needs no early guard here. A block WITH
    // descendants no-ops EVERY toIndex move in the subtree branch below
    // (ambiguous for a multi-block subtree); a leaf has no own-subtree range to
    // land inside. So a dedicated "toIndex inside own subtree" guard would be
    // dead code — the subtree-branch no-op already covers the cycle it guarded.

    // Subtree-aware relocation. A block WITH descendants can't ride a single
    // core move(): core carries only DOM-contained descendants (resortNested
    // Blocks), so indent/parentId-nested children are left at their old slot —
    // stranded BEFORE their now-moved parent in flat order, breaking the DFS
    // contiguity getChildren ordering and flat-index inserts depend on, and
    // corrupting saved document order. Relocate the whole subtree (as
    // nest/unnest do) and re-assert each descendant's own parent; the ROOT
    // keeps the parent core's post-move auto-heal gives it — move()'s
    // documented parent-adoption side effect — so only descendants are
    // re-parented. A blocked relocation (a clamped cross-`column` move) leaves
    // everything in place, a graceful no-op like nest/unnest. An absolute
    // { toIndex } is ambiguous for a multi-block subtree (see the move() doc),
    // so it is a graceful no-op here — relative targets relocate the subtree.
    // A leaf block (no descendants) falls through to the single-move fast path.
    const subtreeMembers = captureSubtreeParents(id);

    if (subtreeMembers.length > 1) {
      if ('toIndex' in target) {
        return;
      }

      const preRemovalSlot = resolveMoveIndex(reader, target);
      // The relative ref whose parent the moved block adopts (toIndex returned
      // above, so target is { before | after }).
      const ref = 'before' in target ? target.before : target.after;

      transact(() => {
        const outcome = relocateSubtree(id, preRemovalSlot);

        if (outcome === 'blocked') {
          return;
        }
        reassertDescendantParents(subtreeMembers, id);

        // Adopt the REF's parent (sibling-of-ref) on BOTH the 'moved' and
        // 'skipped' paths. The position is already sibling-of-ref: resolveMoveIndex
        // clears the ref's WHOLE subtree for `after` and uses the ref's own slot
        // for `before`, so id lands as the ref's sibling. The parent must match.
        // Core's post-move auto-heal does NOT give that — it adopts the parent of
        // the block at the landing SLOT (pre-removal), which for `after` a
        // ref-with-descendants is the ref's last descendant (parent = the ref →
        // nests id UNDER the ref) and for `before` a ref whose flat predecessor
        // sits in another container is that predecessor's parent. On the 'skipped'
        // path no move() ran, so no auto-heal fired at all. Assert ref.parentId so
        // position and parent agree regardless of path. Guarded (mirrors
        // insertWithinTransaction) so a same-container reorder — the common case,
        // where the landed parent already matches — fires no redundant reparent.
        // Can't cycle: ref is neither id nor a descendant (guarded above), so
        // ref's parent is outside id's subtree.
        const intendedParent = getById(ref)?.parentId ?? null;

        if ((getById(id)?.parentId ?? null) !== intendedParent) {
          editor.blocks.setBlockParent(id, intendedParent);
        }
      });

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

    if (!isRelative) {
      // Absolute { toIndex }: the caller chose the slot, so let core's auto-heal
      // adopt that slot's container (the documented absolute-move semantics).
      editor.blocks.move(toIndex, fromIndex);

      return;
    }

    // Relative leaf move: same sibling-of-ref rule as the subtree branch — the
    // moved block adopts the REF's parent, not the landing-slot neighbour's
    // (which auto-heal would give: the ref's descendant for `after`, or a
    // cross-container predecessor for `before`). Assert it in the same undo step
    // as the move, guarded so a same-container reorder fires no redundant
    // reparent. Can't cycle: ref is guarded to be neither id nor a descendant,
    // and a leaf has no descendants for ref's parent to fall inside.
    const ref = 'before' in target ? target.before : target.after;

    transact(() => {
      editor.blocks.move(toIndex, fromIndex);
      const intendedParent = getById(ref)?.parentId ?? null;

      if ((getById(id)?.parentId ?? null) !== intendedParent) {
        editor.blocks.setBlockParent(id, intendedParent);
      }
    });
  };

  /**
   * Perform one insert (create + intended-parent assertion) WITHOUT opening a
   * transaction — the caller owns the undo grouping. `insert` wraps a single
   * call in its own transact; `insertMany` shares ONE transact across the whole
   * batch so the bulk insert is a single undo step. Returns the created node,
   * or null when nothing was inserted (idempotent hit returns the existing
   * node; a guard failure returns null).
   */
  const insertWithinTransaction = (spec: InsertSpec): { node: BlockNode | null; created: boolean } => {
    const parentId = spec.parentId ?? null;
    const position = spec.position ?? 'end';
    const data = spec.data ?? {};
    // Programmatic insert must not steal the caret unless explicitly asked.
    const needToFocus = spec.focus ?? false;
    const replace = spec.replace ?? false;

    // Every pre-insert guard (id-exists, dangling-parent, missing-ref) and the
    // replace-parent lookup used to call `getById`, which re-enumerates the
    // WHOLE tree each time — O(probes·n) per spec, O(k·probes·n) per batch.
    // The tree can't change until `editor.blocks.insert` runs below, so take
    // ONE snapshot here and resolve every pre-insert probe against it.
    const preById = new Map(snapshotNodes(reader).map((n) => [n.id, n]));
    const probe = (id: string): BlockNode | null => preById.get(id) ?? null;

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
      const existing = probe(spec.id);

      if (existing !== null) {
        // Insert-if-absent hit: the block already existed, nothing was created.
        // insert() still returns the existing node (documented), but insertMany
        // must EXCLUDE it from its created[] result — hence created: false.
        return { node: existing, created: false };
      }
    }

    // A dangling parentId would make core throw (dev) or silently misplace the
    // block at the document end (prod). Honor the null contract instead. Probe
    // via the silent snapshot getById, NOT editor.blocks.getBlockIndex, which
    // logs a `warn` for any unknown id and would spam the console on this
    // expected-absent no-op path. Skipped under replace: a replace ignores
    // parentId entirely (the overwritten block's own parent governs), so a
    // stale parentId must not abort the overwrite.
    if (!replace && parentId !== null && probe(parentId) === null) {
      return { node: null, created: false };
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
        return { node: null, created: false };
      }

      const replaceTargetRef = 'before' in position ? position.before : position.after;

      if (probe(replaceTargetRef) === null) {
        return { node: null, created: false };
      }
    }

    // A plain insert with an object position naming a ref that does NOT exist
    // must be a no-op (return null), NOT a silent append at the document/parent
    // end. resolveInsertIndex falls back to the end slot for an unresolved ref,
    // which would dump the block somewhere surprising — a DX footgun. Mirror
    // move(), which already bails on a missing relative ref. (Skipped under
    // replace: the block above already validated the replace ref.)
    if (!replace && typeof position === 'object') {
      const positionTargetRef = 'before' in position ? position.before : position.after;

      if (probe(positionTargetRef) === null) {
        return { node: null, created: false };
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
      replaceRef !== null ? probe(replaceRef)?.parentId ?? null : parentId;

    const created = ((): { id: string } | null | undefined => {
      try {
        return editor.blocks.insert(spec.type, data, {}, flatIndex, needToFocus, replace, spec.id, spec.tunes);
      } catch (error) {
        // The only EXPECTED throw here is an unknown/missing tool — core throws
        // a typed ToolNotFoundError. (A missing replace TARGET is a bare Error,
        // not this type, so it would re-throw — but the replace ref is already
        // pre-validated above, so it never reaches here.) Honor the null contract
        // for ToolNotFoundError; re-throw anything else so a genuine
        // bug surfaces instead of being masked as a null return. Keyed on the
        // error TYPE, not a 'not found' substring, so an unrelated error whose
        // message happens to contain "not found" is not wrongly swallowed.
        if (error instanceof ToolNotFoundError) {
          return null;
        }
        throw error;
      }
    })();

    if (created === undefined || created === null) {
      return { node: null, created: false };
    }

    // Assert the intended parent. Core derives a new block's parent from its
    // flat predecessor, so a block appended right after a `column` child is
    // auto-nested into that column. We know the caller's intent: for a
    // parented insert set the parent; for a root insert (parentId === null)
    // override back to root ONLY if core nested it, keeping the natural
    // `insert({ position: 'end' })` a root sibling instead of a stowaway. For
    // a replace, intendedParentId is the overwritten block's own parent, so
    // the replacement keeps its place in the tree.
    // ONE post-insert snapshot for both the landed-parent check and the return
    // node (was two separate getById enumerations). A freshly-created block has
    // no children, so reparenting it only flips its own parentId — its derived
    // contentIds stay `[]`. We therefore reconstruct the corrected node in place
    // rather than re-enumerating the tree a third time after setBlockParent.
    const createdNode = snapshotNodes(reader).find((n) => n.id === created.id) ?? null;
    const landedParentId = createdNode?.parentId ?? null;

    const node =
      landedParentId === intendedParentId
        ? createdNode
        : ((): BlockNode | null => {
            editor.blocks.setBlockParent(created.id, intendedParentId);

            return createdNode === null ? null : { ...createdNode, parentId: intendedParentId };
          })();

    // Position the caret inside the freshly-created block when the caller asked
    // for a specific spot (beyond the boolean `focus`). Applied only on a real
    // creation — an insert-if-absent hit returned earlier, so it never reaches
    // here. setToBlock takes the block id directly.
    if (spec.caret !== undefined) {
      editor.caret.setToBlock(created.id, spec.caret.position ?? 'default', spec.caret.offset ?? 0);
    }

    return { node, created: true };
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
      // insert() returns the resolved node — including an insert-if-absent hit's
      // existing node (documented) — so it reads only `.node`, not `.created`.
      result.node = insertWithinTransaction(spec).node;
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
    // Per the documented contract, the result holds ONLY successfully-created
    // nodes: specs that fail to insert (null node) AND insert-if-absent hits
    // (existing block, created: false) are both dropped.
    transact(() => {
      for (const spec of specs) {
        const result = insertWithinTransaction(spec);

        if (result.created && result.node !== null) {
          created.push(result.node);
        }
      }
    });

    return created;
  };

  /**
   * Insert a pre-built nested subtree as ONE atomic operation. See the
   * {@link UseBlocksApi.insertTree} contract. Flattens the spec to a DFS
   * pre-order `OutputBlockData[]` — wiring every node's `parent`/`content`
   * links from ids generated up front — then delegates to core's tree-aware
   * `blocks.insertMany` inside a single transact.
   */
  const insertTree = (spec: TreeInsertSpec): BlockNode | null => {
    const parentId = spec.parentId ?? null;
    const position = spec.position ?? 'end';

    // Dangling root parentId: mirror `insert`'s guard via the silent snapshot
    // getById (NOT getBlockIndex, which warns on unknown ids). Reject so the
    // subtree isn't silently dumped at the document end.
    if (parentId !== null && getById(parentId) === null) {
      return null;
    }

    // Dangling relative position ref: an object { before|after } naming a block
    // that does not exist must be a no-op, NOT a silent append at the document
    // end (resolveInsertIndex's unresolved-ref fallback). Mirror insert()'s
    // missing-ref guard and reject before flattening anything.
    if (typeof position === 'object') {
      const positionTargetRef = 'before' in position ? position.before : position.after;

      if (getById(positionTargetRef) === null) {
        return null;
      }
    }

    // Every node needs a stable id BEFORE flattening so parent/content links
    // can reference siblings/children. Respect an explicit node id; generate
    // one (core's nanoid scheme) otherwise.
    const flat: OutputBlockData[] = [];

    // Collision guard: an explicit id that already exists in the tree (or is
    // reused within this same spec) would create a duplicate-id block,
    // corrupting every id-keyed lookup (getById, parent/content links). A tree
    // insert always creates fresh blocks (it is NOT insert-if-absent), so a
    // collision is rejected up front — nothing is inserted and null is
    // returned, mirroring insert's null contract. Generated ids never collide.
    // Mutable property on a const holder (no `let`): flipped from inside the
    // recursive visit when a colliding explicit id is seen.
    const usedIds = new Set<string>();
    const collision = { hit: false };

    // Pre-order DFS: push self FIRST, then recurse each child, so the flat
    // array is DFS-contiguous (the invariant core's insertMany + the hook's
    // getChildren depend on). `content` is the live child-id array, filled as
    // each child is visited and returns its id. The root's `parent` is the
    // resolved placement parent (undefined for root level); children's `parent`
    // is their enclosing node's id.
    const visit = (node: TreeInsertSpec, parent: string | undefined): string => {
      if (node.id !== undefined && (usedIds.has(node.id) || getById(node.id) !== null)) {
        collision.hit = true;
      }
      const id = node.id ?? generateBlockId();

      usedIds.add(id);
      const content: string[] = [];
      const flatNode = {
        id,
        // `type` is OMITTED (not present-with-undefined) when absent so core's
        // `type || defaultBlock` fallback resolves the default block cleanly.
        ...(node.type !== undefined ? { type: node.type } : {}),
        data: node.data ?? {},
        content,
        ...(node.tunes !== undefined ? { tunes: node.tunes } : {}),
        ...(parent !== undefined ? { parent } : {}),
      } as OutputBlockData;

      flat.push(flatNode);

      for (const child of node.children ?? []) {
        content.push(visit(child, id));
      }

      return id;
    };

    const rootId = visit(spec, parentId ?? undefined);

    // A colliding explicit id is rejected before any insert (see usedIds doc).
    if (collision.hit) {
      return null;
    }

    const flatIndex = resolveInsertIndex(reader, parentId, position);

    // ONE transact for the whole subtree → a single atomic undo step. Core's
    // insertMany composes EVERY node before inserting any, so an unknown tool
    // type throws a typed ToolNotFoundError with nothing inserted. Honor the
    // same null-on-unknown-tool contract as insert/insertMany rather than
    // surfacing the throw to the caller; re-throw any other (genuine-bug)
    // error. Keyed on the error TYPE, not a 'not found' substring.
    try {
      transact(() => {
        editor.blocks.insertMany(flat, flatIndex);
      });
    } catch (error) {
      if (error instanceof ToolNotFoundError) {
        return null;
      }
      throw error;
    }

    return getById(rootId);
  };

  /**
   * Convert markdown to blocks and insert them ADDITIVELY — see the
   * {@link UseBlocksApi.insertMarkdown} doc for the full contract. Async
   * because the converter is lazy-loaded; the insert itself is one atomic
   * undo step. parentId nesting is supported: top-level converted blocks are
   * reparented under parentId, internally-nested ones keep their parent.
   */
  const insertMarkdown = async (
    markdown: string,
    options?: { parentId?: string | null; position?: InsertPosition; config?: MarkdownImportConfig }
  ): Promise<BlockNode[]> => {
    const parentId = options?.parentId ?? null;
    const position = options?.position ?? 'end';

    // A dangling parentId is a no-op (no insert), matching `insert`/`insertMany`.
    if (parentId !== null && getById(parentId) === null) {
      return [];
    }

    // A dangling relative position ref is likewise a no-op (no insert), NOT a
    // silent append at the document end — mirror insert()/insertTree's guard.
    if (typeof position === 'object') {
      const positionTargetRef = 'before' in position ? position.before : position.after;

      if (getById(positionTargetRef) === null) {
        return [];
      }
    }

    // Lazy-load the converter (dynamic import mirrors core's markdown lazy
    // loading and keeps the parser out of the main bundle) and run it,
    // forwarding the optional MarkdownImportConfig so custom-tool consumers can
    // map markdown nodes into their tools (gfm toggle, toolMap, extensions).
    // Both awaits can fail — a chunk-load error or a malformed-markdown throw;
    // swallow them and return [] so a converter failure is a graceful no-op
    // (matching update/convert) rather than an unhandled promise rejection in
    // the caller. This await resolves BEFORE the synchronous transact.
    // Mutable property on a const holder (no `let`): captured from the try.
    const conversion: { blocks: OutputBlockData[] } = { blocks: [] };

    try {
      const { markdownToBlocks } = await import('../../markdown/index');

      conversion.blocks = await markdownToBlocks(markdown, options?.config);
    } catch (error) {
      // Graceful no-op: a converter failure (chunk-load or parse error) returns
      // [] rather than surfacing an unhandled rejection to the caller. But
      // surface it to the console so a genuine converter bug is DISTINGUISHABLE
      // from empty markdown (which returns [] via the blocks.length === 0 path
      // below, without ever reaching this catch) instead of being swallowed
      // silently and losing all diagnostics.
      console.warn('useBlocks.insertMarkdown: markdown conversion failed', error);

      return [];
    }

    const blocks = conversion.blocks;

    // Empty / whitespace-only markdown opens no transaction (no undo boundary).
    if (blocks.length === 0) {
      return [];
    }

    // Re-validate the parent AFTER the await: the pre-await existence check can
    // go stale if the parent was removed while the converter was in flight.
    // Stamping a now-dangling parent would orphan the blocks instead of the
    // promised [] no-op, so re-check and bail out here.
    if (parentId !== null && getById(parentId) === null) {
      return [];
    }

    // Re-validate the relative position ref after the await too: the target
    // could have been removed while the converter was in flight, in which case
    // inserting at the stale slot would surprise the caller. No-op instead.
    if (typeof position === 'object') {
      const positionTargetRef = 'before' in position ? position.before : position.after;

      if (getById(positionTargetRef) === null) {
        return [];
      }
    }

    // Nest under the parent by stamping `parent` on each TOP-LEVEL block (one
    // the converter left un-parented). Blocks the markdown nested internally
    // (their `parent` already points at a sibling in this batch) are untouched,
    // so the import's own structure is preserved.
    const seeded: OutputBlockData[] =
      parentId === null
        ? blocks
        : blocks.map((block) =>
          block.parent === undefined || block.parent === null
            ? { ...block, parent: parentId }
            : block
        );

    const flatIndex = resolveInsertIndex(reader, parentId, position);

    // Mutable property on a const holder (no `let`): captured from inside the
    // transact closure. insertMany returns BlockAPI[] (each has `.id`) — the
    // reliable record of what was created, since the converter's ids may not
    // survive composition. ONE transact → a single atomic undo step.
    const result: { created: Array<{ id: string }> } = { created: [] };

    // The insert lives OUTSIDE the conversion try/catch, so an unknown mapped
    // tool (core throws a typed ToolNotFoundError) would otherwise surface as an
    // unhandled promise rejection. Honor the same null-on-unknown-tool contract
    // as insertTree — return [] — and re-throw any other (genuine-bug) error.
    // Keyed on the error TYPE, not a 'not found' substring.
    try {
      transact(() => {
        result.created = editor.blocks.insertMany(seeded, flatIndex);
      });
    } catch (error) {
      if (error instanceof ToolNotFoundError) {
        return [];
      }
      throw error;
    }

    return result.created
      .map((block) => getById(block.id))
      .filter((node): node is BlockNode => node !== null);
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

  const convert = (
    id: string,
    newType: string,
    dataOverrides?: BlockToolData,
    options?: { caret?: CaretTarget }
  ): void => {
    if (getById(id) === null) {
      return;
    }

    // Core convert is async and rejects when a tool lacks a conversionConfig.
    // Like update, it owns its own history step (no transact). Position the
    // caret only AFTER a successful convert (matching the in-editor keyboard
    // turn-into, which preserves the caret) when the caller asked for it.
    // Swallow the rejection so a non-convertible block is a graceful no-op —
    // and on rejection the caret is left untouched.
    void Promise.resolve(editor.blocks.convert(id, newType, dataOverrides))
      .then((converted) => {
        if (options?.caret !== undefined) {
          // Core convert routes through replace(), which regenerates the block
          // id — the resolved BlockAPI carries the NEW id. Target it (falling
          // back to the original only if a faithless path resolves nothing) so
          // the caret lands in the converted block instead of a stale id.
          const targetId = converted?.id ?? id;

          editor.caret.setToBlock(
            targetId,
            options.caret.position ?? 'default',
            options.caret.offset ?? 0
          );
        }
      })
      .catch(() => undefined);
  };

  const transactWithoutCapture = (fn: () => void): void => {
    if (editor.blocks.transactWithoutCapture !== undefined) {
      editor.blocks.transactWithoutCapture(fn);
    } else {
      fn();
    }
  };

  const getBlocksCount = (): number => {
    onRead();

    return editor.blocks.getBlocksCount();
  };

  const getCurrentBlockIndex = (): number => {
    onRead();

    return editor.blocks.getCurrentBlockIndex();
  };

  const getBlockByIndex = (index: number): BlockNode | null => {
    onRead();
    const block = editor.blocks.getBlockByIndex(index);

    return block === undefined ? null : getById(block.id);
  };

  const getBlockByElement = (element: HTMLElement): BlockNode | null => {
    onRead();
    const block = editor.blocks.getBlockByElement(element);

    return block === undefined ? null : getById(block.id);
  };

  const composeBlockData = (toolName: string): Promise<BlockToolData> =>
    editor.blocks.composeBlockData(toolName);

  const getBlockData = (
    id: string
  ): { data: BlockToolData; tunes: { [name: string]: BlockTuneData } } | null => {
    // Silent existence probe via the snapshot getById (NOT editor.blocks.getById,
    // which logs a `warn` for an unknown id) so a miss is a quiet null, matching
    // getBlockIndex and the other id-taking readers.
    if (getById(id) === null) {
      return null;
    }

    const block = editor.blocks.getById(id);

    if (block === null) {
      return null;
    }

    // preservedData/preservedTunes are core's SYNCHRONOUS last-extracted view —
    // the same snapshot clipboard ops read. Returning it (rather than the async
    // save()) keeps this reader synchronous so a block can be read and re-inserted
    // (duplicated) inside one render/handler without the ref escape hatch.
    return { data: block.preservedData, tunes: block.preservedTunes };
  };

  const getBlockIndex = (id: string): number | null => {
    if (getById(id) === null) {
      // Silent existence probe (NOT editor.blocks.getBlockIndex, which warns on
      // unknown ids) so a miss is a quiet null, matching every other reader.
      return null;
    }

    return editor.blocks.getBlockIndex(id) ?? null;
  };

  const renderFromHTML = (html: string): Promise<void> => editor.blocks.renderFromHTML(html);

  const splitBlock = (
    currentBlockId: string,
    currentBlockData: Partial<BlockToolData>,
    newBlockType: string,
    newBlockData: BlockToolData,
    insertIndex: number
  ): BlockNode | null => {
    // Silent no-op for an unknown current block, matching every other id-taking
    // mutator. Probe via the snapshot getById (NOT getBlockIndex, which warns).
    if (getById(currentBlockId) === null) {
      return null;
    }

    // A negative insertIndex is malformed — core would forward it to a splice
    // (which counts from the array end) and silently split at the wrong slot.
    // Honor the silent-no-op convention instead (consistent with
    // insertOutputData's negative-index guard): return null without touching core.
    if (insertIndex < 0) {
      return null;
    }

    // An unknown newBlockType makes core's compose path throw a typed
    // ToolNotFoundError — honor the null contract (mirroring insert/insertTree);
    // re-throw any other (genuine-bug) error. Keyed on the error TYPE.
    const created = ((): { id: string } | null | undefined => {
      try {
        return editor.blocks.splitBlock(
          currentBlockId,
          currentBlockData,
          newBlockType,
          newBlockData,
          insertIndex
        );
      } catch (error) {
        if (error instanceof ToolNotFoundError) {
          return null;
        }
        throw error;
      }
    })();

    return created === undefined || created === null ? null : getById(created.id);
  };

  const insertOutputData = (
    blocks: OutputBlockData[],
    options?: { index?: number }
  ): BlockNode[] => {
    // An empty batch opens no transaction (no spurious undo boundary).
    if (blocks.length === 0) {
      return [];
    }

    // A negative index is malformed — core throws a bare validation Error. Honor
    // the silent-no-op convention instead: return [] without inserting (no
    // transaction, no surprise end-append), consistent with the rest of the API.
    if (options?.index !== undefined && options.index < 0) {
      return [];
    }

    // ONE transact for the whole batch → a single atomic undo step. Delegates
    // to core's raw insertMany, which honors each block's parent/content links.
    // Honor the same null/[]-on-unknown-tool contract as insertTree (core throws
    // a typed ToolNotFoundError); re-throw any other (genuine-bug) error.
    const result: { created: Array<{ id: string }> } = { created: [] };

    try {
      transact(() => {
        result.created =
          options?.index !== undefined
            ? editor.blocks.insertMany(blocks, options.index)
            : editor.blocks.insertMany(blocks);
      });
    } catch (error) {
      if (error instanceof ToolNotFoundError) {
        return [];
      }
      throw error;
    }

    return result.created
      .map((block) => getById(block.id))
      .filter((node): node is BlockNode => node !== null);
  };

  /**
   * Insert one child block under `parentId` at flat `insertIndex`, atomically.
   * Delegates to core's `insertInsideParent`, which groups the block creation
   * AND the parent assignment into a single undo entry itself — so this is NOT
   * wrapped in the hook's `transact` (that would be a redundant nested group).
   * A dangling parentId is a no-op (null), mirroring `insert`'s parent guard;
   * an unknown child tool throws a typed ToolNotFoundError from core's compose
   * path — honor the null contract and re-throw anything else (genuine bug).
   */
  const insertInsideParent = (
    parentId: string,
    insertIndex: number,
    childData?: BlockToolData
  ): BlockNode | null => {
    // Silent existence probe (NOT getBlockIndex, which warns on unknown ids).
    if (getById(parentId) === null) {
      return null;
    }

    const created = ((): { id: string } | null | undefined => {
      try {
        return editor.blocks.insertInsideParent(parentId, insertIndex, childData);
      } catch (error) {
        if (error instanceof ToolNotFoundError) {
          return null;
        }
        throw error;
      }
    })();

    return created === undefined || created === null ? null : getById(created.id);
  };

  /**
   * Replace the whole document with saved {@link OutputData} — a document-LOAD
   * primitive (clears existing content first), the counterpart of the additive
   * {@link insertOutputData}. Pure delegation to core's async `render`.
   */
  const render = (data: OutputData): Promise<void> => editor.blocks.render(data);

  /** Remove every block — document reset. Pure delegation to core's async `clear`. */
  const clear = (): Promise<void> => editor.blocks.clear();

  /**
   * The LIVE Yjs-sync flag, read at call time (the api handle is memoized, so a
   * cached property would go stale). Pure delegation to core's read-only flag.
   */
  const isSyncingFromYjs = (): boolean => {
    onRead();

    return editor.blocks.isSyncingFromYjs;
  };

  // Every key is listed EXPLICITLY — do NOT spread `...EMPTY_API` here. The
  // return is typed `UseBlocksApi`, so an explicit list makes a forgotten live
  // wiring a COMPILE error (missing property). Spreading EMPTY_API would instead
  // backfill the missing key with its pre-ready no-op stub, silently shipping a
  // method that does nothing when the editor IS ready — a hole no key-presence
  // test can catch (the key is present, just wrong). Keep it exhaustive.
  return {
    getById,
    getChildren,
    insert,
    insertMany,
    insertTree,
    insertMarkdown,
    move,
    nest,
    unnest,
    remove,
    update,
    convert,
    transact,
    transactWithoutCapture,
    getBlocksCount,
    getCurrentBlockIndex,
    getBlockByIndex,
    getBlockByElement,
    getBlockData,
    getBlockIndex,
    composeBlockData,
    renderFromHTML,
    insertOutputData,
    splitBlock,
    insertInsideParent,
    render,
    clear,
    isSyncingFromYjs,
  };
};
