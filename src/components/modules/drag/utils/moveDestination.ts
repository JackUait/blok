import type { Block } from '../../../block';

export type VerticalDropEdge = 'top' | 'bottom';

export interface MoveDestination {
  rawInsertionIndex: number;
  finalFirstIndex: number;
  total: number;
  footprint: readonly Block[];
  sourceRoots: readonly Block[];
}

interface MoveParticipants {
  targetIndex: number;
  footprint: readonly Block[];
  sourceRoots: readonly Block[];
}

const uniqueBlocks = (blocks: readonly Block[]): Block[] =>
  blocks.filter((block, index) => blocks.indexOf(block) === index);

const isCarriedByRoot = (
  block: Block,
  root: Block
): boolean =>
  block === root || root.holder.contains(block.holder);

const hasSourceIdAncestor = (
  block: Block,
  sourceIds: ReadonlySet<string>,
  blockById: ReadonlyMap<string, Block>
): boolean => {
  const state = { parentId: block.parentId };
  const visited = new Set<string>();

  while (state.parentId !== null) {
    if (sourceIds.has(state.parentId)) {
      return true;
    }

    if (visited.has(state.parentId)) {
      return false;
    }

    visited.add(state.parentId);
    state.parentId = blockById.get(state.parentId)?.parentId ?? null;
  }

  return false;
};

/**
 * Returns whether `block` has any source block in its logical parent chain.
 * The walk is transitive and cycle-safe so it also handles non-contiguous
 * selections whose intermediate parent is not itself dragged.
 */
export const hasLogicalSourceAncestor = (
  blocks: readonly Block[],
  sourceBlocks: readonly Block[],
  block: Block
): boolean =>
  hasSourceIdAncestor(
    block,
    new Set(sourceBlocks.map(source => source.id)),
    new Map(blocks.map(candidate => [candidate.id, candidate]))
  );

const resolveMoveParticipants = (
  blocks: readonly Block[],
  sourceBlocks: readonly Block[],
  targetBlock: Block
): MoveParticipants | null => {
  const deduplicatedSources = uniqueBlocks(sourceBlocks);
  const blockById = new Map(blocks.map(block => [block.id, block]));
  const targetIndex = blocks.indexOf(targetBlock);
  const hasStaleSource = deduplicatedSources.some(block => !blocks.includes(block));

  if (targetIndex === -1 || deduplicatedSources.length === 0 || hasStaleSource) {
    return null;
  }

  const sourceRoots = deduplicatedSources
    .filter(block =>
      !deduplicatedSources.some(
        candidate =>
          candidate !== block && candidate.holder.contains(block.holder)
      )
    )
    .sort((left, right) => blocks.indexOf(left) - blocks.indexOf(right));
  const footprint = blocks.filter(block =>
    sourceRoots.some(root => isCarriedByRoot(block, root))
  );
  const sourceIds = new Set(deduplicatedSources.map(block => block.id));

  if (
    sourceRoots.length === 0
    || footprint.includes(targetBlock)
    || hasSourceIdAncestor(targetBlock, sourceIds, blockById)
  ) {
    return null;
  }

  return {
    targetIndex,
    footprint,
    sourceRoots,
  };
};

/**
 * Returns whether a move target is live and outside every explicit, physical,
 * and logical source subtree. This validation also applies to horizontal drops,
 * whose execution does not use a flat insertion index.
 */
export const isMoveTargetValid = (
  blocks: readonly Block[],
  sourceBlocks: readonly Block[],
  targetBlock: Block
): boolean =>
  resolveMoveParticipants(blocks, sourceBlocks, targetBlock) !== null;

/**
 * Resolves a vertical move against the pre-move flat block array.
 *
 * The target edge identifies an insertion boundary before sources are removed.
 * The first moved block's final index is that raw boundary minus every member
 * of the moved footprint that lies before it. The footprint includes nested
 * descendants carried implicitly when BlockManager moves a container root.
 */
export const resolveMoveDestination = (
  blocks: readonly Block[],
  sourceBlocks: readonly Block[],
  targetBlock: Block,
  edge: VerticalDropEdge
): MoveDestination | null => {
  const participants = resolveMoveParticipants(blocks, sourceBlocks, targetBlock);

  if (participants === null) {
    return null;
  }

  const rawInsertionIndex =
    participants.targetIndex + (edge === 'bottom' ? 1 : 0);
  const removedBeforeInsertion = participants.footprint.filter(
    block => blocks.indexOf(block) < rawInsertionIndex
  ).length;
  const finalFirstIndex = rawInsertionIndex - removedBeforeInsertion;

  if (finalFirstIndex < 0 || finalFirstIndex >= blocks.length) {
    return null;
  }

  return {
    rawInsertionIndex,
    finalFirstIndex,
    total: blocks.length,
    footprint: participants.footprint,
    sourceRoots: participants.sourceRoots,
  };
};
