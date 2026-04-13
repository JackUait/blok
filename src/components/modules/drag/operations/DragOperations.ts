/**
 * DragOperations - Handles move and duplicate operations for drag and drop
 */

import { BlockToolAPI } from '../../../block';
import type { Block } from '../../../block';

export interface SavedBlockData {
  data: Record<string, unknown>;
  tunes: Record<string, unknown>;
}

export interface MoveResult {
  movedBlocks: Block[];
  targetIndex: number;
}

export interface DuplicateResult {
  duplicatedBlocks: Block[];
  targetIndex: number;
}

export interface BlockManagerAdapter {
  getBlockIndex(block: Block): number;
  getBlockByIndex(index: number): Block | undefined;
  move(toIndex: number, fromIndex: number, needToFocus: boolean, skipMovedHook?: boolean): void;
  insert(config: {
    tool: string;
    data: Record<string, unknown>;
    tunes: Record<string, unknown>;
    index: number;
    needToFocus: boolean;
  }): Block;
  setBlockParent?(block: Block, parentId: string | null): void;
  getBlockById?(id: string): Block | undefined;
}

export interface YjsManagerAdapter {
  transactMoves(fn: () => void): void;
}

export interface BlockSelectionAdapter {
  clearSelection(): void;
  selectBlock(block: Block): void;
}

export class DragOperations {
  private blockManager: BlockManagerAdapter;
  private yjsManager?: YjsManagerAdapter;
  private blockSelection?: BlockSelectionAdapter;

  constructor(
    blockManager: BlockManagerAdapter,
    yjsManager?: YjsManagerAdapter,
    blockSelection?: BlockSelectionAdapter
  ) {
    this.blockManager = blockManager;
    this.yjsManager = yjsManager;
    this.blockSelection = blockSelection;
  }

  /**
   * Moves blocks to a new position
   * @param sourceBlocks - Blocks to move
   * @param targetBlock - Block to insert before/after
   * @param edge - Edge of target ('top' or 'bottom')
   * @returns Result with moved blocks and target index
   */
  moveBlocks(
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): MoveResult {
    // Stale-reference guard: if any source or the target has been replaced
    // mid-drag (Yjs remote update, blockManager.update, tool conversion),
    // getBlockIndex returns -1. Calling blockManager.move(N, -1) would invoke
    // Array.splice(-1, 1), which removes the LAST block in the array — this
    // is the root cause of the "completely unrelated block dropped" bug.
    // Abort cleanly instead of silently moving the wrong block.
    if (this.blockManager.getBlockIndex(targetBlock) === -1) {
      return { movedBlocks: [], targetIndex: -1 };
    }

    const hasStaleSource = sourceBlocks.some(
      (block) => this.blockManager.getBlockIndex(block) === -1
    );

    if (hasStaleSource) {
      return { movedBlocks: [], targetIndex: -1 };
    }

    if (sourceBlocks.length === 1) {
      return this.moveSingleBlock(sourceBlocks[0], targetBlock, edge);
    }

    return this.moveMultipleBlocks(sourceBlocks, targetBlock, edge);
  }

