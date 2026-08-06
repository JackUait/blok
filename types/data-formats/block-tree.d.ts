import { BlockToolData } from '../tools/block-tool-data';
import { BlockTuneData } from '../block-tunes/block-tune-data';
import { LooseOutputBlockData, OutputBlockData } from './output-data';
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
   * Direct children, nested under this node in array order. A child may be a
   * nested node or a {@link BlockRunSpec} splicing already-flat blocks in.
   */
  children?: BlockTreeNode[];
}

/**
 * A run of ALREADY-FLAT saved blocks, spliced into a spec verbatim.
 *
 * The escape hatch for content that is not tree-shaped to begin with — a stored
 * Blok document being migrated into a page, a saved subtree, the output of
 * another `flattenTree` call. {@link flattenTree} emits the run's blocks in the
 * order given, keeping each block's `id`, `data`, `tunes` and its existing
 * `parent`/`content` links, and re-parents ONLY the blocks the run left
 * un-parented (its top-level ones) onto the enclosing node. Internally nested
 * blocks are untouched — the same rule `blocks.insertMarkdown` applies to a
 * converted run.
 *
 * Because nothing is re-derived, ids are stable across runs: a migration can be
 * applied in batches without duplicating blocks it already wrote.
 *
 * @example
 * flattenTree({
 *   type: 'column',
 *   children: [{ blocks: savedDocument.blocks }],
 * });
 */
export interface BlockRunSpec {
  /**
   * Saved blocks, in document order — the strict or the wire-tolerant shape.
   * Blocks are carried through as they are, apart from the normalizations Blok
   * applies to any loaded document: a missing/`null`/empty `id` gets a fresh
   * one, `data` defaults to `{}`, and a `null`/empty `parent` or `content`
   * counts as absent. A duplicate id makes {@link flattenTree} throw.
   */
  blocks: Array<OutputBlockData | LooseOutputBlockData>;
}

/**
 * One node of a spec: either a tree node or a pre-flat run.
 */
export type BlockTreeNode = BlockTreeSpec | BlockRunSpec;

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
 * @param spec - a single root node or an array of root nodes; a node is either
 *   a tree node or a {@link BlockRunSpec} of pre-flat blocks.
 * @param options - see {@link FlattenTreeOptions}.
 * @returns DFS pre-order blocks with `parent`/`content` wired; leaves omit the
 *   empty `content` array. Every returned block has a resolved `id` (generated
 *   when the spec omitted one), so the array is safe to reference by id.
 * @throws if an explicit `id` is reused within the spec, or if a TREE node
 *   carries `parent`/`content` links (pre-flat blocks belong in a run node —
 *   flattening them as tree nodes would drop those links silently).
 */
export function flattenTree(
  spec: BlockTreeNode | BlockTreeNode[],
  options?: FlattenTreeOptions
): Array<OutputBlockData & { id: BlockId }>;
