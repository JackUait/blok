// src/components/utils/blocks-api.ts
import type { Blok } from '../../../types';
import type { BlockToolData } from '../../../types/tools';
import type { BlockTuneData } from '../../../types/block-tunes/block-tune-data';
import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';
import type { MarkdownImportConfig } from '../../markdown/types';
import { ToolNotFoundError } from '../errors/tool-not-found';

import { flattenTree } from '../../shared/flatten-tree';
import {
  snapshotNodes,
  resolveInsertIndex,
  resolveMoveIndex,
  parentMap,
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
  exportMarkdown: async () => '',
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
 * Read the changed block's id out of a `block changed` payload, tolerating any
 * shape that is not core's `{ event: { detail: { target } } }`.
 * @param payload - whatever the dispatcher handed the listener
 * @returns the target block id, or null when the payload does not carry one
 */
const changedBlockId = (payload: unknown): string | null => {
  const detail = (payload as { event?: { detail?: { target?: { id?: unknown } } } } | undefined)
    ?.event?.detail?.target?.id;

  return typeof detail === 'string' ? detail : null;
};

/**
 * Does a `block changed` event touch the subtree rooted at `withinId`?
 *
 * The reactivity filter behind `useBlocks(editor, { within })` in all three
 * adapters. Without it every consumer of `useBlocks` re-renders on every change
 * anywhere in the document — so a container block that only renders its own
 * children still re-rendered on each keystroke in an unrelated block, and a page
 * of N such containers turned one keystroke into N re-renders.
 *
 * INDETERMINATE READS AS "TOUCHED". The walk resolves ancestry through the LIVE
 * tree, and a removal commonly emits after the block is already gone, so its
 * parent chain cannot be read. Answering `false` there would leave a container
 * rendering a child that no longer exists; answering `true` costs one extra
 * render pass. Same for a payload with no readable target.
 *
 * Ancestry is walked UPWARD one `getById` at a time rather than snapshotted with
 * `parentMap`: this runs on every emission — i.e. on every keystroke — so it must
 * cost O(depth), not O(document).
 * @param editor - the live Blok instance
 * @param payload - the `block changed` payload
 * @param withinId - id of the block whose subtree is the scope
 * @returns true when the change is inside the scope (or cannot be placed)
 */
export const changeTouchesSubtree = (
  editor: Blok,
  payload: unknown,
  withinId: string
): boolean => {
  const targetId = changedBlockId(payload);

  if (targetId === null) {
    return true;
  }

  /** Ids already visited on this walk — one Set for the whole climb. */
  const seen = new Set<string>();

  /**
   * Walk one link up the parentId chain.
   * @param id - the block to test, or null once the root is passed
   * @returns true when `withinId` is `id` or one of its ancestors
   */
  const climbs = (id: string | null): boolean => {
    if (id === null) {
      return false;
    }

    if (id === withinId) {
      return true;
    }

    // A parentId cycle is a corrupt tree, not a scope hit — bail rather than spin.
    if (seen.has(id)) {
      return false;
    }

    seen.add(id);

    const node = editor.blocks.getById(id);

    // The target (or one of its ancestors) is no longer in the tree.
    if (node === null || node === undefined) {
      return true;
    }

    return climbs(node.parentId);
  };

  return climbs(targetId);
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

  /**
   * Run a core placement call, turning a refused place into a no-op. Core's
   * `insertAt`/`moveTo` throw a `BlockPlacementError` for a missing block, a
   * cycle, or a parent that refuses the block; the hook's contract is a
   * silent no-op there. Matched by name, not `instanceof`, so a copy of the
   * class from another bundle still matches.
   * @param run - the core call
   * @returns its result, or null when core refused the place
   */
  const placeOrSkip = <T>(run: () => T): T | null => {
    try {
      return run();
    } catch (error) {
      if (error instanceof Error && error.name === 'BlockPlacementError') {
        return null;
      }
      throw error;
    }
  };

  /** Whether `id` is a direct child of a `column`. */
  const isColumnChild = (id: string): boolean => {
    const parent = getById(id)?.parentId ?? null;

    return parent !== null && getById(parent)?.type === 'column';
  };

  /**
   * Nest `id` (and its whole subtree) under `parentId` as its last child, as
   * one undo step. No-op when either id is unknown, when `parentId` is `id`
   * itself or one of its descendants, or when the parent refuses the block.
   * Nesting out of a `column` or directly into one is a no-op too: column
   * membership belongs to the drag UI. Returns void.
   */
  const nest = (id: string, parentId: string): void => {
    if (isColumnChild(id) || getById(parentId)?.type === 'column') {
      return;
    }

    placeOrSkip(() => editor.blocks.moveTo(id, { parentId, position: 'end' }));
  };

  /**
   * Promote `id` (and its subtree) to root, right after its top-level
   * ancestor's subtree, as one undo step. No-op when the id is unknown or
   * already at root, and for a `column` member (column membership changes go
   * through the drag UI). Returns void.
   */
  const unnest = (id: string): void => {
    const parentOf = parentMap(reader);
    const topLevelAncestor = (cursor: string, seen: Set<string>): string => {
      const parent = parentOf.get(cursor) ?? null;

      return parent === null || seen.has(parent) ? cursor : topLevelAncestor(parent, seen.add(cursor));
    };
    const parentId = parentOf.get(id) ?? null;

    if (parentId === null || isColumnChild(id)) {
      return;
    }

    const anchor = topLevelAncestor(parentId, new Set<string>([id]));

    placeOrSkip(() => editor.blocks.moveTo(id, { parentId: null, position: { after: anchor } }));
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
   * Move `id` to a sibling slot or a flat index. No-op when `id` is unknown.
   *
   * `before`/`after` make the block a SIBLING of the ref: it takes the ref's
   * parent, and `after` lands past the ref's whole subtree. The block carries
   * its whole subtree, as one undo step. A ref that is missing, the block
   * itself, or inside its subtree is a no-op, as is a move that core refuses
   * (column membership, a parent that does not take the block).
   *
   * `{ toIndex }` is an absolute flat index (clamped into range); the block
   * takes the parent of the slot it lands in. It is a no-op for a block that
   * HAS descendants: a multi-block subtree cannot land on one index — use
   * `{ before|after }` for that. Returns void.
   */
  const move = (id: string, target: MoveTarget): void => {
    if (!('toIndex' in target)) {
      placeOrSkip(() => editor.blocks.moveTo(id, { position: target }));

      return;
    }

    // Silent existence probe (NOT getBlockIndex, which warns on unknown ids).
    if (getById(id) === null || collectSubtreeIds(id).length > 1) {
      return;
    }

    const fromIndex = editor.blocks.getBlockIndex(id);

    if (fromIndex !== undefined) {
      editor.blocks.move(resolveMoveIndex(reader, target), fromIndex);
    }
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
    // The tree can't change until `editor.blocks.insertAt` runs below, so take
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
    //     nothing to overwrite — return null.
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
    // must be a no-op (return null), NOT the append-at-end fallback below for a
    // ref under another parent. (Skipped under replace: the block above already
    // validated the replace ref.)
    if (!replace && typeof position === 'object') {
      const positionTargetRef = 'before' in position ? position.before : position.after;

      if (probe(positionTargetRef) === null) {
        return { node: null, created: false };
      }
    }

    const ref = ((): string | null => {
      if (typeof position !== 'object') {
        return null;
      }

      return 'before' in position ? position.before : position.after;
    })();
    const options = replace && ref !== null
      ? { replace: ref, id: spec.id, tunes: spec.tunes, focus: needToFocus }
      : {
          parentId,
          // before/after is relative to a child of `parentId`. A ref under
          // another parent falls back to the end of `parentId` (documented).
          position: ref !== null && probe(ref)?.parentId !== parentId ? 'end' : position,
          id: spec.id,
          tunes: spec.tunes,
          focus: needToFocus,
        };

    const created = ((): { id: string } | null => {
      try {
        return placeOrSkip(() => editor.blocks.insertAt(spec.type, data, options));
      } catch (error) {
        // An unknown tool is an expected outcome (null); anything else is a bug.
        if (error instanceof ToolNotFoundError) {
          return null;
        }
        throw error;
      }
    })();

    if (created === null) {
      return { node: null, created: false };
    }

    const node = snapshotNodes(reader).find((n) => n.id === created.id) ?? null;

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

    // Flatten the nested spec to a DFS pre-order array with wired
    // `parent`/`content` links — the same transform used to seed nested data,
    // shared as the pure `flattenTree` helper. `parentId` becomes the root's
    // `parent`. flattenTree throws on an id reused WITHIN the spec (a duplicate
    // would corrupt every id-keyed lookup); a tree insert always creates fresh
    // blocks (NOT insert-if-absent), so that is rejected up front — null,
    // mirroring insert's null contract.
    const flat = (() => {
      try {
        return flattenTree(spec, { parentId: parentId ?? undefined });
      } catch {
        return null;
      }
    })();

    if (flat === null) {
      return null;
    }

    // External collision: an explicit id already present in the live tree would
    // also create a duplicate-id block. Snapshot the existing ids once and
    // reject if any flat node reuses one. Generated ids never collide.
    const existingIds = new Set(snapshotNodes(reader).map((n) => n.id));

    if (flat.some((node) => existingIds.has(node.id))) {
      return null;
    }

    const rootId = flat[0].id;

    // flattenTree omits `content` on leaves (clean seed-data shape). insertMany
    // wants every node to carry an explicit child-id array — a leaf's
    // `contentIds: []` states "no children" rather than leaving it undefined —
    // so stamp the empty array back on before handing the batch to core.
    for (const node of flat) {
      if (node.content === undefined) {
        node.content = [];
      }
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

  const transactWithoutCapture = (fn: () => void, options?: { derivedFrom?: string; from?: readonly string[] }): void => {
    if (editor.blocks.transactWithoutCapture !== undefined) {
      editor.blocks.transactWithoutCapture(fn, options);
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
   * Serialize the document to Markdown — the read-side twin of
   * {@link UseBlocksApi.insertMarkdown}. Pure delegation to core's async
   * `exportMarkdown` (which lazy-loads the serializer).
   */
  const exportMarkdown = (): Promise<string> => editor.blocks.exportMarkdown();

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
    exportMarkdown,
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
