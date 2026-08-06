import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { BlockId } from '../../types/data-formats/block-id';
import type { BlockRunSpec, BlockTreeNode, BlockTreeSpec, FlattenTreeOptions } from '../../types/data-formats/block-tree';
import { generateBlockId } from '../components/utils/id-generator';

/** A flattened block with its `id` resolved (generated when the spec omitted one). */
type FlattenedBlock = OutputBlockData & { id: BlockId };

/**
 * Whether a spec node is a pre-flat run (`{ blocks: [...] }`) rather than a
 * tree node. Keyed on the `blocks` array, the only field the two shapes cannot
 * share.
 * @param node - spec node to classify
 */
const isRunSpec = (node: BlockTreeNode): node is BlockRunSpec => {
  return Array.isArray((node as BlockRunSpec).blocks);
};

/**
 * Wire-tolerant id read: `null` and `''` mean "absent", as everywhere else a
 * loaded document is normalized.
 * @param id - id as it arrived on a saved block
 */
const nonEmptyId = (id: string | null | undefined): string | undefined => {
  return typeof id === 'string' && id !== '' ? id : undefined;
};

/**
 * Reject an already-flat block passed where a TREE node is expected. A spec
 * node has no `parent`/`content` fields, so such a block would be flattened
 * with its links silently DROPPED — the structure it described is gone and
 * nothing reports it. Pre-flat blocks belong in a run node instead.
 * @param node - tree node about to be flattened
 * @throws if the node carries link information a tree node cannot express
 */
const assertNotPreFlat = (node: BlockTreeSpec): void => {
  const asFlat = node as OutputBlockData;
  const carriesParent = typeof asFlat.parent === 'string' && asFlat.parent !== '';
  const carriesContent = Array.isArray(asFlat.content) && asFlat.content.length > 0;

  if (carriesParent || carriesContent) {
    throw new Error(
      `flattenTree: block "${node.id ?? '(no id)'}" carries \`parent\`/\`content\` links, which a tree node cannot express — pass pre-flat blocks as a run node: { blocks: [...] }.`
    );
  }
};

/**
 * Flatten a hierarchical block spec (nodes with `children`) into the flat DFS
 * pre-order `OutputBlockData[]` Blok stores, wiring every node's `parent` and
 * `content` id links.
 *
 * This is the pure counterpart of the live `insertTree` mutation: the same DFS,
 * without an editor. Use it to seed nested content — columns, tables, a whole
 * document — without hand-authoring `parent`/`content` arrays:
 *
 * @example
 * new Blok({
 *   data: {
 *     blocks: flattenTree([
 *       { type: 'column_list', children: [
 *         { type: 'column', children: [{ type: 'paragraph', data: { text: 'L' } }] },
 *         { type: 'column', children: [{ type: 'paragraph', data: { text: 'R' } }] },
 *       ] },
 *     ]),
 *   },
 * });
 *
 * Content that is not tree-shaped to begin with — an already-flat saved
 * document a migration is splicing into a page — goes in as a RUN node,
 * `{ blocks: [...] }`, at the root or as a child. A run is spliced verbatim:
 * ids, `data`, `tunes` and existing `parent`/`content` links are kept, and only
 * the blocks it left un-parented are re-parented onto the enclosing node.
 *
 * @example
 * flattenTree({ type: 'column', children: [{ blocks: saved.blocks }] });
 *
 * @param spec - a single root node or an array of root nodes; each is either a
 *   tree node or a pre-flat run.
 * @param options - `parentId` sets the `parent` of the root node(s);
 *   `generateId` overrides id generation for nodes that omit an `id` (default:
 *   Blok's nanoid scheme).
 * @returns DFS pre-order blocks with `parent`/`content` wired. Leaves omit the
 *   empty `content` array, matching the documented `OutputBlockData` shape.
 * @throws if an explicit `id` is reused within the spec — a duplicate id would
 *   corrupt every id-keyed lookup, so it is surfaced loudly rather than encoded
 *   — or if a TREE node carries `parent`/`content` links, which it cannot
 *   express (that is a pre-flat block; wrap it in a run node).
 */
