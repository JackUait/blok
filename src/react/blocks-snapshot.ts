import type { BlockToolData } from '../../types/tools';
import type { BlockTuneData } from '../../types/block-tunes/block-tune-data';
import type { MarkdownImportConfig } from '../markdown/types';

/**
 * A plain, serializable view of one block in the tree.
 *
 * Snapshot-volatile: every read allocates a fresh `BlockNode`, and `contentIds`
 * is DERIVED per read from the children that currently name this block as parent
 * (it is not a stored field). Read a node in render and re-read after a change —
 * don't stash one in a `useMemo`/`useEffect` dependency array expecting stable
 * identity; depend on the `id` instead.
 */
export interface BlockNode {
  id: string;
  type: string;
  parentId: string | null;
  contentIds: readonly string[];
}

/** Where to place a block among its siblings. */
export type InsertPosition = 'start' | 'end' | { before: string } | { after: string };

export interface InsertSpec {
  type?: string;
  data?: BlockToolData;
  parentId?: string | null;
  position?: InsertPosition;
  /**
   * Move the caret into the new block. Defaults to `false`: a programmatic
   * insert from React must not steal focus from wherever the user is typing.
   * Set `true` for an explicit "add a block and start editing it" flow.
   */
  focus?: boolean;
  /**
   * Replace the block at the resolved slot instead of inserting a new one — a
   * programmatic "turn into". Combine with a `position` that targets the block
   * to replace, e.g. `{ position: { before: id }, replace: true }`.
   */
  replace?: boolean;
  /**
   * Explicit id for the new block (generated when omitted). Passing a stable id
   * makes the insert idempotent: if a block with this id already exists the
   * existing node is returned and nothing is inserted ("insert if absent"),
   * so an effect that re-runs won't create duplicates.
   */
  id?: string;
  /** Block tune data to apply at creation, keyed by tune name. */
  tunes?: { [name: string]: BlockTuneData };
}

/**
 * One node of a pre-built nested subtree for {@link UseBlocksApi.insertTree}.
 *
 * Each node maps to one block; `children` are inserted nested under it (their
 * `parentId` set to this node's id) in array order, recursively. Placement
 * options (`parentId`/`position`) are ROOT-ONLY — they position the whole
 * subtree among existing blocks and are ignored on nested children, whose parent
 * is always their enclosing node.
 */
export interface TreeInsertSpec {
  type?: string;
  data?: BlockToolData;
  tunes?: { [name: string]: BlockTuneData };
  /**
   * Explicit id for this node (generated when omitted). Unlike `insert`, this is
   * NOT insert-if-absent: a tree insert always creates fresh blocks. A colliding
   * id — one that already exists in the document, or is reused by another node
   * in the same spec — is REJECTED up front: nothing is inserted and `insertTree`
   * returns `null` (a duplicate id would corrupt every id-keyed lookup).
   */
  id?: string;
  /** Direct children, inserted nested under this node, in array order. */
  children?: TreeInsertSpec[];
  /** Root-only: where to place the whole subtree. Ignored on nested children. */
  parentId?: string | null;
  /** Root-only: slot among siblings of `parentId`. Ignored on nested children. */
  position?: InsertPosition;
}

/**
 * Where to move an existing block.
 *
 * `before`/`after` are POSITION targets, not parent assignments: the block is
 * relocated to that flat slot and — because Blok keeps the flat array as the
 * canonical document order — ADOPTS the parent of wherever it lands. Moving a
 * nested block to `{ after: someRootBlock }` therefore unnests it to root, and
 * moving a root block in among a container's children nests it. Use
 * `nest`/`unnest` when you want to change the parent without choosing a sibling
 * slot. `toIndex` is an absolute flat index (clamped into range).
 */
export type MoveTarget = { before: string } | { after: string } | { toIndex: number };

