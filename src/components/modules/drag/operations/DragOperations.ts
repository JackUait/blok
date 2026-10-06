/**
 * DragOperations - Handles move and duplicate operations for drag and drop
 */

import type { BlockOrigin } from '../../../../../types';
import { PAGE_REFERENCE_ATTR, preservePageReferenceAnchor } from '../../../../shared/page-reference';
import { BlockToolAPI } from '../../../block';
import type { Block } from '../../../block';
import { parseUntrustedHtml } from '../../../utils/inert-html';
import type { TreePlacement } from '../../../utils/tree-order';
import { isSelfPlacedParent } from '../../blockManager/new-block-placement';
import { resolveMoveDestination } from '../utils/moveDestination';
import type { MoveDestination } from '../utils/moveDestination';

export interface MoveResult {
  movedBlocks: Block[];
  targetIndex: number;
}

export interface DuplicateResult {
  duplicatedBlocks: Block[];
  targetIndex: number;
}

/**
 * Precomputed duplicate plan — all the async work (block.save() awaits,
 * stale-reference guards) is done, leaving only synchronous Yjs writes for
 * `applyDuplicates`. This split lets `handleDuplicate` wrap the sync tail
 * in `BlockManager.transactForTool` so every insert + setBlockParent call
 * collapses into one undo stack item.
 */
export interface DuplicatePreparation {
  sortedBlocks: Block[];
  sourceIds: Set<string>;
  validResults: Array<{
    saved: { data: Record<string, unknown>; tunes: Record<string, unknown> };
    toolName: string;
    link?: { tool: string; data: Record<string, unknown> };
  }>;
  baseInsertIndex: number;
  /** null when pre-save stale guards aborted or post-save liveTargetIndex was -1. */
  aborted: boolean;
}

export interface BlockManagerAdapter {
  blocks: Block[];
  getBlockIndex(block: Block): number;
  getBlockByIndex(index: number): Block | undefined;
  move(toIndex: number, fromIndex: number, needToFocus: boolean, skipMovedHook?: boolean): void;
  insert(config: {
    tool: string;
    data: Record<string, unknown>;
    tunes: Record<string, unknown>;
    needToFocus: boolean;
    origin?: BlockOrigin;
  } & ({ index: number } | { placement: TreePlacement })): Block;
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

/**
 * The sources minus those under a copied block whose tool declares
 * `copiesOwnChildren` (a table). That copy rebuilds them itself, so a second
 * copy from here would land in it as extra content. A database does not
 * declare it: its rows are copied here.
 * @param sourceBlocks - the blocks being duplicated
 */
const withoutSelfCopiedChildren = (sourceBlocks: Block[]): Block[] => {
  const sourceById = new Map(sourceBlocks.map(block => [block.id, block]));
  const underSelfCopyingParent = (block: Block, seen: Set<string>): boolean => {
    const parent = block.parentId === null ? undefined : sourceById.get(block.parentId);

    if (parent === undefined || seen.has(parent.id)) {
      return false;
    }

    return parent.tool?.copiesOwnChildren || underSelfCopyingParent(parent, seen.add(parent.id));
  };

  return sourceBlocks.filter(block => !underSelfCopyingParent(block, new Set()));
};

/**
 * The block to insert for a `copyAsLink` block, null when there is no hook,
 * or false when its hook has no valid link and the owner must not be copied.
 */
export type CopyAsLinkResolver = (toolName: string, data: Record<string, unknown>) => { tool: string; data: Record<string, unknown> } | null | false;

export class DragOperations {
  private blockManager: BlockManagerAdapter;
  private yjsManager?: YjsManagerAdapter;
  private blockSelection?: BlockSelectionAdapter;
  private asLink?: CopyAsLinkResolver;

