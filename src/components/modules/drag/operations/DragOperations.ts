/**
 * DragOperations - Handles move and duplicate operations for drag and drop
 */

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
  move(toIndex: number, fromIndex: number, needToFocus: boolean): void;
  insert(config: {
    tool: string;
    data: Record<string, unknown>;
    tunes: Record<string, unknown>;
    index: number;
    needToFocus: boolean;
  }): Block;
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

    // Select the moved block to provide visual feedback
    const movedBlock = this.blockManager.getBlockByIndex(toIndex);

    if (!movedBlock || !this.blockSelection) {
      return { movedBlocks: movedBlock ? [movedBlock] : [], targetIndex: toIndex };
    }

    this.blockSelection.selectBlock(movedBlock);

    return { movedBlocks: [movedBlock], targetIndex: toIndex };
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

    // Determine if we're moving blocks up or down
    const firstBlockIndex = this.blockManager.getBlockIndex(sortedBlocks[0]);
    const movingDown = insertIndex > firstBlockIndex;

    // For multi-block moves, group them as a single undo entry using transactMoves
    const isMultiBlockMove = sortedBlocks.length > 1;
    const executeMoves = (): void => {
      if (movingDown) {
        this.moveBlocksDown(sortedBlocks, insertIndex);
      } else {
        this.moveBlocksUp(sortedBlocks, insertIndex);
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
   */
  private moveBlocksDown(sortedBlocks: Block[], insertIndex: number): void {
    // When moving down, start with insertIndex - 1 and decrement for each block
    // This ensures blocks maintain their relative order
    const reversedBlocks = [...sortedBlocks].reverse();

    reversedBlocks.forEach((block, index) => {
      const currentIndex = this.blockManager.getBlockIndex(block);
      const targetPosition = insertIndex - 1 - index;

      this.blockManager.move(targetPosition, currentIndex, false);
    });
  }

  /**
   * Moves blocks up (to a lower index)
   */
  private moveBlocksUp(sortedBlocks: Block[], baseInsertIndex: number): void {
    // Track how many blocks we've inserted to adjust the target index
    sortedBlocks.forEach((block, index) => {
      const currentIndex = this.blockManager.getBlockIndex(block);
      const targetIndex = baseInsertIndex + index;

      if (currentIndex === targetIndex) {
        return;
      }

      this.blockManager.move(targetIndex, currentIndex, false);
    });
  }
}
