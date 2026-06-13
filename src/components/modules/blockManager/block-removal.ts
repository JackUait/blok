/**
 * @class BlockRemoval
 * @classdesc Block removal: deleting blocks and tearing down / promoting their
 * descendants depending on the container kind.
 * @module BlockRemoval
 */
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import type { Block } from '../../block';
import { moveElementBefore } from '../../utils/html';
import type { BlockRepository } from './repository';
import type { BlockDidMutated, BlockOperationsDependencies, OperationsContext } from './operations-context';
import type { BlocksStore } from './types';

/**
 * Handles block removal, including the columns-subtree teardown and the
 * promote-children-to-root behaviour for non-columns containers. Reads/writes
 * shared state via the OperationsContext.
 */
export class BlockRemoval {
  private readonly ctx: OperationsContext;

  /**
   * @param ctx - Shared operations context (state + cross-cutting helpers)
   */
  constructor(ctx: OperationsContext) {
    this.ctx = ctx;
  }

  private get dependencies(): BlockOperationsDependencies {
    return this.ctx.dependencies;
  }

  private get repository(): BlockRepository {
    return this.ctx.repository;
  }

  private get blockDidMutated(): BlockDidMutated {
    return this.ctx.blockDidMutated;
  }

  /**
   * Remove passed Block
   * @param block - Block to remove
   * @param addLastBlock - If true, inserts a new default block when the last block is removed
   * @param skipYjsSync - If true, skip syncing to Yjs
   * @param blocksStore - The blocks store to modify
   */
  public removeBlock(block: Block, addLastBlock = true, skipYjsSync = false, blocksStore: BlocksStore): Promise<void> {
    return new Promise((resolve) => {
      const index = this.repository.getBlockIndex(block);

      /**
       * If index is not passed and there is no block selected, show a warning
       */
      if (!this.repository.validateIndex(index)) {
        throw new Error('Can\'t find a Block to remove');
      }

      // Clean up parent's contentIds before removing the block
      const parentBlock = block.parentId !== null
        ? this.repository.getBlockById(block.parentId)
        : undefined;

      if (parentBlock !== undefined) {
        parentBlock.contentIds = parentBlock.contentIds.filter(id => id !== block.id);
      }

      /**
       * Removing a columns wrapper (`column` or `column_list`) drops its ENTIRE
       * descendant subtree rather than promoting children to root.
       *
       * A column / column_list is pure layout: its children only make sense
       * inside it. Promoting them (the generic toggle/callout behaviour below)
       * leaks the deleted column's content out to the document root and — for a
       * nested column_list — strands structurally-invalid `column` blocks at
       * root (a column may only live inside a column_list). The flat blocks
       * array is the Saver's source of truth, so descendants left in it
       * resurface in the output even though their holders were detached when the
       * wrapper's holder was removed. Splice the whole subtree out so nothing
       * survives orphaned.
       *
       * Other container tools (toggle, callout, toggleable header) keep the
       * promote-to-root behaviour: deleting the container preserves its body.
       */
      const isColumnsWrapper = block.name === 'column' || block.name === 'column_list';
      const descendants = isColumnsWrapper ? this.collectDescendants(block) : [];

      if (isColumnsWrapper) {
        // Detach every block in the subtree first so a nested column /
        // column_list descendant's removed() hook finds no children and its
        // auto-unwrap is a no-op while we tear the subtree down.
        for (const descendant of descendants) {
          descendant.parentId = null;
          descendant.contentIds = [];
        }
      } else {
        // Promote children to root level when a (non-columns) parent block is removed
        this.promoteChildrenToRoot(block, block.contentIds);
      }

      blocksStore.remove(index);

      // Splice the columns subtree's descendants out of the flat array + Yjs.
      // The wrapper's holder.remove() above already detached their DOM; this
      // removes their model entries so the Saver never re-emits them.
      for (const descendant of descendants) {
        const descendantIndex = this.repository.getBlockIndex(descendant);

        if (descendantIndex < 0) {
          continue;
        }

        blocksStore.remove(descendantIndex);

        if (!skipYjsSync) {
          this.dependencies.YjsManager.removeBlock(descendant.id);
        }
      }

      /**
       * Force call of didMutated event on Block removal
       */
      this.blockDidMutated(BlockRemovedMutationType, block, {
        index,
      });

      /**
       * Sync to Yjs data layer (unless caller is handling sync separately)
       */
      if (!skipYjsSync) {
        this.dependencies.YjsManager.removeBlock(block.id);
      }

      const noBlocksLeft = this.repository.length === 0;

      // Update currentBlockIndex based on what was removed
      if (this.ctx.rawCurrentBlockIndex >= index) {
        this.ctx.currentBlockIndexValue--;
      }

      /**
       * If all blocks were removed, insert a new default block
       */
      if (noBlocksLeft && addLastBlock) {
        this.ctx.insert({}, blocksStore);

        resolve();

        return;
      }

      // If all blocks removed and no default block was added, unset current block
      if (noBlocksLeft) {
        this.ctx.currentBlockIndexValue = -1;

        resolve();

        return;
      }

      // First block removed and caret was on it: move to new first block
      if (index === 0 && this.ctx.currentBlockIndexValue < 0) {
        this.ctx.currentBlockIndexValue = 0;
      }

      /**
       * A `column` is pure layout — it exists only to host child blocks. When
       * the block just removed was its LAST child, the now-empty column has
       * nothing to lay out, so remove it too. Deleting the column fires its
       * removed() hook, which unwraps the column_list when this drops the list
       * to a single column (see Column.removed -> unwrapColumnListIfCollapsed).
       *
       * `parentBlock.contentIds` was already pruned of the removed child above,
       * so an empty list means a childless column. Fire-and-forget, mirroring
       * the async unwrap it may trigger; the recursive remove re-resolves the
       * column's index, so a shifted flat array never targets the wrong block.
       */
      if (
        parentBlock !== undefined &&
        parentBlock.name === 'column' &&
        parentBlock.contentIds.length === 0 &&
        this.repository.getBlockIndex(parentBlock) >= 0
      ) {
        void this.removeBlock(parentBlock, addLastBlock, skipYjsSync, blocksStore);
      }

      this.ctx.assertHierarchyInvariantInDev('removeBlock');

      resolve();
    });
  }