export interface UseBlocksApi {
  getById(id: string): BlockNode | null;
  getChildren(parentId: string | null): BlockNode[];
  /**
   * Insert one block; returns the created node or null when rejected (unknown
   * tool type, dangling `parentId`, or a `replace` whose target is missing). An
   * explicit `id` that already exists is insert-if-absent (returns the existing
   * node, creates nothing). Atomic — one undo step. The returned node is
   * {@link BlockNode}-volatile; read it now, don't put it in a dep array.
   */
  insert(spec?: InsertSpec): BlockNode | null;
  /**
   * Insert several blocks atomically, in array order, as ONE undo step. Each
   * spec is a full {@link InsertSpec} (own type/data/parentId/position), routed
   * through the same single-`insert` path, so per-spec parent assertion and
   * positioning still apply. Specs that fail to insert (e.g. a dangling
   * parentId, or a replace whose target is missing) are dropped; the returned
   * array holds only the successfully created nodes. An empty input is a no-op
   * (returns `[]`, opens no transaction). Like `insert`, the returned nodes are
   * fresh-snapshot volatile — read them now, don't stash them in dep arrays.
   */
  insertMany(specs: InsertSpec[]): BlockNode[];
  /**
   * Insert a pre-built NESTED subtree in ONE atomic operation (one undo step).
   * Each {@link TreeInsertSpec} node becomes a block; its `children` are inserted
   * nested under it (recursively, in array order) so the whole hierarchy lands in
   * a single call — no follow-up `nest` round-trips. Delegates to core's
   * tree-aware `blocks.insertMany`, which composes the flat DFS pre-order array
   * honoring each node's `parent`/`content` links.
   *
   * Placement is root-only: the root node's `parentId`/`position` position the
   * whole subtree among existing blocks (default: appended at the document end);
   * nested children ignore those fields (their parent is their enclosing node). A
   * dangling root `parentId` is rejected — nothing is inserted and `null` is
   * returned (mirrors {@link insert}). Returns the root {@link BlockNode}, which
   * is fresh-snapshot volatile — read it now, don't stash it in a dep array.
   */
  insertTree(spec: TreeInsertSpec): BlockNode | null;
  /**
   * Convert a Markdown string to blocks and insert them ADDITIVELY at a
   * position, WITHOUT clearing the document (unlike core's `importMarkdown` /
   * `renderFromHTML`, which replace the whole document). This is the React
   * "paste markdown → blocks appear" path.
   *
   * Async: the markdown converter is lazy-loaded (kept out of the main bundle),
   * so this is the ONE async creator in the API — `await` the returned promise.
   * The whole batch is inserted as a single atomic undo step.
   *
   * `position` (default `'end'`) places the converted run among `parentId`'s
   * children (or root siblings when `parentId` is omitted/null), reusing the
   * same `start`/`end`/`before`/`after` semantics as {@link insert}.
   *
   * `parentId` (default `null` = root) nests the import: every TOP-LEVEL
   * converted block (one the converter left un-parented) is reparented under
   * `parentId`, while blocks the markdown nested internally (e.g. table-cell
   * children) keep their intra-import parent. A dangling `parentId` is a no-op
   * (returns `[]`, opens no transaction), matching {@link insert}.
   *
   * `config` (optional {@link MarkdownImportConfig}) is forwarded to the
   * converter so custom-tool consumers can map markdown nodes into their tools
   * (`toolMap`/`onUnknownNode`), toggle GFM, or add micromark/mdast extensions.
   *
   * Returns ALL created {@link BlockNode}s in document order — including any the
   * markdown nested internally (e.g. a table's cell children), not just the
   * top-level run (this differs from {@link insertTree}, which returns only the
   * root). Empty or whitespace-only markdown, a dangling `parentId` (checked
   * again after the async convert, so a parent removed mid-flight also no-ops),
   * and a converter failure (chunk-load or parse error, swallowed) all return
   * `[]` and open no transaction. The nodes are fresh-snapshot volatile — read
   * them now, don't stash them in dep arrays.
   */
  insertMarkdown(
    markdown: string,
    options?: { parentId?: string | null; position?: InsertPosition; config?: MarkdownImportConfig }
  ): Promise<BlockNode[]>;
  move(id: string, target: MoveTarget): void;
  nest(id: string, parentId: string): void;
  unnest(id: string): void;
  remove(id: string): void;
  /**
   * Update a block's data and/or tunes by id. Delegates to core's async
   * `blocks.update`, which forms its OWN undo step — the call is NOT wrapped in
   * `transact` (that would close the group before the async write lands). An
   * unknown id is a silent no-op; a rejected update is swallowed so it can't
   * surface as an unhandled rejection. Reads refresh reactively once core emits
   * 'block changed'. Returns `void`.
   */
  update(id: string, data?: BlockToolData, tunes?: { [name: string]: BlockTuneData }): void;
  /**
   * Convert a block to another type ("turn into") by id. Delegates to core's
   * async `blocks.convert`; both tools must provide a `conversionConfig` or core
   * rejects — that rejection (and any other) is swallowed so a non-convertible
   * block is a graceful no-op rather than an unhandled rejection. An unknown id
   * is a silent no-op. Not wrapped in `transact` (core owns its history step).
   * Returns `void`.
   */
  convert(id: string, newType: string, dataOverrides?: BlockToolData): void;
  transact(fn: () => void): void;
}