export function flattenTree(
  spec: BlockTreeNode | BlockTreeNode[],
  options: FlattenTreeOptions = {}
): FlattenedBlock[] {
  const generateId = options.generateId ?? generateBlockId;
  const rootParent = options.parentId ?? undefined;

  const flat: FlattenedBlock[] = [];
  const usedIds = new Set<string>();

  /**
   * Resolve a node's id and reserve it. A duplicate would corrupt every
   * id-keyed lookup, so it is surfaced loudly rather than encoded.
   * @param explicitId - id the spec carried, if any
   */
  const claimId = (explicitId: string | undefined): string => {
    const id = explicitId ?? generateId();

    if (usedIds.has(id)) {
      throw new Error(`flattenTree: duplicate block id "${id}" — every block id must be unique.`);
    }
    usedIds.add(id);

    return id;
  };

  /**
   * Splice a pre-flat run in verbatim: every block keeps its id, `data`,
   * `tunes` and its existing `parent`/`content` links, and only the blocks the
   * run left un-parented are re-parented onto the enclosing node. Mirrors
   * `useBlocks.insertMarkdown`, which nests a converted run the same way.
   * @param run - the run node
   * @param parent - id of the node the run is spliced into (undefined at root)
   * @returns ids of the run's top-level blocks, in run order
   */
  const visitRun = (run: BlockRunSpec, parent: string | undefined): string[] => {
    const rootIds: string[] = [];

    for (const block of run.blocks) {
      const { parent: incomingParent, id: incomingId, content: incomingContent, data, ...rest } = block;
      const id = claimId(nonEmptyId(incomingId));
      const incomingParentId = nonEmptyId(incomingParent);
      const isRunRoot = incomingParentId === undefined;
      const resolvedParent = isRunRoot ? parent : incomingParentId;

      flat.push({
        ...rest,
        id,
        data: data ?? {},
        // `null`/`[]` content means "no children" — omitted, like a tree leaf.
        ...(Array.isArray(incomingContent) && incomingContent.length > 0 ? { content: incomingContent } : {}),
        ...(resolvedParent !== undefined ? { parent: resolvedParent } : {}),
      } as FlattenedBlock);

      if (isRunRoot) {
        rootIds.push(id);
      }
    }

    return rootIds;
  };

  // Pre-order DFS: push self FIRST, then recurse each child, so the flat array
  // is DFS-contiguous. `content` is filled as each child is visited and returns
  // its id; it is omitted for leaves.
  const visit = (node: BlockTreeSpec, parent: string | undefined): string => {
    assertNotPreFlat(node);

    const id = claimId(node.id);

    const childIds: string[] = [];
    const flatNode = {
      id,
      // `type` is OMITTED (not present-with-undefined) when absent so core's
      // `type || defaultBlock` fallback resolves the default block cleanly.
      ...(node.type !== undefined ? { type: node.type } : {}),
      data: node.data ?? {},
      ...(node.tunes !== undefined ? { tunes: node.tunes } : {}),
      ...(parent !== undefined ? { parent } : {}),
    } as FlattenedBlock;

    flat.push(flatNode);

    for (const child of node.children ?? []) {
      childIds.push(...(isRunSpec(child) ? visitRun(child, id) : [visit(child, id)]));
    }

    // Only wire `content` when there are children — leaves stay clean.
    if (childIds.length > 0) {
      flatNode.content = childIds;
    }

    return id;
  };

  const roots = Array.isArray(spec) ? spec : [spec];

  for (const root of roots) {
    if (isRunSpec(root)) {
      visitRun(root, rootParent);
    } else {
      visit(root, rootParent);
    }
  }

  return flat;
}
