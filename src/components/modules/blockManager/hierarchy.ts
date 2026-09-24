/**
 * @class BlockHierarchy
 * @classdesc Manages parent/child relationships and block depth
 * @module BlockHierarchy
 */
import type { Block } from '../../block';
import { logLabeled } from '../../utils';
import { CHILD_SLOT_SELECTOR, SELF_PLACING_PARENTS } from '../../../tools/nested-blocks';
import { homeSlotElement, resolveHomeSlot } from '../../utils/home-slot';
import { findOwn } from '../../utils/own-element';
import { childrenInTreeOrder, flatIndexForPlacement, placementImpliedByFlat } from '../../utils/tree-order';
import type { TreePlacement } from '../../utils/tree-order';
import type { Blocks } from '../../blocks';

import type { BlockRepository } from './repository';

/**
 * Inline channel for a block's indentation multiplier. main.css renders the
 * indent as `calc(var(--_blok-block-depth, 0) * var(--blok-block-indent-step, 24px))`
 * on every `[data-blok-element]`, and every `[data-blok-nested-blocks]` slot
 * zeroes the (inherited) step.
 *
 * Writing the multiplier instead of `style.marginLeft` is what lets a container
 * tool decline the indent: an inline `margin-left` could only be beaten with
 * `!important`, and — because it is computed at insert time — it also survived
 * the holder later landing inside a slot that had not been created yet (a
 * framework adapter commits its child slot a render after core inserts the
 * child). Inheritance re-resolves at that moment; a DOM check cannot.
 *
 * Internal (`--_blok-` prefix): core owns it. The public knob is the step.
 */
const DEPTH_MULTIPLIER_PROPERTY = '--_blok-block-depth';

/**
 * Indent multiplier INSIDE a child slot, where the step above is zeroed: the
 * number of model ancestors between the block and the ancestor whose slot holds
 * it (toggle > p > p gives the last p a 1). main.css multiplies it by a step
 * captured on the editor root, outside every slot.
 */
const SLOT_DEPTH_PROPERTY = '--_blok-slot-depth';

/**
 * BlockHierarchy manages hierarchical relationships between blocks
 */
export class BlockHierarchy {
  private readonly repository: BlockRepository;
  private readonly onParentChanged?: (parentId: string) => void;
  private readonly getIsSyncingFromYjs?: () => boolean;
  private readonly blocksStore?: Pick<Blocks, 'mount'>;