/** The minimal slice of editor.blocks that the snapshot helpers read. */
export interface BlocksReader {
  getBlocksCount(): number;
  getBlockByIndex(index: number): { id: string; name: string; parentId: string | null } | undefined;
}

/**
 * Enumerate the editor's blocks once into BlockNode records, in flat order,
 * deriving each node's contentIds from the children that name it as parent.
 */
export const snapshotNodes = (reader: BlocksReader): BlockNode[] => {
  const count = reader.getBlocksCount();
  const flat = Array.from({ length: count }, (_, i) => reader.getBlockByIndex(i))
    .filter((b): b is { id: string; name: string; parentId: string | null } => b !== undefined)
    .map((b) => ({ id: b.id, type: b.name, parentId: b.parentId }));

  const childrenByParent = new Map<string, string[]>();

  for (const b of flat) {
    if (b.parentId === null) {
      continue;
    }
    const bucket = childrenByParent.get(b.parentId) ?? [];

    bucket.push(b.id);
    childrenByParent.set(b.parentId, bucket);
  }

  return flat.map((b) => ({
    id: b.id,
    type: b.type,
    parentId: b.parentId,
    contentIds: childrenByParent.get(b.id) ?? [],
  }));
};

/** BlocksReader plus id→flat-index lookup. */
export interface IndexReader extends BlocksReader {
  getBlockIndex(id: string): number | undefined;
}

/** Flat indices of a parent's direct children, ascending. Empty if none. */
const childFlatIndices = (reader: IndexReader, parentId: string): number[] => {
  const count = reader.getBlocksCount();

  return Array.from({ length: count }, (_, i) => i).filter(
    (i) => reader.getBlockByIndex(i)?.parentId === parentId
  );
};

/** Map of block id -> parentId, in flat order. */
export const parentMap = (reader: IndexReader): Map<string, string | null> => {
  const count = reader.getBlocksCount();
  const entries = Array.from({ length: count }, (_, i) => reader.getBlockByIndex(i))
    .filter((b): b is { id: string; name: string; parentId: string | null } => b !== undefined)
    .map((b): [string, string | null] => [b.id, b.parentId]);

  return new Map(entries);
};

/** True if `id` descends from `ancestorId` via the parentId chain. */
export const isDescendantOf = (
  parentOf: Map<string, string | null>,
  id: string,
  ancestorId: string
): boolean => {
  const parent = parentOf.get(id) ?? null;

  if (parent === null) {
    return false;
  }

  return parent === ancestorId || isDescendantOf(parentOf, parent, ancestorId);
};

