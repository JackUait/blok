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

    // If old parent had a toggle child container and this block was in it, move it to the
    // position indicated by the flat array. moveBlocks() updates the flat array before
    // setBlockParent() is called, so getBlockIndex() reflects the intended drop position.
    const oldContainer = oldParent !== undefined ? oldParent.holder.querySelector('[data-blok-toggle-children]') : null;

    if (oldContainer && block.holder.parentElement === oldContainer) {
      // Scan backwards in the flat array for the nearest block whose holder is at root
      // level (not inside any toggle-children container) — use it as the DOM anchor.
      const allBlocks = this.repository.blocks;
      const blockIndex = allBlocks.indexOf(block);
      const anchor = allBlocks.slice(0, blockIndex).reverse().find(
        b => b.holder.closest('[data-blok-toggle-children]') === null
      );

      if (anchor) {
        anchor.holder.insertAdjacentElement('afterend', block.holder);
      } else if (oldParent !== undefined) {
        oldParent.holder.after(block.holder);
      }
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

    // If the new parent's existing children are hidden (toggle is collapsed),
    // hide this newly added child too so Tab navigation skips it.
    if (newParentId !== null && newParent !== undefined) {
      const existingChildren = newParent.contentIds
        .filter(id => id !== block.id)
        .map(id => this.repository.getBlockById(id))
        .filter((b): b is NonNullable<typeof b> => b !== undefined);

      const parentIsCollapsed = existingChildren.length > 0 &&
        existingChildren.every(b => b.holder.classList.contains('hidden'));

      if (parentIsCollapsed) {
        block.holder.classList.add('hidden');
      }
    }

    // Move block holder into toggle child container if the new parent has one,
    // honouring the flat-array order so the DOM order matches the logical order.
    if (newParentId !== null && newParent !== undefined) {
      const newContainer = newParent.holder.querySelector('[data-blok-toggle-children]');
      if (newContainer) {
        const allBlocks = this.repository.blocks;
        const blockIdx = allBlocks.indexOf(block);
        const nextSiblingHolder = allBlocks.slice(blockIdx + 1).find(
          b => b.holder.parentElement === newContainer
        )?.holder ?? null;

        // insertBefore(el, null) is equivalent to appendChild
        newContainer.insertBefore(block.holder, nextSiblingHolder);
      }
    }

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

    // Blocks inside toggle child containers should not receive margin-left indentation.
    if (holder.closest('[data-blok-toggle-children]')) {
      holder.style.marginLeft = '';
      holder.setAttribute('data-blok-depth', String(this.getBlockDepth(block)));

      return;
    }

    const depth = this.getBlockDepth(block);
    const indentationPx = depth * 24; // 24px per level

    holder.style.marginLeft = indentationPx > 0 ? `${indentationPx}px` : '';
    holder.setAttribute('data-blok-depth', depth.toString());
  }
}
