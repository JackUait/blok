/**
 * ListDepthValidator - Handles depth validation and hierarchy rules for list items.
 *
 * This class extracts the depth validation logic from ListItem,
 * making it testable in isolation without DOM rendering.
 */

import { TOOL_NAME, INDENT_PER_LEVEL } from './constants';
import type { BlocksAPI } from './marker-calculator';

/**
 * Depth validation options
 */
export interface DepthValidationOptions {
  /** Current block index */
  blockIndex: number;
  /** Current depth */
  currentDepth: number;
  /**
   * When true, skip depth-promotion heuristics (shouldMatchNext/Prev).
   * Used during group drag-drops where the group's relative structure is preserved.
   */
  skipDepthPromotion?: boolean;
}

/**
 * The neighbour context around a drop slot, already reduced to depths + flags.
 */
export interface DepthResolutionContext {
  /** The dragged item's current depth. */
  currentDepth: number;
  /** Whether the block immediately BEFORE the slot is a nesting context (a list item; for non-list drag sources, any indented block). */
  previousIsListItem: boolean;
  /** That previous block's depth (0 when it is not a nesting context). */
  previousDepth: number;
  /** Whether the block immediately AFTER the slot is a nesting context. */
  nextIsListItem: boolean;
  /** That next block's depth (0 when it is not a nesting context). */
  nextDepth: number;
  /** Skip the match-next / match-previous promotions (group moves preserve relative structure). */
  skipDepthPromotion?: boolean;
  /**
   * The raw discrete indent step the user's cursor sits at, derived from its
   * horizontal position at the drop gap (see {@link selectPointerDepth}). It
   * takes over from the auto-promotion heuristics — clamped to
   * `[0, previousDepth + 1]` — ONLY when (a) a real nesting-context predecessor
   * exists and (b) the cursor is inside the indent-selection band near the
   * content's left edge (no deeper than {@link POINTER_ENGAGE_SLACK} steps past
   * the deepest legal indent). A cursor far to the right — e.g. released over the
   * block's text during a plain vertical reorder — is NOT an indent gesture and
   * falls through to auto-resolution, so ordinary drops keep their existing
   * depth. `undefined` (no cursor info, e.g. unit tests / the parity guard)
   * leaves auto-resolution untouched.
   */
  pointerDepth?: number;
}

/**
 * How many indent steps PAST the deepest legal indent the cursor may sit and
 * still count as a deliberate indent gesture. Beyond this the cursor is treated
 * as "released to the right over the content" (a plain vertical reorder), and
 * the depth falls back to neighbour-based auto-resolution. Keeps the horizontal
 * indent control scoped to the narrow zone near the content's left edge.
 */
export const POINTER_ENGAGE_SLACK = 1;

/**
 * Maps a cursor X position to a discrete indent step. The drop gap's depth-0
 * anchor is `baseLeft` (the editor content's left edge); every `indentPerLevel`
 * pixels to the right is one deeper level. Negative offsets (cursor left of the
 * anchor, e.g. still over the drag-handle gutter) clamp to 0, so a plain
 * vertical drag defaults to root and the user must deliberately move right to
 * nest. The upper bound is applied later by {@link resolveTargetDepth} (it needs
 * the neighbour context), so this only floors at 0.
 *
 * @param clientX - cursor X position (viewport px)
 * @param baseLeft - X of the depth-0 anchor (editor content left edge)
 * @param indentPerLevel - px per indent level
 * @returns the snapped indent step (0 or greater)
 */
export const selectPointerDepth = (clientX: number, baseLeft: number, indentPerLevel: number): number => {
  if (indentPerLevel <= 0) {
    return 0;
  }

  return Math.max(0, Math.round((clientX - baseLeft) / indentPerLevel));
};

/**
 * THE single source of truth for "what depth does a block land at when dropped
 * into this slot". Pure, DOM-free, shared by BOTH the list tool's move hook
 * ({@link ListDepthValidator.getTargetDepthForMove}) and the drag drop-indicator
 * ({@link DropTargetDetector.calculateTargetDepth}).
 *
 * Keeping this in ONE place is a hard guarantee, not a convenience: the indicator
 * preview and the actual drop are computed by the same code, so the indicator can
 * never predict a depth different from the one the drop applies. (This rule used
 * to be hand-mirrored in two functions that silently drifted, which is exactly
 * how "nest from the bottom" and the paragraph-before-list mismatch happened.)
 *
 * Rules (the cursor-driven override in {@link DepthResolutionContext.pointerDepth}
 * takes precedence over 2–4 when engaged; otherwise these neighbour-based rules
 * apply):
 * 1. Cap at `maxAllowed = previousIsListItem ? previousDepth + 1 : 1`. A non-list
 *    (or absent) predecessor still allows ONE level — a list may begin nested,
 *    matching {@link ListDepthValidator.getMaxAllowedDepth}'s first-in-group rule.
 * 2. Group moves keep their own relative depth (no promotion).
 * 3. Promote to a DEEPER next item (become its sibling), else
 * 4. Append into a DEEPER previous item's sub-list ("nest from the bottom"); a
 *    shallower/absent next item must not pull the drop back to root.
 */