  constructor(
    blockManager: BlockManagerAdapter,
    yjsManager?: YjsManagerAdapter,
    blockSelection?: BlockSelectionAdapter,
    asLink?: CopyAsLinkResolver
  ) {
    this.blockManager = blockManager;
    this.yjsManager = yjsManager;
    this.blockSelection = blockSelection;
    this.asLink = asLink;
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
    const hasStaleParticipant =
      this.blockManager.getBlockIndex(targetBlock) === -1
      || sourceBlocks.some(block => this.blockManager.getBlockIndex(block) === -1);

    if (hasStaleParticipant) {
      return { movedBlocks: [], targetIndex: -1 };
    }

    const destination = resolveMoveDestination(
      this.blockManager.blocks,
      sourceBlocks,
      targetBlock,
      edge
    );

    if (destination === null) {
      return { movedBlocks: [], targetIndex: -1 };
    }

    return this.applyMoveDestination(sourceBlocks, targetBlock, edge, destination);
  }

  /**
   * Async phase of alt-drag duplicate. Runs all `block.save()` awaits and both
   * stale-reference guards (Layer 11 pre-save + Layer 12 post-save), then
   * returns a fully-computed plan. The returned plan is consumed by the
   * synchronous {@link applyDuplicates} — that split lets callers wrap the
   * Yjs-touching tail in a single `BlockManager.transactForTool` group so one
   * alt-drag collapses into one undo stack item.
   *
   * When either stale guard trips, returns `{ aborted: true, ... }`; callers
   * should skip `applyDuplicates` and report an empty result.
   */
  async prepareDuplicates(
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): Promise<DuplicatePreparation> {
    // Stale-reference guard (alt+drag variant of the wrong-block-dropped bug).
    // Same failure mode as moveBlocks, different splice: targetIndex === -1
    // produces baseInsertIndex -1 or 0, and Blocks.insert(-1, block) calls
    // Array.splice(-1, 0, block) — inserting the block BEFORE the LAST slot.
    // That silently diverges the flat array from the DOM, so the next move()
    // indexOf lookup points at the wrong slot and drops an unrelated block.
    // Abort cleanly instead of duplicating stale data at the wrong position.
    if (this.blockManager.getBlockIndex(targetBlock) === -1) {
      return {
        sortedBlocks: [],
        sourceIds: new Set(),
        validResults: [],
        baseInsertIndex: -1,
        aborted: true,
      };
    }

    const hasStaleSource = sourceBlocks.some(
      (block) => this.blockManager.getBlockIndex(block) === -1
    );

    if (hasStaleSource) {
      return {
        sortedBlocks: [],
        sourceIds: new Set(),
        validResults: [],
        baseInsertIndex: -1,
        aborted: true,
      };
    }

    // Sort blocks by current index to preserve order
    const sortedBlocks = withoutSelfCopiedChildren(sourceBlocks).sort((a, b) =>
      this.blockManager.getBlockIndex(a) - this.blockManager.getBlockIndex(b)
    );

    // Save all blocks concurrently and filter out failures
    const saveResults = await Promise.all(
      sortedBlocks.map(async (block) => {
        const saved = await block.save();

        if (!saved) {
          return null;
        }

        const link = this.asLink?.(block.name, saved.data);

        if (link === false) {
          return null;
        }

        return link ? { saved, toolName: block.name, link } : { saved, toolName: block.name };
      })
    );

    // Post-save staleness guard (Layer 12).
    //
    // `block.save()` is async — during those awaits, the blocks array can mutate
    // via a Yjs remote update, undo/redo, or a tool-conversion callback. The
    // pre-save guard above only proves the target was alive when we began; by
    // the time Promise.all resolves, the target may be gone or at a different
    // index.
    //
    // Using a pre-save `baseInsertIndex` against a mutated array would:
    //   - insert at a stale absolute slot → divergence between flat array and DOM
    //   - if target was destroyed: `getBlockIndex === -1` → `splice(-1, 0, block)`
    //     inserts BEFORE the last element, same wrong-block-dropped mode as move.
    //
    // Always recompute from the live index after the save awaits resolve.
    const liveTargetIndex = this.blockManager.getBlockIndex(targetBlock);

    if (liveTargetIndex === -1) {
      return {
        sortedBlocks: [],
        sourceIds: new Set(),
        validResults: [],
        baseInsertIndex: -1,
        aborted: true,
      };
    }

    const baseInsertIndex = edge === 'top' ? liveTargetIndex : liveTargetIndex + 1;

    const validResults = saveResults.filter(
      (result): result is NonNullable<typeof result> => result !== null
    );
    const copyableBlocks = sortedBlocks.filter((_, index) => saveResults[index] !== null);

    return {
      sortedBlocks: copyableBlocks,
      sourceIds: new Set(copyableBlocks.map((block) => block.id)),
      validResults,
      baseInsertIndex,
      aborted: false,
    };
  }