/**
 * The flat index of the last block in the contiguous subtree rooted at `index`.
 * In flat (DFS) order a block's descendants sit immediately after it, so this
 * walks forward while blocks remain descendants of the block at `index`.
 * Returns `index` itself when the block has no descendants.
 */
const subtreeEndIndex = (reader: IndexReader, index: number): number => {
  const root = reader.getBlockByIndex(index);

  if (root === undefined) {
    return index;
  }

  const parentOf = parentMap(reader);
  const count = reader.getBlocksCount();
  // Walk forward from index+1 while blocks remain descendants (DFS contiguity).
  // The subtree ends just before the first non-descendant, or at the last block
  // when every follower is a descendant.
  const followers = Array.from({ length: count - (index + 1) }, (_, k) => index + 1 + k);
  const breakAt = followers.find((i) => {
    const b = reader.getBlockByIndex(i);

    return b === undefined || !isDescendantOf(parentOf, b.id, root.id);
  });

  return breakAt === undefined ? count - 1 : breakAt - 1;
};

/**
 * The flat index at which a new block should be inserted.
 *
 * `replace` flips the meaning of a before/after `position`: under replace the
 * ref IS the block being overwritten (a "turn into"), not a sibling anchor, so
 * it resolves to the ref's OWN flat slot regardless of which parent it lives in
 * — bypassing the sibling-relative parent guard that would otherwise redirect a
 * nested target to the requested parent's end and replace the wrong block.
 */
export const resolveInsertIndex = (
  reader: IndexReader,
  parentId: string | null,
  position: InsertPosition,
  replace = false
): number => {
  if (typeof position === 'object') {
    const ref = 'before' in position ? position.before : position.after;
    const refIndex = reader.getBlockIndex(ref);

    if (replace && refIndex !== undefined) {
      return refIndex;
    }

    const refParent =
      refIndex === undefined ? undefined : reader.getBlockByIndex(refIndex)?.parentId ?? null;

    // before/after is sibling-relative: the ref must be a child of the requested
    // parent. When the ref is missing or lives in a DIFFERENT parent, the
    // parentId constraint wins — fall back to appending at the end of the
    // requested parent rather than splicing into an unrelated subtree (the
    // cross-parent mis-place) or silently landing at the document end.
    if (refIndex === undefined || refParent !== parentId) {
      return resolveInsertIndex(reader, parentId, 'end');
    }

    // 'after' must clear the ref's entire subtree, not just the ref node, or the
    // new block splits the ref's descendants in flat (DFS) order.
    return 'before' in position ? refIndex : subtreeEndIndex(reader, refIndex) + 1;
  }

  if (parentId === null) {
    return position === 'start' ? 0 : reader.getBlocksCount();
  }

  const parentIndex = reader.getBlockIndex(parentId);

  if (parentIndex === undefined) {
    return reader.getBlocksCount();
  }

  if (position === 'start') {
    const childIndices = childFlatIndices(reader, parentId);

    return childIndices.length === 0 ? parentIndex + 1 : childIndices[0];
  }

  // 'end': insert after the parent's last descendant.
  return subtreeEndIndex(reader, parentIndex) + 1;
};

/** The flat toIndex for editor.blocks.move. */
export const resolveMoveIndex = (reader: IndexReader, target: MoveTarget): number => {
  if ('toIndex' in target) {
    // Blok's Blocks.move() silently no-ops on an out-of-range index, so clamp
    // an explicit toIndex into [0, count-1] rather than dropping the move.
    const lastIndex = Math.max(0, reader.getBlocksCount() - 1);

    return Math.min(Math.max(target.toIndex, 0), lastIndex);
  }

  const ref = 'before' in target ? target.before : target.after;
  const refIndex = reader.getBlockIndex(ref);

  if (refIndex === undefined) {
    return reader.getBlocksCount();
  }

  // 'after' must clear the ref's entire subtree (see resolveInsertIndex), or the
  // moved block lands among the ref's descendants instead of past them.
  return 'before' in target ? refIndex : subtreeEndIndex(reader, refIndex) + 1;
};
