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

  /**
   * @param repository - BlockRepository for looking up blocks by id
   */
  constructor(repository: BlockRepository) {
    this.repository = repository;
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
  }

  /**
   * Updates the visual indentation of a block based on its depth in the hierarchy.
   * @param block - the block to update indentation for
   */
  public updateBlockIndentation(block: Block): void {
    const depth = this.getBlockDepth(block);
    const indentationPx = depth * 24; // 24px per level
    const { holder } = block;

    holder.style.marginLeft = indentationPx > 0 ? `${indentationPx}px` : '';
    holder.setAttribute('data-blok-depth', depth.toString());
  }
}
