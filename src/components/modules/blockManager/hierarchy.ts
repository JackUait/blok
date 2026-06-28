/**
 * @class BlockHierarchy
 * @classdesc Manages parent/child relationships and block depth
 * @module BlockHierarchy
 */
import type { Block } from '../../block';
import { DATA_ATTR } from '../../constants/data-attributes';
import { logLabeled } from '../../utils';
import { moveElementAfter, moveElementBefore, moveElementToEnd } from '../../utils/html';

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
    //
    // Guard: only relocate the holder OUT of the toggle when the block is actually
    // LEAVING its toggle parent (new parent differs from the old one). When the
    // parent is unchanged the block is merely following its own relocated parent —
    // e.g. a toggle dragged between columns carries its child along, and
    // DragController re-asserts the child's parent via setBlockParent(child, sameToggle)
    // to fix DOM placement. Yanking it to root here would strand the child outside
    // the toggle even though it still belongs to it (the toggle-child-rides-along bug).
    const oldContainer =
      oldParent !== undefined && sanitizedParentId !== oldParentId
        ? oldParent.holder.querySelector('[data-blok-toggle-children]')
        : null;

    if (oldContainer && block.holder.parentElement === oldContainer) {
      // Scan backwards in the flat array for the nearest block whose holder is at root
      // level (not inside any toggle-children container) — use it as the DOM anchor.
      const allBlocks = this.repository.blocks;
      const blockIndex = allBlocks.indexOf(block);
      const anchor = allBlocks.slice(0, blockIndex).reverse().find(
        b => b.holder.closest('[data-blok-toggle-children]') === null
      );

      if (anchor) {
        moveElementAfter(block.holder, anchor.holder);
      } else if (oldParent !== undefined) {
        moveElementAfter(block.holder, oldParent.holder);
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

    // Move block holder into the new parent's direct child container, honouring
    // the flat-array order so the DOM order matches the logical order.
    //
    // The target container may be a toggle/callout container ([data-blok-toggle-children])
    // or a generic nested-blocks container ([data-blok-nested-blocks], used by
    // columns and column_list). querySelector returns the FIRST match in
    // document order: because a parent's own child container is a direct child of
    // its wrapper, it always precedes any grandchild container (which lives INSIDE
    // it, deeper in document order). So this resolves to the parent's own direct
    // container, never a deeper one belonging to a nested block.
    //
    // Skip guard: keep the original behaviour of refusing to move a holder that
    // is already claimed by SOME nested-blocks container (e.g. a table cell) —
    // moving it would steal it from that container. The one loosening Track C
    // needs is to still mount when the target is the holder's CURRENT container
    // already (a no-op insertBefore that re-asserts flat order); we express that
    // by only skipping when the holder's nearest nested container is DIFFERENT
    // from the target container.
    if (sanitizedParentId !== null && newParent !== undefined) {
      const newContainer = newParent.holder.querySelector(
        '[data-blok-toggle-children], [data-blok-nested-blocks]'
      );
      const currentNestedContainer = block.holder.closest(`[${DATA_ATTR.nestedBlocks}]`);

      // A column→column move is a legitimate reparent driven by the drag system:
      // the holder must follow the model into the destination column. The
      // anti-stealing guard targets corrupted multi-references across tool
      // containers (table cell / toggle / callout / header), never the columns
      // flex layout. A column's child container is identifiable because its
      // PARENT is the [data-blok-column] wrapper — that precisely separates the
      // two cases (a toggle nested inside a column would not match).
      const isColumnContainer = (container: Element | null): boolean =>
        container?.parentElement?.matches('[data-blok-column]') === true;
      // The column_list's own child container is the columns row. A `column`
      // block always belongs to a columns row, so mounting one into a row is a
      // legitimate structural reparent — never a steal. This is the case the
      // drag-beside "add a column" path hits: api.blocks.insert anchors the new
      // column's holder next to a SIBLING column's child block (the new column's
      // flat index falls inside that sibling's child range), so the holder lands
      // inside that sibling column's container. Without this allowance the guard
      // below refuses to move it out, stranding the new column nested INSIDE its
      // sibling instead of placing it beside it in the row.
      const isColumnsRow = (container: Element | null): boolean =>
        container?.matches('[data-blok-columns]') === true;
      // A block whose model parent is a column but whose holder is currently
      // stranded in the column_list's flex row (the columns row) must be
      // relocated INTO the target column's child container. This is the
      // Enter/split-in-column strand: the split insert anchors the new holder
      // 'beforebegin' the sibling column in the row, so its nearest nested
      // container resolves to the columns row, not a real column. Allow the
      // move when the holder sits in the row and the destination is a genuine
      // column child container — it was never legitimately "claimed" by the row.
      const strandedInColumnsRow =
        isColumnsRow(currentNestedContainer) && isColumnContainer(newContainer);
      const claimedByOtherContainer =
        currentNestedContainer !== null &&
        currentNestedContainer !== newContainer &&
        !(isColumnContainer(currentNestedContainer) && isColumnContainer(newContainer)) &&
        !isColumnsRow(newContainer) &&
        !strandedInColumnsRow;

      if (newContainer && !claimedByOtherContainer) {
        const allBlocks = this.repository.blocks;
        const blockIdx = allBlocks.indexOf(block);
        const nextSiblingHolder = allBlocks.slice(blockIdx + 1).find(
          b => b.holder.parentElement === newContainer
        )?.holder ?? null;

        if (nextSiblingHolder !== null) {
          moveElementBefore(block.holder, nextSiblingHolder);
        } else {
          moveElementToEnd(newContainer, block.holder);
        }
      }
    }

    // Escaping a column for ROOT. The positional blocksStore.move() skips the
    // DOM move while the holder is nested (it follows its parent container by
    // default — correct for table cells), and the mount-into-container branch
    // above only runs for a non-null parent — so a block dragged OUT of a
    // column to root would otherwise stay stranded in the column's container
    // while the model says root (a model-vs-DOM divergence). Relocate the
    // holder to the workingArea at its flat-array position. Toggle/callout/
    // header escapes are handled by the [data-blok-toggle-children] block near
    // the top of this method; table cells manage their own DOM and block
    // cross-cell drops upstream — so this is scoped to columns only.
    if (sanitizedParentId === null && block.holder.closest('[data-blok-column]') !== null) {
      const allBlocks = this.repository.blocks;
      const blockIndex = allBlocks.indexOf(block);
      const isAtRoot = (b: Block): boolean => b.holder.closest(`[${DATA_ATTR.nestedBlocks}]`) === null;
      const precedingRoot = allBlocks.slice(0, blockIndex).reverse().find(isAtRoot);
      const followingRoot = allBlocks.slice(blockIndex + 1).find(isAtRoot);

      if (precedingRoot !== undefined) {
        moveElementAfter(block.holder, precedingRoot.holder);
      } else if (followingRoot !== undefined) {
        moveElementBefore(block.holder, followingRoot.holder);
      }
    }

    // Update visual indentation for the block AND its whole subtree — a reparent
    // shifts every descendant's structural depth, so their margins move too.
    this.reindentSubtree(block);

    // Notify listener so parent data can be synced (e.g. to Yjs)
    if (sanitizedParentId !== null && this.onParentChanged !== undefined) {
      this.onParentChanged(sanitizedParentId);
    }
  }

  /**
   * Re-applies visual indentation to a block and every descendant (via the
   * contentIds tree). Needed after a reparent, since structural depth — and thus
   * the depth-based margin — changes for the entire subtree, not just the block
   * that moved. Cycle-safe via a visited set.
   * @param block - the subtree root to re-indent
   */
  private reindentSubtree(block: Block, visited: Set<string> = new Set<string>()): void {
    if (visited.has(block.id)) {
      return;
    }
    visited.add(block.id);

    this.updateBlockIndentation(block);

    for (const childId of block.contentIds) {
      const child = this.repository.getBlockById(childId);

      if (child !== undefined) {
        this.reindentSubtree(child, visited);
      }
    }
  }

  /**
   * Walks the block's parentId chain and returns true if any ancestor is a
   * `column` or `column_list` block — i.e. the block lives inside a columns
   * layout in the block tree, regardless of whether its holder has been
   * mounted into the columns DOM yet. Cycle-safe via a visited set.
   * @param block - the block to test
   * @returns true if a column/column_list ancestor exists
   */
  private hasColumnAncestor(block: Block): boolean {
    const walk = (parentId: string | null, visited: Set<string>): boolean => {
      if (parentId === null || visited.has(parentId)) {
        return false;
      }
      visited.add(parentId);

      const parent = this.repository.getBlockById(parentId);

      if (parent === undefined) {
        return false;
      }

      if (parent.name === 'column' || parent.name === 'column_list') {
        return true;
      }

      return walk(parent.parentId, visited);
    };

    return walk(block.parentId, new Set<string>());
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

    // Blocks inside toggle child containers should not receive parentId-depth
    // margin (the container indents them).
    if (holder.closest('[data-blok-toggle-children]')) {
      holder.style.marginLeft = '';
      holder.setAttribute('data-blok-depth', String(this.getBlockDepth(block)));

      return;
    }

    // Columns are a flex layout: the column_list block, its column children, and
    // every block inside a column are positioned by flex, not block-tree depth.
    // Depth-based margin would push the column holders off their even split and
    // indent the column content. Keep them flush.
    //
    // The DOM check (`closest`) misses blocks reparented BEFORE their holder is
    // mounted into the columns container — e.g. a toolbox-seeded paragraph,
    // whose indentation runs during insertInsideParent, before the Column tool
    // appends it. The column ancestry is always in the block tree, so consult
    // that too rather than relying on DOM placement timing.
    if (
      block.name === 'column_list' ||
      holder.closest('[data-blok-columns]') ||
      this.hasColumnAncestor(block)
    ) {
      holder.style.marginLeft = '';
      holder.setAttribute('data-blok-depth', '0');

      return;
    }

    const depth = this.getBlockDepth(block);

    holder.style.marginLeft = depth > 0 ? `${depth * 24}px` : ''; // 24px per parentId level
    holder.setAttribute('data-blok-depth', depth.toString());
  }
}