  /**
   * Duplicates blocks at a new position
   * @param sourceBlocks - Blocks to duplicate
   * @param targetBlock - Block to insert duplicates before/after
   * @param edge - Edge of target ('top' or 'bottom')
   * @returns Result with duplicated blocks and target index
   */
  async duplicateBlocks(
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): Promise<DuplicateResult> {
    // Stale-reference guard (alt+drag variant of the wrong-block-dropped bug).
    // Same failure mode as moveBlocks, different splice: targetIndex === -1
    // produces baseInsertIndex -1 or 0, and Blocks.insert(-1, block) calls
    // Array.splice(-1, 0, block) — inserting the block BEFORE the LAST slot.
    // That silently diverges the flat array from the DOM, so the next move()
    // indexOf lookup points at the wrong slot and drops an unrelated block.
    // Abort cleanly instead of duplicating stale data at the wrong position.
    if (this.blockManager.getBlockIndex(targetBlock) === -1) {
      return { duplicatedBlocks: [], targetIndex: -1 };
    }

    const hasStaleSource = sourceBlocks.some(
      (block) => this.blockManager.getBlockIndex(block) === -1
    );

    if (hasStaleSource) {
      return { duplicatedBlocks: [], targetIndex: -1 };
    }

    // Sort blocks by current index to preserve order
    const sortedBlocks = [...sourceBlocks].sort((a, b) =>
      this.blockManager.getBlockIndex(a) - this.blockManager.getBlockIndex(b)
    );

    // Calculate target insertion point
    const targetIndex = this.blockManager.getBlockIndex(targetBlock);
    const baseInsertIndex = edge === 'top' ? targetIndex : targetIndex + 1;

    // Save all blocks concurrently and filter out failures
    const saveResults = await Promise.all(
      sortedBlocks.map(async (block) => {
        const saved = await block.save();

        if (!saved) {
          return null;
        }

        return {
          saved,
          toolName: block.name,
        };
      })
    );

    const validResults = saveResults.filter(
      (result): result is NonNullable<typeof result> => result !== null
    );

    if (validResults.length === 0) {
      return { duplicatedBlocks: [], targetIndex: baseInsertIndex };
    }

    // Insert duplicated blocks
    const duplicatedBlocks = validResults.map(({ saved, toolName }, index) =>
      this.blockManager.insert({
        tool: toolName,
        data: saved.data,
        tunes: saved.tunes,
        index: baseInsertIndex + index,
        needToFocus: false,
      })
    );

    // Re-establish internal parent-child relationships among duplicated blocks.
    // Build a map: original block id → duplicated block id, so children whose
    // original parent is also being duplicated can be reparented to their
    // corresponding duplicate parent rather than inheriting the drop context.
    if (this.blockManager.setBlockParent !== undefined) {
      const originalIdToDupId = new Map<string, string>();
      const sourceIds = new Set(sortedBlocks.map(b => b.id));

      sortedBlocks.forEach((originalBlock, i) => {
        originalIdToDupId.set(originalBlock.id, duplicatedBlocks[i].id);
      });

      sortedBlocks.forEach((originalBlock, i) => {
        const originalParentId = originalBlock.parentId;

        // Only reparent if the original parent is also part of the duplicated set
        if (originalParentId !== null && sourceIds.has(originalParentId)) {
          const dupParentId = originalIdToDupId.get(originalParentId);

          if (dupParentId !== undefined && this.blockManager.setBlockParent !== undefined) {
            this.blockManager.setBlockParent(duplicatedBlocks[i], dupParentId);
          }
        }
      });
    }

    // Select all duplicated blocks
    const blockSelection = this.blockSelection;
    if (blockSelection) {
      blockSelection.clearSelection();
      duplicatedBlocks.forEach(block => {
        blockSelection.selectBlock(block);
      });
    }

    return { duplicatedBlocks, targetIndex: baseInsertIndex };
  }

  /**
   * Moves a single block to a new position
   */
  private moveSingleBlock(
    sourceBlock: Block,
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): MoveResult {
    const fromIndex = this.blockManager.getBlockIndex(sourceBlock);
    const targetIndex = this.blockManager.getBlockIndex(targetBlock);

    // Calculate the new index based on drop position
    const baseIndex = edge === 'top' ? targetIndex : targetIndex + 1;

    // Adjust index if moving from before the target
    const toIndex = fromIndex < baseIndex ? baseIndex - 1 : baseIndex;

    // Only move if position actually changed
    if (fromIndex === toIndex) {
      return { movedBlocks: [sourceBlock], targetIndex: fromIndex };
    }

    this.blockManager.move(toIndex, fromIndex, false);

    // After the move, sourceBlock may be at a different index than toIndex
    // (e.g. if nested blocks were re-sorted). Use sourceBlock directly.
    const actualIndex = this.blockManager.getBlockIndex(sourceBlock);

    if (!this.blockSelection) {
      return { movedBlocks: [sourceBlock], targetIndex: actualIndex };
    }

    this.blockSelection.selectBlock(sourceBlock);

    return { movedBlocks: [sourceBlock], targetIndex: actualIndex };
  }