  /**
   * @param repository - BlockRepository for looking up blocks by id
   * @param onParentChanged - optional callback invoked after a block is assigned a non-null parent
   * @param getIsSyncingFromYjs - optional getter that reports whether the editor is
   *   currently applying a remote Yjs update. When true, the Layer 7 dangling
   *   parent id guard skips the throw and always coerces + logs — remote
   *   peers can legitimately deliver a transiently-dangling parent id during
   *   conflict resolution, batched undo replay, or initial sync ordering.
   * @param blocksStore - the store behind `repository`; {@link placeBlock} mounts holders through it
   */
  constructor(
    repository: BlockRepository,
    onParentChanged?: (parentId: string) => void,
    getIsSyncingFromYjs?: () => boolean,
    blocksStore?: Pick<Blocks, 'mount'>
  ) {
    this.repository = repository;
    this.onParentChanged = onParentChanged;
    this.getIsSyncingFromYjs = getIsSyncingFromYjs;
    this.blocksStore = blocksStore;
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
   * Whether `candidate` sits somewhere under `ancestorId` in the block tree.
   * @param candidate - the block to test
   * @param ancestorId - the prospective ancestor
   */
  private isUnder(candidate: Block, ancestorId: string): boolean {
    const walk = (cursor: string | null, visited: Set<string>): boolean => {
      if (cursor === null || visited.has(cursor)) {
        return false;
      }

      return cursor === ancestorId
        || walk(this.repository.getBlockById(cursor)?.parentId ?? null, visited.add(cursor));
    };

    return walk(candidate.parentId, new Set<string>());
  }

  /**
   * Where {@link setBlockParent} puts `block` under `parentId`:
   * - joining a parent from outside its subtree: last, after the parent's
   *   whole subtree;
   * - leaving for an ancestor (or the root) while blocks that stay behind
   *   follow it: right after the subtree it leaves;
   * - otherwise where the flat array already has it, so a caller that placed
   *   the block first (drag, Tab, Shift+Tab, insert-then-reparent) keeps it.
   *
   * A caller that sends several siblings out of one container must go last
   * to first, or the "right after" rule reverses them.
   * @param block - the block being reparented (parentId not yet updated)
   * @param parentId - its new parent (known to the repository), or null for the root
   */
  private placementForParent(block: Block, parentId: string | null): TreePlacement {
    const blocks = this.repository.blocks;
    const index = blocks.indexOf(block);
    const subtree = new Set(blocks.filter(candidate => candidate === block || this.isUnder(candidate, block.id)));

    if (parentId !== null && parentId !== block.parentId) {
      const predecessor = blocks[index - 1] as Block | undefined;
      const followsParentRun = predecessor !== undefined
        && (predecessor.id === parentId || this.isUnder(predecessor, parentId));

      if (!followsParentRun) {
        const lastChild = blocks.filter(candidate => candidate.parentId === parentId && !subtree.has(candidate)).pop();

        return { parentId, afterId: lastChild?.id ?? null };
      }
    }

    const leftAncestor = parentId === block.parentId ? undefined : this.ancestorWithParent(block, parentId);
    const next = blocks[index + subtree.size] as Block | undefined;

    if (leftAncestor !== undefined && next !== undefined && this.isUnder(next, leftAncestor.id)) {
      return { parentId, afterId: leftAncestor.id };
    }

    return placementImpliedByFlat(
      { blocks, getById: id => this.repository.getBlockById(id) },
      block,
      parentId
    );
  }

  /**
   * Puts the entries of a parent's contentIds that the flat array holds into
   * flat order; the others keep their places. Callers still move the flat
   * array first and then re-assert each child (placeRun), so the slot
   * placeBlock picks after `afterId` must follow the flat order.
   *
   * Temporary: it derives contentIds from flat order, the opposite of the
   * target. Delete it once placeRun, moveTo and drag stop moving the flat
   * array before re-asserting (wave-2 step 3). Skipped during a Yjs replay,
   * where contentIds carry the doc's order.
   * @param parentId - the parent, or null for the root (nothing to do)
   */
  private sortListedChildrenByFlatOrder(parentId: string | null): void {
    const parent = parentId === null ? undefined : this.repository.getBlockById(parentId);

    if (parent === undefined || this.getIsSyncingFromYjs?.() === true) {
      return;
    }

    const flatIndex = new Map(this.repository.blocks.map((candidate, index) => [candidate.id, index]));
    const inFlatOrder = parent.contentIds
      .filter(id => flatIndex.has(id))
      .sort((a, b) => (flatIndex.get(a) ?? 0) - (flatIndex.get(b) ?? 0));
    const next = inFlatOrder[Symbol.iterator]();

    parent.contentIds = parent.contentIds.map(id => flatIndex.has(id) ? next.next().value ?? id : id);
  }

  /**
   * The ancestor of `block` whose parent is `parentId`, if `parentId` is up
   * the chain (null = the root). Cycle-safe.
   * @param block - the block
   * @param parentId - the ancestor's parent
   */
  private ancestorWithParent(block: Block, parentId: string | null): Block | undefined {
    const walk = (cursor: Block | undefined, visited: Set<string>): Block | undefined => {
      if (cursor === undefined || visited.has(cursor.id)) {
        return undefined;
      }

      return cursor.parentId === parentId
        ? cursor
        : walk(
          cursor.parentId === null ? undefined : this.repository.getBlockById(cursor.parentId),
          visited.add(cursor.id)
        );
    };

    return block.parentId === null ? undefined : walk(this.repository.getBlockById(block.parentId), new Set<string>());
  }

  /**
   * The slot a child of `parentId` lives in: the child slot of the nearest
   * ancestor (from `parentId` up) that owns one. A slotless parent's children
   * sit as flat siblings after it, in that same slot.
   *
   * Null means "no slot": the root working area, or a self-placing ancestor
   * (table, database) that places its descendants itself. A DIRECT parent's own
   * slot is always returned — for a table that is its first cell, and the
   * anti-steal guard in {@link setBlockParent} is what keeps it honest.
   * @param parentId - the (prospective) parent id
   */
  private findHomeSlot(parentId: string | null): Element | null {
    return homeSlotElement(parentId, id => this.repository.getBlockById(id));
  }

  /**
   * Whether {@link setBlockParent} may move `block`'s holder into the home
   * slot of `newParent`. No when another container still claims the holder,
   * or when the home slot sits inside the holder.
   *
   * The home slot is a querySelector, so a parent with one slot per child
   * position (a table, whose every cell is a nested-blocks slot, or an adapter
   * block rendering two <BlockChildren>) always resolves to slot ONE. This veto
   * is what keeps the other slots' children where they are.
   * @param block - the block being reparented
   * @param newParent - its new parent
   * @param oldHomeSlot - the slot the block is leaving (null when the parent is unchanged)
   */
  private mayMountUnder(block: Block, newParent: Block, oldHomeSlot: Element | null): boolean {
    const newContainer = this.findHomeSlot(newParent.id);
    const currentNestedContainer = block.holder.closest(CHILD_SLOT_SELECTOR);

    if (newContainer === null) {
      return true;
    }

    // Corrupted DOM: mounting would insert the new parent into its own child.
    const subtree = this.repository.blocks.filter(candidate => candidate === block || this.isUnder(candidate, block.id));

    if (subtree.some(member => member.holder.contains(newContainer))) {
      return false;
    }

    // A column→column move is a legitimate reparent driven by the drag system.
    // A column's child container is identifiable because its PARENT is the
    // [data-blok-column] wrapper (a toggle nested inside a column does not match).
    const isColumnContainer = (container: Element | null): boolean =>
      container?.parentElement?.matches('[data-blok-column]') === true;
    // The column_list's own child container is the columns row. A `column`
    // block always belongs to a columns row, so mounting one into a row is
    // never a steal (drag-beside "add a column": the new column's holder first
    // lands inside a SIBLING column's container).
    const isColumnsRow = (container: Element | null): boolean =>
      container?.matches('[data-blok-columns]') === true;
    // A container that ENCLOSES the destination never legitimately claims a
    // block bound for it. Blocks.insert anchors a new holder 'beforebegin' its
    // flat successor, so Enter at the end of a nested container's last child
    // drops the new holder one level OUT; setBlockParent must repair it.
    const strandedInAncestorContainer =
      currentNestedContainer !== null &&
      currentNestedContainer !== newContainer &&
      currentNestedContainer.contains(newContainer);
    // The mirror strand: appending at the end of a container whose last child
    // has children anchors the holder 'afterend' that grandchild, inside the
    // SIBLING's own slot. Only DISJOINT containers (sibling table cells,
    // sibling toggles) keep the veto.
    const strandedInDescendantContainer =
      currentNestedContainer !== null &&
      currentNestedContainer !== newContainer &&
      newContainer.contains(currentNestedContainer);
    // A DISCONNECTED container never claims a block: replace() swaps out a
    // container block and its children's holders leave with the removed
    // subtree. The exception is a container inside the new parent itself,
    // which must hold while an adapter boots the editor on a detached holder
    // (else every table cell's block is pulled into cell (0,0)). This relies
    // on container tools SWAPPING their child slot rather than appending a
    // new one beside the old.
    const claimedByOtherContainer =
      currentNestedContainer !== null &&
      (currentNestedContainer.isConnected || newParent.holder.contains(currentNestedContainer)) &&
      currentNestedContainer !== newContainer &&
      !(isColumnContainer(currentNestedContainer) && isColumnContainer(newContainer)) &&
      !isColumnsRow(newContainer) &&
      !strandedInAncestorContainer &&
      !strandedInDescendantContainer &&
      // The slot the block is leaving is not a claim on it.
      currentNestedContainer !== oldHomeSlot;

    return !claimedByOtherContainer;
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
    const oldParent = oldParentId !== null ? this.repository.getBlockById(oldParentId) : undefined;

    const placement = this.placementForParent(block, sanitizedParentId);

    this.sortListedChildrenByFlatOrder(sanitizedParentId);

    const oldHomeSlot =
      oldParent !== undefined && sanitizedParentId !== oldParentId
        ? this.findHomeSlot(oldParentId)
        : null;
    const newParent = sanitizedParentId !== null ? this.repository.getBlockById(sanitizedParentId) : undefined;
    const withDom = this.blocksStore !== undefined
      && (newParent === undefined || this.mayMountUnder(block, newParent, oldHomeSlot));

    // Tables and databases too: they order children by their own model, but
    // the flat array must still list those children inside their run.
    // placeBlock leaves their holders where they are.
    this.placeBlock(block, placement, { dom: withDom });

    if (!withDom) {
      this.reindentSubtree(block);
    }

    // Public API contract: a block given a table from outside its cells goes
    // into the first cell, where the table adopts it into its grid. Left at
    // root, save() rejects it as a child no cell references.
    const firstSlot = newParent !== undefined && SELF_PLACING_PARENTS.has(newParent.name) && !newParent.holder.contains(block.holder)
      ? this.findHomeSlot(newParent.id)
      : null;

    if (withDom && firstSlot !== null && this.blocksStore !== undefined) {
      const store = this.blocksStore;
      // A slotless block's children sit flat after it, so they come along.
      const subtree = this.repository.blocks.filter(candidate => candidate === block || this.isUnder(candidate, block.id));
      const carried = subtree.filter(member =>
        !subtree.some(other => other !== member && other.holder.contains(member.holder)));

      // Last first: each mount anchors on the holders after it.
      [...carried].reverse().forEach(member => {
        store.mount(member, this.repository.getBlockIndex(member), firstSlot);
      });
      carried.forEach(member => this.updateBlockIndentation(member));
    }

    // If the new parent's existing children are hidden (toggle is collapsed),
    // hide this newly added child too so Tab navigation skips it.
    //
    // Fix 5: a previously-empty collapsed container has no existing hidden
    // children to infer state from. Fall back to reading the toggle/header
    // tool's persistent open-state attribute (`data-blok-toggle-open="false"`)
    // on the parent's OWN marker, never a nested toggle's.
    if (sanitizedParentId !== null && newParent !== undefined) {
      const existingChildren = newParent.contentIds
        .filter(id => id !== block.id)
        .map(id => this.repository.getBlockById(id))
        .filter((b): b is NonNullable<typeof b> => b !== undefined);

      const parentIsCollapsedFromChildren = existingChildren.length > 0 &&
        existingChildren.every(b => b.holder.classList.contains('hidden'));

      const parentIsCollapsedFromAttr =
        findOwn(newParent.holder, '[data-blok-toggle-open="false"]') !== null;

      const parentIsCollapsed = parentIsCollapsedFromChildren || parentIsCollapsedFromAttr;

      if (parentIsCollapsed) {
        block.holder.classList.add('hidden');
      }
    }

    // A block leaving a collapsed toggle keeps its `hidden` flag unless the
    // new parent hides it too.
    const hiddenByNewParent = newParent !== undefined && (
      newParent.holder.classList.contains('hidden')
      || findOwn(newParent.holder, '[data-blok-toggle-open="false"]') !== null
      || newParent.contentIds.some(id =>
        id !== block.id && this.repository.getBlockById(id)?.holder.classList.contains('hidden') === true)
    );

    if (oldParentId !== sanitizedParentId && !hiddenByNewParent) {
      block.holder.classList.remove('hidden');
    }

    // Notify listener so parent data can be synced (e.g. to Yjs)
    if (sanitizedParentId !== null && this.onParentChanged !== undefined) {
      this.onParentChanged(sanitizedParentId);
    }
  }

  /**
   * Moves `block` and its whole subtree to `placement`: under `parentId`,
   * right after sibling `afterId` (null = first child). Updates both parents'
   * contentIds, the block's parentId, the flat array and the holders.
   *
   * Throws, changing nothing, on a cycle, an unknown parent or sibling, a
   * sibling of another parent, a block the store does not hold, or a home slot
   * inside the moved subtree's own holders.
   *
   * Left to the caller:
   * - childTools / ownsChildren: not checked here.
   * - Under a table/database the holder stays where it is; the caller hands
   *   it to the tool, which picks the cell or view (setBlockParent mounts a
   *   holder from outside the table into its first cell).
   * - Hiding a block that joins a collapsed toggle.
   * - Yjs writes and the parent-change callback.
   *
   * A holder inside another moved holder rides along and is not mounted: a
   * parent with several slots (a table, an adapter block) keeps each child in
   * its own slot.
   *
   * `dom: false` writes the model only: no mount, no re-indent, no store
   * needed. setBlockParent uses it when another container claims the holder
   * or it has no store.
   * @param block - the block to move
   * @param placement - where it goes
   * @param options - what to write besides the model
   * @param options.dom - whether to mount holders and re-indent (default true)
   */
  public placeBlock(block: Block, placement: TreePlacement, options: { dom?: boolean } = {}): void {
    const withDom = options.dom !== false;
    const store = this.blocksStore;

    if (withDom && store === undefined) {
      throw new Error('BlockHierarchy.placeBlock: no blocks store to mount holders into');
    }

    const blocks = this.repository.blocks;
    const { parentId, afterId } = placement;

    if (!blocks.includes(block)) {
      throw new Error(`BlockHierarchy.placeBlock: block "${block.id}" is not in the store`);
    }

    if (parentId !== null && this.wouldFormCycle(block.id, parentId)) {
      throw new Error(`BlockHierarchy.placeBlock: placing ${block.id} under ${parentId} would form a cycle`);
    }

    if (afterId === block.id) {
      throw new Error(`BlockHierarchy.placeBlock: block "${block.id}" cannot follow itself`);
    }

    // By parentId, not by flat contiguity: the flat run may already be broken.
    const moving = blocks.filter(candidate => candidate === block || this.isUnder(candidate, block.id));
    const movingSet = new Set(moving);
    const rest = blocks.filter(candidate => !movingSet.has(candidate));
    const getBlock = (id: string): Block | undefined => this.repository.getBlockById(id);
    const tree = { blocks: rest, getById: getBlock };
    const target = flatIndexForPlacement(tree, placement);
    const newHome = resolveHomeSlot(parentId, getBlock);

    // Corrupted DOM: mounting would throw mid-move, after the model writes.
    if (withDom && newHome.kind === 'slot' && moving.some(member => member.holder.contains(newHome.slot))) {
      throw new Error(`BlockHierarchy.placeBlock: placing ${block.id} under ${String(parentId)} would mount it inside its own holder`);
    }

    const oldParent = block.parentId === null ? undefined : this.repository.getBlockById(block.parentId);

    if (oldParent !== undefined) {
      oldParent.contentIds = oldParent.contentIds.filter(id => id !== block.id);
    }

    const newParent = parentId === null ? undefined : this.repository.getBlockById(parentId);

    if (newParent !== undefined) {
      // A stale list that misses afterId is first completed in tree order,
      // or the block would land before afterId in tree order.
      const listed = afterId === null || newParent.contentIds.includes(afterId)
        ? newParent.contentIds
        : childrenInTreeOrder(tree, newParent).map(child => child.id);
      const siblings = listed.filter(id => id !== block.id);
      const slot = afterId === null ? 0 : siblings.indexOf(afterId) + 1;

      newParent.contentIds = [...siblings.slice(0, slot), block.id, ...siblings.slice(slot)];
    }

    // eslint-disable-next-line no-param-reassign
    block.parentId = parentId;

    rest.splice(target, 0, ...moving);
    this.repository.reorderBlocks(rest);

    if (!withDom || store === undefined) {
      return;
    }

    // Last block first: each mount anchors on holders after it, which must
    // already be in place.
    [...moving].reverse().forEach(member => {
      const home = resolveHomeSlot(member.parentId, getBlock);
      const ridesAlong = moving.some(other => other !== member && other.holder.contains(member.holder));

      if (!ridesAlong && (home.kind === 'slot' || home.kind === 'root')) {
        store.mount(member, this.repository.getBlockIndex(member), home.kind === 'slot' ? home.slot : null);
      }
    });

    this.reindentSubtree(block);
  }

  /**
   * Re-applies visual indentation to a block and every descendant (via the
   * contentIds tree). Needed after a reparent, since structural depth — and thus
   * the depth-based margin — changes for the entire subtree, not just the block
   * that moved. Cycle-safe via a visited set.
   * @param block - the subtree root to re-indent
   */
  private reindentSubtree(block: Block, visited: Set<string> = new Set<string>(), isRoot = true): void {
    if (visited.has(block.id)) {
      return;
    }
    visited.add(block.id);

    this.updateBlockIndentation(block);

    // A list item renders its nesting indent + bullet/number glyph from its
    // STRUCTURAL depth, on its inner [role="listitem"] element — not via the
    // generic holder margin that updateBlockIndentation applies. Reparenting the
    // subtree root shifts every DESCENDANT's structural depth too, but only the
    // root's tool MOVED hook fires (blockManager fires it for keyboard nesting,
    // the drag pipeline for drag). Without re-running each descendant list tool's
    // MOVED hook here, nested items keep a stale visual indent + glyph. Fire it
    // for descendant list blocks so they recompute their depth-derived UI. The
    // root is skipped to avoid double-firing with the caller that owns it.
    if (!isRoot && block.name === 'list') {
      block.call('moved', {
        fromIndex: this.repository.getBlockIndex(block),
        toIndex: this.repository.getBlockIndex(block),
      });
    }

    for (const childId of block.contentIds) {
      const child = this.repository.getBlockById(childId);

      if (child !== undefined) {
        this.reindentSubtree(child, visited, false);
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
   * Model ancestors between `block` and the nearest ancestor whose holder
   * encloses it — 0 for a slot's direct child, and 0 when no ancestor encloses
   * it (root-level nesting uses the depth multiplier instead).
   * @param block - the block to measure
   */
  private getSlotDepth(block: Block): number {
    const visited = new Set<string>([block.id]);

    const walk = (parentId: string | null, between: number): number => {
      if (parentId === null || visited.has(parentId)) {
        return 0;
      }
      visited.add(parentId);

      const ancestor = this.repository.getBlockById(parentId);

      if (ancestor === undefined) {
        return 0;
      }

      return ancestor.holder.contains(block.holder) ? between : walk(ancestor.parentId, between + 1);
    };

    return walk(block.parentId, 0);
  }

  /**
   * Updates the visual indentation of a block based on its depth in the hierarchy.
   *
   * Only the multiplier is written ({@link DEPTH_MULTIPLIER_PROPERTY}); main.css
   * turns it into the actual margin. The exemptions below stay because they are
   * NOT container cases the stylesheet can spot on its own — a list holder is
   * flush while its inner [role="listitem"] carries the indent, and a
   * column-tree block must be flush from the first frame, before its holder is
   * mounted into the columns DOM at all.
   * @param block - the block to update indentation for
   */
  public updateBlockIndentation(block: Block): void {
    const { holder } = block;

    // Table cells, lists and column trees never take the slot indent.
    holder.style.setProperty(SLOT_DEPTH_PROPERTY, '0');

    // Blocks inside table cells should not receive visual indentation.
    // The parent-child relationship is semantic (data tracking), not visual.
    if (holder.closest('[data-blok-table-cell-blocks]')) {
      holder.style.setProperty(DEPTH_MULTIPLIER_PROPERTY, '0');
      holder.setAttribute('data-blok-depth', '0');

      return;
    }

    // List items render their own nesting indentation on their inner
    // [role="listitem"] element (so the marker glyph aligns with the indent),
    // derived from their STRUCTURAL depth. Applying the generic parentId-depth
    // margin to the holder too would double the indent. Keep the holder flush
    // and still expose the structural depth via data-blok-depth.
    if (block.name === 'list') {
      holder.style.setProperty(DEPTH_MULTIPLIER_PROPERTY, '0');
      holder.setAttribute('data-blok-depth', String(this.getBlockDepth(block)));

      return;
    }

    // Blocks inside toggle child containers should not receive parentId-depth
    // margin (the container indents them).
    if (holder.closest('[data-blok-toggle-children]')) {
      holder.style.setProperty(DEPTH_MULTIPLIER_PROPERTY, '0');
      holder.style.setProperty(SLOT_DEPTH_PROPERTY, String(this.getSlotDepth(block)));
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
      holder.style.setProperty(DEPTH_MULTIPLIER_PROPERTY, '0');
      holder.setAttribute('data-blok-depth', '0');

      return;
    }

    const depth = this.getBlockDepth(block);
    const slotDepth = this.getSlotDepth(block);

    // Inside a plain slot the indent is split between the two terms, so a slot
    // that opts the step back in still gets depth x step, not more.
    holder.style.setProperty(SLOT_DEPTH_PROPERTY, String(slotDepth));
    holder.style.setProperty(DEPTH_MULTIPLIER_PROPERTY, String(depth - slotDepth));
    holder.setAttribute('data-blok-depth', depth.toString());
  }
}
