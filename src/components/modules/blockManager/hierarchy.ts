/**
 * @class BlockHierarchy
 * @classdesc Manages parent/child relationships and block depth
 * @module BlockHierarchy
 */
import type { Block } from '../../block';
import { DATA_ATTR } from '../../constants/data-attributes';
import { logLabeled } from '../../utils';

import type { BlockRepository } from './repository';

/**
 * BlockHierarchy manages hierarchical relationships between blocks
 */
export class BlockHierarchy {
  private readonly repository: BlockRepository;
  private readonly onParentChanged?: (parentId: string) => void;
  private readonly getIsSyncingFromYjs?: () => boolean;

  /**
   * @param repository - BlockRepository for looking up blocks by id
   * @param onParentChanged - optional callback invoked after a block is assigned a non-null parent
   * @param getIsSyncingFromYjs - optional getter that reports whether the editor is
   *   currently applying a remote Yjs update. When true, the Layer 7 dangling
   *   parent id guard skips the throw and always coerces + logs — remote
   *   peers can legitimately deliver a transiently-dangling parent id during
   *   conflict resolution, batched undo replay, or initial sync ordering.
   */
  constructor(
    repository: BlockRepository,
    onParentChanged?: (parentId: string) => void,
    getIsSyncingFromYjs?: () => boolean
  ) {
    this.repository = repository;
    this.onParentChanged = onParentChanged;
    this.getIsSyncingFromYjs = getIsSyncingFromYjs;
  }

  /**
   * Returns the depth (nesting level) of a block in the hierarchy.
   * Root-level blocks have depth 0.
   *
   * Fix 4: a `visited` set guards against malformed parent chains that form a
   * cycle (e.g. remote peers that concurrently reparent A→B and B→A converge
   * into A↔B). Without the guard, the recursion blows the stack and takes
   * down the tab.
   * @param block - the block to get depth for
   * @returns {number} - depth level (0 for root, 1 for first level children, etc.)
   */
  public getBlockDepth(block: Block): number {
    const visited = new Set<string>();

    if (block.id !== undefined) {
      visited.add(block.id);
    }

    const calculateDepth = (parentId: string | null, currentDepth: number): number => {
      if (parentId === null) {
        return currentDepth;
      }

      if (visited.has(parentId)) {
        // Cycle detected — bail to the current depth so we don't blow the stack.
        return currentDepth;
      }
      visited.add(parentId);

      const parentBlock = this.repository.getBlockById(parentId);

      if (parentBlock === undefined) {
        return currentDepth;
      }

      return calculateDepth(parentBlock.parentId, currentDepth + 1);
    };

    return calculateDepth(block.parentId, 0);
  }

  /**
   * Walks the target parent chain and returns true if `childId` already
   * appears in it — meaning assigning `child` as a descendant of the target
   * parent would form a cycle.
   *
   * Fix 4 companion guard for {@link setBlockParent}.
   * @param childId - block id being reparented
   * @param targetParentId - prospective new parent id
   * @returns true if the assignment would form a cycle
   */
  private wouldFormCycle(childId: string, targetParentId: string): boolean {
    const walk = (cursor: string | null, visited: Set<string>): boolean => {
      if (cursor === null) {
        return false;
      }
      if (cursor === childId) {
        return true;
      }
      if (visited.has(cursor)) {
        // Pre-existing cycle — still disqualifies the reparent.
        return true;
      }
      visited.add(cursor);

      const parent = this.repository.getBlockById(cursor);

      if (parent === undefined) {
        return false;
      }

      return walk(parent.parentId, visited);
    };

    return walk(targetParentId, new Set<string>());
  }