  /**
   * Moves multiple blocks to a new position
   */
  private moveMultipleBlocks(
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): MoveResult {
    // Sort blocks by current index
    const sortedBlocks = [...sourceBlocks].sort((a, b) =>
      this.blockManager.getBlockIndex(a) - this.blockManager.getBlockIndex(b)
    );

    // Calculate target insertion point
    const targetIndex = this.blockManager.getBlockIndex(targetBlock);
    const insertIndex = edge === 'top' ? targetIndex : targetIndex + 1;

    // When the move set includes parent-child groups (e.g., table + its cell blocks),
    // only explicitly move the root blocks (those whose parentId is not another block
    // in the same set). DOM-nested children follow their parent automatically, and
    // resortNestedBlocks (called inside blocks.move) re-sorts them in the flat array.
    const sourceIds = new Set(sourceBlocks.map(b => b.id));
    const blocksToMove = sortedBlocks.filter(
      b => b.parentId === null || !sourceIds.has(b.parentId)
    );

    // Determine if we're moving blocks up or down
    const firstBlock = blocksToMove[0] ?? sortedBlocks[0];
    const firstBlockIndex = this.blockManager.getBlockIndex(firstBlock);
    const movingDown = insertIndex > firstBlockIndex;

    // For multi-block moves, group them as a single undo entry using transactMoves
    const isMultiBlockMove = sortedBlocks.length > 1;
    const executeMoves = (): void => {
      if (movingDown) {
        this.moveBlocksDown(blocksToMove, insertIndex);
      } else {
        this.moveBlocksUp(blocksToMove, insertIndex);
      }
    };

    if (isMultiBlockMove && this.yjsManager) {
      this.yjsManager.transactMoves(executeMoves);
    } else {
      executeMoves();
    }

    // Clear selection first, then re-select all moved blocks
    const blockSelection = this.blockSelection;
    if (blockSelection) {
      blockSelection.clearSelection();
      sortedBlocks.forEach(block => {
        blockSelection.selectBlock(block);
      });
    }

    return { movedBlocks: sortedBlocks, targetIndex: insertIndex };
  }

  /**
   * Moves blocks down (to a higher index)
   *
   * Blocks are processed in reverse order so each lands at its exact final position
   * without index-shifting side-effects. The `moved()` lifecycle hook is suppressed
   * during the loop because depth-validators in list items read neighbour depths from
   * the DOM — in intermediate states those neighbours haven't arrived yet, causing
   * depths to be incorrectly capped. After all blocks are in place the hooks are
   * re-triggered in document order (parent → children) so each block sees correct
   * neighbours when it validates.
   */
  private moveBlocksDown(sortedBlocks: Block[], insertIndex: number): void {
    const originalIndices = new Map<Block, number>();

    sortedBlocks.forEach(block => {
      originalIndices.set(block, this.blockManager.getBlockIndex(block));
    });

    const reversedBlocks = [...sortedBlocks].reverse();

    reversedBlocks.forEach((block, index) => {
      const currentIndex = this.blockManager.getBlockIndex(block);
      const targetPosition = insertIndex - 1 - index;

      this.blockManager.move(targetPosition, currentIndex, false, true);
    });

    sortedBlocks.forEach(block => {
      block.call(BlockToolAPI.MOVED, {
        fromIndex: originalIndices.get(block) ?? 0,
        toIndex: this.blockManager.getBlockIndex(block),
        isGroupMove: true,
      });
    });
  }

  /**
   * Moves blocks up (to a lower index)
   *
   * Forward order is used so parent blocks arrive at their target before children,
   * giving depth-validators the correct predecessor. The `moved()` hook is still
   * suppressed during the loop and re-triggered afterward for symmetry with
   * `moveBlocksDown` and to guard against any edge-cases in future reordering.
   */
  private moveBlocksUp(sortedBlocks: Block[], baseInsertIndex: number): void {
    const originalIndices = new Map<Block, number>();

    sortedBlocks.forEach(block => {
      originalIndices.set(block, this.blockManager.getBlockIndex(block));
    });

    sortedBlocks.forEach((block, index) => {
      const currentIndex = this.blockManager.getBlockIndex(block);
      const targetIndex = baseInsertIndex + index;

      if (currentIndex === targetIndex) {
        return;
      }

      this.blockManager.move(targetIndex, currentIndex, false, true);
    });

    sortedBlocks.forEach(block => {
      block.call(BlockToolAPI.MOVED, {
        fromIndex: originalIndices.get(block) ?? 0,
        toIndex: this.blockManager.getBlockIndex(block),
        isGroupMove: true,
      });
    });
  }
}
