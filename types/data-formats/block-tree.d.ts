import { BlockToolData } from '../tools/block-tool-data';
import { BlockTuneData } from '../block-tunes/block-tune-data';
import { OutputBlockData } from './output-data';
import { BlockId } from './block-id';

/**
 * A node in a hierarchical block spec: a block plus its nested `children`.
 *
 * This is the ergonomic, tree-shaped input to {@link flattenTree} — you nest
 * `children` instead of hand-wiring the flat `parent`/`content` id arrays that
 * {@link OutputBlockData} stores.
 *
 * @template Data - the shape of this node's `data` (defaults to the guarded
 *   `Record<string, unknown>`).
 */
export interface BlockTreeSpec<Data extends object = Record<string, unknown>> {
  /**
   * Tool type. Omit to let the editor resolve its default block.
   */
  type?: string;

  /**
   * Saved block data for this node.
   */
  data?: BlockToolData<Data>;

  /**
   * Block Tunes data, carried through verbatim.
   */
  tunes?: { [name: string]: BlockTuneData };

  /**
   * Explicit id for this node. Generated when omitted. Must be unique across
   * the whole spec — a duplicate id makes {@link flattenTree} throw.
   */
  id?: string;

  /**
   * Direct children, nested under this node in array order.
   */
  children?: BlockTreeSpec[];
}

/**
 * Options for {@link flattenTree}.
 */
export interface FlattenTreeOptions {
  /**
   * `parent` id assigned to the root node(s). Omit for root-level blocks.
   */
  parentId?: string | null;

  /**
   * Id generator for nodes that omit an `id`. Defaults to Blok's nanoid scheme.
   * Pass a deterministic generator to get reproducible ids (e.g. in tests).
   */
  generateId?: () => string;
}

/**
 * Flatten a hierarchical block spec into the flat DFS pre-order
 * `OutputBlockData[]` Blok stores, wiring every node's `parent`/`content` links.
 *
 * The pure counterpart of the live `insertTree` mutation — the same DFS without
 * an editor — so nested content (columns, tables, whole documents) can be
 * seeded without hand-authoring `parent`/`content` arrays.
 *
 * @param spec - a single root node or an array of root nodes.
 * @param options - see {@link FlattenTreeOptions}.
 * @returns DFS pre-order blocks with `parent`/`content` wired; leaves omit the
 *   empty `content` array. Every returned block has a resolved `id` (generated
 *   when the spec omitted one), so the array is safe to reference by id.
 * @throws if an explicit `id` is reused within the spec.
 */
export function flattenTree(
  spec: BlockTreeSpec | BlockTreeSpec[],
  options?: FlattenTreeOptions
): Array<OutputBlockData & { id: BlockId }>;