  /**
   * Sets the parent of a block, updating both the block's parentId and the parent's contentIds.
   * @param block - the block to reparent
   * @param newParentId - the new parent block id, or null for root level
   */
  public setBlockParent(block: Block, newParentId: string | null): void {
    /**
     * Layer 19: stale-block guard (regression: wrong-block-dropped family).
     *
     * If `block` has been destroyed and is no longer in the repository,
     * `repository.blocks.indexOf(block)` below returns -1. The toggle-DOM
     * anchor logic then runs `allBlocks.slice(0, -1)` — the whole array
     * minus its last element — and silently anchors the stale block's
     * holder at a completely unrelated DOM position. The new-parent
     * branch repeats the same failure with `slice(0)` returning every
     * block. That's the DOM-manipulation analogue of the `splice(-1, …)`
     * root cause behind the original "wrong block dropped" bug.
     *
     * Additionally, without this guard `block.parentId` would be mutated
     * on a destroyed reference and `onParentChanged` would fire with a
     * ghost id, polluting Yjs with writes against a dead block.
     *
     * Bail out cleanly at entry so callers — DragController.handleDrop in
     * particular — get a no-op instead of silent DOM/data corruption.
     */
    if (this.repository.getBlockIndex(block) === -1) {
      return;
    }

    /**
     * Fix 4: cycle guard.
     *
     * Reject reparents that would form a cycle (e.g. make A a descendant of
     * one of its own descendants). Without this guard, a corrupted remote
     * update can land the editor in a state where getBlockDepth recurses
     * forever, plus any hierarchical save would produce a tree that can
     * never round-trip.
     */
    if (newParentId !== null && this.wouldFormCycle(block.id, newParentId)) {
      throw new Error(
        `BlockHierarchy.setBlockParent: refusing to form cycle — assigning ${block.id} to parent ${newParentId} would create a parent/child cycle.`
      );
    }

    /**
     * Layer 7: universal chokepoint guard against dangling parentId.
     *
     * Every reparent in the editor — paste, drag, split, duplicate, slash
     * menu, Cmd+D, markdown shortcut, public api — flows through this
     * method. Previously, if the caller passed a parent id that was no
     * longer in the repository, the write silently mutated block.parentId
     * to garbage: getBlockById returned undefined, the new-parent DOM and
     * contentIds branches no-opped, but `block.parentId = newParentId`
     * still ran. The ghost id then survived until Saver's dangling-parent
     * repair (layer 5), by which point the block has already been
     * ejected from any container it was supposed to belong to.
     *
     * Guarding at this chokepoint catches the regression at the point of
     * introduction instead of one save cycle later:
     *   - test/dev: throw loudly so the offending caller is fixed before
     *     the build ships.
     *   - prod: coerce to null + log `error`, matching the saver's graceful
     *     repair semantics so end users never see a wedged editor.
     *
     * This is the upstream-most defense in the callout paste ejection
     * bug family (operations.paste title-vs-child, insert transfer, blok
     * data handler contextParent, saver repair, validateHierarchy gate).
     */
    const parentExists =
      newParentId === null || this.repository.getBlockById(newParentId) !== undefined;

    if (!parentExists) {
      const env = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;
      const isSyncingFromYjs = this.getIsSyncingFromYjs?.() === true;
      const message =
        `BlockHierarchy.setBlockParent: dangling parent id "${newParentId}" ` +
        `for block "${block.id}" — parent block is not in the repository.`;

      if (!isSyncingFromYjs && (env === 'test' || env === 'development')) {
        throw new Error(message);
      }

      logLabeled(message, 'error');
    }

    const sanitizedParentId = parentExists ? newParentId : null;

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
    const newParent = sanitizedParentId !== null ? this.repository.getBlockById(sanitizedParentId) : undefined;
    const shouldAddToNewParent = newParent !== undefined && !newParent.contentIds.includes(block.id);

    if (shouldAddToNewParent) {
      newParent.contentIds.push(block.id);
    }

    // Update block's parentId - parentId is a public mutable property on Block
    // eslint-disable-next-line no-param-reassign
    block.parentId = sanitizedParentId;

    // If the new parent's existing children are hidden (toggle is collapsed),
    // hide this newly added child too so Tab navigation skips it.
    //
    // Fix 5: a previously-empty collapsed container has no existing hidden
    // children to infer state from. Fall back to reading the toggle/header
    // tool's persistent open-state attribute (`data-blok-toggle-open="false"`)
    // on any descendant of the parent holder.
    if (sanitizedParentId !== null && newParent !== undefined) {
      const existingChildren = newParent.contentIds
        .filter(id => id !== block.id)
        .map(id => this.repository.getBlockById(id))
        .filter((b): b is NonNullable<typeof b> => b !== undefined);

      const parentIsCollapsedFromChildren = existingChildren.length > 0 &&
        existingChildren.every(b => b.holder.classList.contains('hidden'));

      const parentIsCollapsedFromAttr =
        newParent.holder.querySelector('[data-blok-toggle-open="false"]') !== null;

      const parentIsCollapsed = parentIsCollapsedFromChildren || parentIsCollapsedFromAttr;

      if (parentIsCollapsed) {
        block.holder.classList.add('hidden');
      }
    }

    // Move block holder into toggle child container if the new parent has one,
    // honouring the flat-array order so the DOM order matches the logical order.
    // Skip if the holder is already claimed by another nested-blocks container
    // (e.g. a table cell) — moving it would steal it from that container.
    if (sanitizedParentId !== null && newParent !== undefined && !block.holder.closest(`[${DATA_ATTR.nestedBlocks}]`)) {
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
    if (sanitizedParentId !== null && this.onParentChanged !== undefined) {
      this.onParentChanged(sanitizedParentId);
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