  /**
   * Sync phase of alt-drag duplicate. Performs the inserts and re-establishes
   * internal parent-child relationships among the duplicated set. Every Yjs
   * write this method emits must stay synchronous so the caller can bracket
   * the whole thing in `BlockManager.transactForTool` for a single undo entry.
   */
  applyDuplicates(
    prep: DuplicatePreparation,
    rootParentOf: (original: Block) => string | null = (original) => original.parentId
  ): DuplicateResult {
    if (prep.aborted) {
      return { duplicatedBlocks: [], targetIndex: prep.baseInsertIndex };
    }

    if (prep.validResults.length === 0) {
      return { duplicatedBlocks: [], targetIndex: prep.baseInsertIndex };
    }

    // Insert duplicated blocks.
    //
    // Deep-clone `saved.data` and `saved.tunes` so the duplicate does not share
    // nested structures with the source. Tools like `table` return arrays from
    // their internal state straight out of `save()`, so a shallow pass would
    // leave the duplicate and the original mutating each other's `content`
    // until the next save cycle — a silent data-corruption class of bug in the
    // same family as the nested-container ejection regressions.
    //
    // A copy whose children are copied with it is inserted as 'paste' (it brings
    // its own children), so a container like callout does not seed a body.
    const copiedParentIds = new Set(prep.sortedBlocks.map(block => block.parentId));
    // A block the resolver maps is inserted as what it returned. One insert per
    // result either way: callers pair duplicatedBlocks with sortedBlocks by index.
    const duplicatedBlocks = prep.validResults.map(({ saved, toolName, link }, index) => {
      const data = link?.data ?? structuredClone(saved.data);
      const text = data.text;

      if (link === undefined && typeof text === 'string' && text.includes(PAGE_REFERENCE_ATTR)) {
        const wrapper = parseUntrustedHtml(text);
        const changed = Array.from(wrapper.querySelectorAll(`a[${PAGE_REFERENCE_ATTR}]`)).reduce((found, anchor) => {
          const allowed = preservePageReferenceAnchor(anchor);

          if (typeof allowed !== 'object' || allowed[PAGE_REFERENCE_ATTR] !== true) {
            return found;
          }

          for (const name of anchor.getAttributeNames()) {
            if (allowed[name] !== true) {
              anchor.removeAttribute(name);
            }
          }

          return true;
        }, false);

        if (changed) {
          // Painted labels and URLs must not enter the copied document.
          data.text = wrapper.innerHTML;
        }
      }

      return this.blockManager.insert({
        tool: link?.tool ?? toolName,
        data,
        tunes: link === undefined ? structuredClone(saved.tunes) : {},
        ...this.duplicatePosition(prep, index, rootParentOf),
        needToFocus: false,
        origin: copiedParentIds.has(prep.sortedBlocks[index].id) ? 'paste' : undefined,
      });
    });

    // Re-establish internal parent-child relationships among duplicated blocks.
    // Build a map: original block id → duplicated block id, so children whose
    // original parent is also being duplicated can be reparented to their
    // corresponding duplicate parent rather than inheriting the drop context.
    if (this.blockManager.setBlockParent !== undefined) {
      const originalIdToDupId = new Map<string, string>();

      prep.sortedBlocks.forEach((originalBlock, i) => {
        originalIdToDupId.set(originalBlock.id, duplicatedBlocks[i].id);
      });

      prep.sortedBlocks.forEach((originalBlock, i) => {
        const originalParentId = originalBlock.parentId;

        // Only reparent if the original parent is also part of the duplicated set
        if (originalParentId !== null && prep.sourceIds.has(originalParentId)) {
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

    return { duplicatedBlocks, targetIndex: prep.baseInsertIndex };
  }

  /**
   * Where the copy of `prep.sortedBlocks[index]` goes. Copied roots go by
   * placement (an index after a table would land in a cell); descendants and
   * table/database children keep the flat index.
   * @param prep - the duplicate plan
   * @param index - position of the copy in the plan
   * @param rootParentOf - the parent a copied root takes
   */
  private duplicatePosition(
    prep: DuplicatePreparation,
    index: number,
    rootParentOf: (original: Block) => string | null
  ): { index: number } | { placement: TreePlacement } {
    const slot = prep.baseInsertIndex + index;
    const original = prep.sortedBlocks[index];

    if (original === undefined || (original.parentId !== null && prep.sourceIds.has(original.parentId))) {
      return { index: slot };
    }

    const parentId = rootParentOf(original);
    const getBlock = (id: string): Block | undefined => this.blockManager.getBlockById?.(id);
    const parent = parentId === null ? undefined : getBlock(parentId);

    if (parentId !== null && (parent === undefined || isSelfPlacedParent(parent, getBlock))) {
      return { index: slot };
    }

    // The last sibling before the slot: the copy lands after its subtree, which is the slot.
    const afterId = this.blockManager.blocks.slice(0, slot).filter(block => block.parentId === parentId).pop()?.id ?? null;

    return { placement: { parentId, afterId } };
  }

  /**
   * Duplicates blocks at a new position.
   *
   * Thin compatibility wrapper around {@link prepareDuplicates} and
   * {@link applyDuplicates} — new call sites (notably `DragController.handleDuplicate`)
   * should call those directly so the sync tail can be wrapped in
   * `BlockManager.transactForTool` for single-undo semantics.
   */
  async duplicateBlocks(
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ): Promise<DuplicateResult> {
    const prep = await this.prepareDuplicates(sourceBlocks, targetBlock, edge);

    return this.applyDuplicates(prep);
  }

  /**
   * Applies a precomputed move by anchoring every source root to the live
   * target. Re-reading the target index after each move is what keeps
   * non-contiguous selections and variable-width nested subtrees ordered.
   */
  private applyMoveDestination(
    sourceBlocks: Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom',
    destination: MoveDestination
  ): MoveResult {
    const sortedBlocks = [...new Set(sourceBlocks)].sort(
      (left, right) =>
        this.blockManager.getBlockIndex(left) - this.blockManager.getBlockIndex(right)
    );
    const originalIndices = new Map(
      sortedBlocks.map(block => [
        block,
        this.blockManager.getBlockIndex(block),
      ])
    );
    const rootsInMoveOrder = edge === 'top'
      ? destination.sourceRoots
      : [...destination.sourceRoots].reverse();
    const alreadySettled = destination.footprint.every(
      (block, offset) =>
        this.blockManager.blocks[destination.finalFirstIndex + offset] === block
    );
    const isGroupMove = sortedBlocks.length > 1;

    if (!alreadySettled) {
      rootsInMoveOrder.forEach(block => {
        const fromIndex = this.blockManager.getBlockIndex(block);
        const liveTargetIndex = this.blockManager.getBlockIndex(targetBlock);
        const rawInsertionIndex = liveTargetIndex + (edge === 'bottom' ? 1 : 0);
        const toIndex = fromIndex < rawInsertionIndex
          ? rawInsertionIndex - 1
          : rawInsertionIndex;

        if (fromIndex !== toIndex) {
          if (isGroupMove) {
            this.blockManager.move(toIndex, fromIndex, false, true);
          } else {
            this.blockManager.move(toIndex, fromIndex, false);
          }
        }
      });
    }

    if (isGroupMove || alreadySettled) {
      sortedBlocks.forEach(block => {
        block.call(BlockToolAPI.MOVED, {
          fromIndex: originalIndices.get(block) ?? 0,
          toIndex: this.blockManager.getBlockIndex(block),
          ...(isGroupMove ? { isGroupMove: true } : {}),
        });
      });
    }

    if (this.blockSelection) {
      if (isGroupMove) {
        this.blockSelection.clearSelection();
      }

      sortedBlocks.forEach(block => {
        this.blockSelection?.selectBlock(block);
      });
    }

    const firstRoot = destination.sourceRoots[0];
    const finalFirstIndex = firstRoot === undefined
      ? -1
      : this.blockManager.getBlockIndex(firstRoot);

    return { movedBlocks: sortedBlocks, targetIndex: finalFirstIndex };
  }
}