  /**
   * Depth-first collection of every descendant block beneath `block`,
   * resolved through the live `contentIds` links. Cycle-safe via a visited
   * set. Used to drop a whole columns subtree (column / column_list) on
   * removal so no descendant is left orphaned in the flat blocks array.
   * @param block - root of the subtree (excluded from the result)
   */
  private collectDescendants(block: Block): Block[] {
    const result: Block[] = [];
    const visited = new Set<string>([block.id]);
    const stack = [...block.contentIds];

    while (stack.length > 0) {
      const childId = stack.pop();

      if (childId === undefined || visited.has(childId)) {
        continue;
      }

      visited.add(childId);

      const childBlock = this.repository.getBlockById(childId);

      if (childBlock === undefined) {
        continue;
      }

      result.push(childBlock);
      stack.push(...childBlock.contentIds);
    }

    return result;
  }

  /**
   * Promote the given child blocks to root level (parentId = null) and unhide
   * their holders. Used when a non-columns container (toggle/callout/header) is
   * removed so its body survives at root.
   *
   * Lift each surviving child's holder out of the container's
   * `[data-blok-toggle-children]` container to immediately before the
   * container's own holder, BEFORE the caller's `blocksStore.remove()` runs
   * `container.holder.remove()` — which destroys EVERY descendant holder. Left
   * nested, a promoted child's holder would be wiped, leaving the model saying
   * "at root" while the live holder no longer exists.
   *
   * The lift is SCOPED to children whose IMMEDIATE container is a
   * toggle-children container — the promote-and-preserve tools
   * (toggle/callout/toggleable-header) all mount their direct children there.
   * Self-managing containers like table/database keep their children in their
   * own cell containers and tear that subtree down themselves, so their holders
   * must stay nested and are deliberately not lifted. The match must be on the
   * IMMEDIATE container, not any ancestor: a table cell block sitting inside a
   * toggle has an ANCESTOR toggle-children container, but its immediate
   * container is the cell — lifting it would leak the table's cells to root.
   * @param container - the block being removed
   * @param childIds - ids of the removed container's direct children
   */
  private promoteChildrenToRoot(container: Block, childIds: string[]): void {
    const containerInDom = container.holder.parentElement !== null;

    for (const childId of childIds) {
      const childBlock = this.repository.getBlockById(childId);

      if (childBlock === undefined) {
        continue;
      }

      childBlock.parentId = null;
      childBlock.holder.classList.remove('hidden');

      if (containerInDom && childBlock.holder.parentElement?.matches('[data-blok-toggle-children]') === true) {
        moveElementBefore(childBlock.holder, container.holder);
      }
    }
  }
}
