import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { BlockId } from '../../types/data-formats/block-id';
import type { BlockTreeSpec, FlattenTreeOptions } from '../../types/data-formats/block-tree';
import { generateBlockId } from '../components/utils/id-generator';

/** A flattened block with its `id` resolved (generated when the spec omitted one). */
type FlattenedBlock = OutputBlockData & { id: BlockId };

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
 * @param spec - a single root node or an array of root nodes.
 * @param options - `parentId` sets the `parent` of the root node(s);
 *   `generateId` overrides id generation for nodes that omit an `id` (default:
 *   Blok's nanoid scheme).
 * @returns DFS pre-order blocks with `parent`/`content` wired. Leaves omit the
 *   empty `content` array, matching the documented `OutputBlockData` shape.
 * @throws if an explicit `id` is reused within the spec — a duplicate id would
 *   corrupt every id-keyed lookup, so it is surfaced loudly rather than encoded.
 */
export function flattenTree(
  spec: BlockTreeSpec | BlockTreeSpec[],
  options: FlattenTreeOptions = {}
): FlattenedBlock[] {
  const generateId = options.generateId ?? generateBlockId;
  const rootParent = options.parentId ?? undefined;

  const flat: FlattenedBlock[] = [];
  const usedIds = new Set<string>();

  // Pre-order DFS: push self FIRST, then recurse each child, so the flat array
  // is DFS-contiguous. `content` is filled as each child is visited and returns
  // its id; it is omitted for leaves.
  const visit = (node: BlockTreeSpec, parent: string | undefined): string => {
    const id = node.id ?? generateId();

    if (usedIds.has(id)) {
      throw new Error(`flattenTree: duplicate block id "${id}" — every block id must be unique.`);
    }
    usedIds.add(id);

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
      childIds.push(visit(child, id));
    }

    // Only wire `content` when there are children — leaves stay clean.
    if (childIds.length > 0) {
      flatNode.content = childIds;
    }

    return id;
  };

  const roots = Array.isArray(spec) ? spec : [spec];

  for (const root of roots) {
    visit(root, rootParent);
  }

  return flat;
}
