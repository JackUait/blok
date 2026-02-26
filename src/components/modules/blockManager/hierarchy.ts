/**
 * @class BlockHierarchy
 * @classdesc Manages parent/child relationships and block depth
 * @module BlockHierarchy
 */
import type { Block } from '../../block';

import type { BlockRepository } from './repository';

/**
 * BlockHierarchy manages hierarchical relationships between blocks
 */
export class BlockHierarchy {
  private readonly repository: BlockRepository;
  private readonly onParentChanged?: (parentId: string) => void;

  /**
   * @param repository - BlockRepository for looking up blocks by id
   * @param onParentChanged - optional callback invoked after a block is assigned a non-null parent
   */
  constructor(repository: BlockRepository, onParentChanged?: (parentId: string) => void) {
    this.repository = repository;
    this.onParentChanged = onParentChanged;
  }

  /**
   * Returns the depth (nesting level) of a block in the hierarchy.
   * Root-level blocks have depth 0.
   * @param block - the block to get depth for
   * @returns {number} - depth level (0 for root, 1 for first level children, etc.)
   */
  public getBlockDepth(block: Block): number {
    const calculateDepth = (parentId: string | null, currentDepth: number): number => {
      if (parentId === null) {
        return currentDepth;
      }

      const parentBlock = this.repository.getBlockById(parentId);

      if (parentBlock === undefined) {
        return currentDepth;
      }

      return calculateDepth(parentBlock.parentId, currentDepth + 1);
    };

    return calculateDepth(block.parentId, 0);
  }

  /**
   * Sets the parent of a block, updating both the block's parentId and the parent's contentIds.
   * @param block - the block to reparent
   * @param newParentId - the new parent block id, or null for root level
   */
  public setBlockParent(block: Block, newParentId: string | null): void {
    const oldParentId = block.parentId;

    // Remove from old parent's contentIds
    const oldParent = oldParentId !== null ? this.repository.getBlockById(oldParentId) : undefined;

    if (oldParent !== undefined) {
      oldParent.contentIds = oldParent.contentIds.filter(id => id !== block.id);
    }

    // Add to new parent's contentIds
    const newParent = newParentId !== null ? this.repository.getBlockById(newParentId) : undefined;
    const shouldAddToNewParent = newParent !== undefined && !newParent.contentIds.includes(block.id);

    if (shouldAddToNewParent) {
      newParent.contentIds.push(block.id);
    }

    // Update block's parentId - parentId is a public mutable property on Block
    // eslint-disable-next-line no-param-reassign
    block.parentId = newParentId;

    // Update visual indentation
    this.updateBlockIndentation(block);

    // Notify listener so parent data can be synced (e.g. to Yjs)
    if (newParentId !== null && this.onParentChanged !== undefined) {
      this.onParentChanged(newParentId);
    }
  }

  /**
   * Updates the visual indentation of a block based on its depth in the hierarchy.
   * @param block - the block to update indentation for
   */
  public updateBlockIndentation(block: Block): void {
    const { holder } = block;

    // Blocks inside table cells should not receive visual indentation.
    // The parent-child relationship is semantic (data tracking), not visual.
    if (holder.closest('[data-blok-table-cell-blocks]')) {
      holder.style.marginLeft = '';
      holder.setAttribute('data-blok-depth', '0');

      return;
    }

    const depth = this.getBlockDepth(block);
    const indentationPx = depth * 24; // 24px per level

    holder.style.marginLeft = indentationPx > 0 ? `${indentationPx}px` : '';
    holder.setAttribute('data-blok-depth', depth.toString());
  }
}