export const resolveTargetDepth = (context: DepthResolutionContext): number => {
  const { currentDepth, previousIsListItem, previousDepth, nextIsListItem, nextDepth, skipDepthPromotion, pointerDepth } = context;

  const maxAllowedDepth = previousIsListItem ? previousDepth + 1 : 1;

  // Cursor-driven nesting (Notion's horizontal drag-to-indent). The cursor's raw
  // indent step wins over the auto heuristics — clamped to [0, previousDepth + 1]
  // — but only when:
  //   1. there is a real nesting-context predecessor to nest under (without one
  //      there is no legal parent, so "drag right" must NOT nest a paragraph
  //      under a plain paragraph), and
  //   2. the cursor is inside the indent-selection band: no deeper than
  //      POINTER_ENGAGE_SLACK steps past the deepest legal indent. A cursor far
  //      to the right (released over the block's text — exactly what a plain
  //      vertical reorder does) is not an indent gesture and falls through to
  //      auto-resolution, so ordinary drops keep their existing depth.
  // `pointerDepth === undefined` leaves every existing path (and the
  // indicator/drop parity guard) byte-for-byte unchanged.
  if (
    pointerDepth !== undefined &&
    previousIsListItem &&
    pointerDepth <= maxAllowedDepth + POINTER_ENGAGE_SLACK
  ) {
    return Math.max(0, Math.min(pointerDepth, maxAllowedDepth));
  }

  if (currentDepth > maxAllowedDepth) {
    return maxAllowedDepth;
  }

  if (skipDepthPromotion) {
    return currentDepth;
  }

  // Match a deeper next item, becoming its sibling — prevents inserting a
  // shallower item that would break the following nested structure.
  if (nextIsListItem && nextDepth > currentDepth && nextDepth <= maxAllowedDepth) {
    return nextDepth;
  }

  // Otherwise append into a deeper previous item's sub-list. A shallower (or
  // absent) next item does NOT pull the drop back to root — prev(1), dropped(1),
  // next(0) is valid ("nest from the bottom"). A deeper next item was handled
  // just above.
  if (previousIsListItem && previousDepth > currentDepth && previousDepth <= maxAllowedDepth && nextDepth <= previousDepth) {
    return previousDepth;
  }

  return currentDepth;
};

/**
 * Validates and adjusts depth values for list items.
 * Pure functions that read from the BlocksAPI but don't mutate state.
 */
export class ListDepthValidator {
  constructor(private blocks: BlocksAPI) {}

  /**
   * Calculate the maximum allowed depth at a given block index.
   *
   * Rules:
   * 1. First-in-group items (index 0 or previous block is not a list) are uncapped
   * 2. For other items: maxDepth = previousListItem.depth + 1
   *
   * @param blockIndex - The index of the block
   * @returns The maximum allowed depth (0 or more, or Infinity for first-in-group)
   */
  getMaxAllowedDepth(blockIndex: number): number {
    if (blockIndex === 0) {
      return 1;
    }

    const previousBlock = this.blocks.getBlockByIndex(blockIndex - 1);

    if (!previousBlock || previousBlock.name !== TOOL_NAME) {
      return 1;
    }

    // Max depth is previous item's depth + 1
    const previousBlockDepth = this.getBlockDepth(previousBlock);

    return previousBlockDepth + 1;
  }

  /**
   * Calculate the target depth for a list item dropped at the given index.
   * When dropping into a nested context, the item should match the sibling's depth.
   *
   * @param options - Depth validation options
   * @returns The target depth for the dropped item
   */
  getTargetDepthForMove(options: DepthValidationOptions): number {
    const { blockIndex, currentDepth, skipDepthPromotion } = options;

    // Read the neighbour context from the DOM, then defer the actual decision to
    // the shared resolveTargetDepth — the SAME function the drag indicator uses,
    // so the preview can never diverge from this (the applied) result.
    const previousBlock = blockIndex > 0 ? this.blocks.getBlockByIndex(blockIndex - 1) : undefined;
    const previousIsListItem = !!previousBlock && previousBlock.name === TOOL_NAME;
    const previousDepth = previousIsListItem ? this.getBlockDepth(previousBlock) : 0;

    const nextBlock = this.blocks.getBlockByIndex(blockIndex + 1);
    const nextIsListItem = !!nextBlock && nextBlock.name === TOOL_NAME;
    const nextDepth = nextIsListItem ? this.getBlockDepth(nextBlock) : 0;

    return resolveTargetDepth({
      currentDepth,
      previousIsListItem,
      previousDepth,
      nextIsListItem,
      nextDepth,
      skipDepthPromotion,
    });
  }

  /**
   * Validate if a depth is valid at the given position.
   *
   * @param blockIndex - The index of the block
   * @param depth - The depth to validate
   * @returns true if the depth is valid, false otherwise
   */
  isValidDepth(blockIndex: number, depth: number): boolean {
    const maxAllowedDepth = this.getMaxAllowedDepth(blockIndex);
    return depth >= 0 && depth <= maxAllowedDepth;
  }

  /**
   * Get the depth of a block by reading from its DOM.
   */
  getBlockDepth(block: ReturnType<BlocksAPI['getBlockByIndex']>): number {
    if (!block) {
      return 0;
    }

    const styleAttr = block.holder?.querySelector('[role="listitem"]')?.getAttribute('style');
    const marginMatch = styleAttr?.match(/margin-left:\s*(\d+)px/);
    return marginMatch ? Math.round(parseInt(marginMatch[1], 10) / INDENT_PER_LEVEL) : 0;
  }
}
