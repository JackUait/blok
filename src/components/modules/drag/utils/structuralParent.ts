/**
 * THE single source of truth for "which block becomes the structural parent when
 * something is dropped at visual depth N".
 *
 * Shared by BOTH sides of a drag so they cannot drift:
 *   - the DROP applies it (DragController.applyStructuralDropDepth → setBlockParent)
 *   - the INDICATOR clamps to it (DropTargetDetector.calculateTargetDepth), so a
 *     depth that has no legal parent is never previewed as an indent.
 *
 * Keeping the rule in one place is the fix for the class of bug where the blue
 * drop line tucked itself one indent step in — promising a nesting the drop then
 * refused, silently landing the block at root.
 */

/** A preceding block considered as a nesting parent, reduced to what the rule needs. */
export interface StructuralParentCandidate {
  id: string;
  /** Whether the candidate is a list item — the only universally legal parent. */
  isList: boolean;
  /** Structural depth (length of the parentId chain); root blocks are 0. */
  depth: number;
}

/**
 * Resolves the structural parent for a block dropped at `dropDepth`.
 *
 * Legal-parent rule (Notion parity): a list item may nest under ANY preceding
 * block (a bullet nests under a preceding paragraph too); every OTHER block may
 * nest only under a preceding LIST item — never under a plain paragraph or a
 * (closed) toggle.
 *
 * @param movedIsList - whether the dropped block is a list item
 * @param dropDepth - the visual depth the drop indicator showed
 * @param preceding - blocks before the drop slot, NEAREST FIRST, moving group excluded
 * @returns the parent's id, or null for a root-level drop
 */
export const resolveStructuralParent = (
  movedIsList: boolean,
  dropDepth: number,
  preceding: StructuralParentCandidate[]
): string | null => {
  if (dropDepth <= 0) {
    return null;
  }

  for (const candidate of preceding) {
    const isValidParent = movedIsList || candidate.isList;

    if (candidate.depth === dropDepth - 1) {
      // Candidate sits exactly at the target parent depth: nest under it only
      // when it is a legal parent, otherwise bail to root (never nest a
      // non-list block under a plain paragraph or a closed toggle).
      return isValidParent ? candidate.id : null;
    }

    // No ancestor at the exact target depth. A non-list block clamps onto the
    // nearest shallower LIST item — flat list carriers are all structural
    // depth 0, so this is the deepest reachable parent and matches the
    // "nest from the bottom" preview. A list block (or a non-list block whose
    // nearest predecessor is not a list) bails to root rather than over-nesting.
    if (candidate.depth < dropDepth - 1) {
      return !movedIsList && candidate.isList ? candidate.id : null;
    }
  }

  return null;
};

/**
 * The deepest depth at or below `desiredDepth` that {@link resolveStructuralParent}
 * can actually give a parent for. Used by the drop indicator so it only ever
 * previews an indent the drop will honour; 0 when no depth is reachable.
 *
 * @param movedIsList - whether the dragged block is a list item
 * @param desiredDepth - the depth the cursor/neighbours resolved to
 * @param preceding - blocks before the drop slot, NEAREST FIRST, moving group excluded
 * @returns the deepest attainable depth (0 for root)
 */
export const deepestLegalStructuralDepth = (
  movedIsList: boolean,
  desiredDepth: number,
  preceding: StructuralParentCandidate[]
): number => {
  for (let depth = desiredDepth; depth > 0; depth--) {
    if (resolveStructuralParent(movedIsList, depth, preceding) !== null) {
      return depth;
    }
  }

  return 0;
};
