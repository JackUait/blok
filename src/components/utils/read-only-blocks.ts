import type { Block } from '../block';

type Lookup = (id: string) => Block | undefined;

/**
 * Whether a block acts read-only because it, or any block above it, says so
 * through BlockTool.isReadOnly. Only user gestures and agent writes ask this:
 * tools write their own blocks through api.blocks, so core writes stay open.
 * @param block - the block to check
 * @param getById - looks up a parent by id
 * @param seen - ids already walked, so a broken parent cycle ends
 */
export const isBlockReadOnly = (block: Block | undefined, getById: Lookup, seen = new Set<string>()): boolean => {
  if (block === undefined || seen.has(block.id)) {
    return false;
  }
  seen.add(block.id);

  return block.toolReadOnly || (typeof block.parentId === 'string' && isBlockReadOnly(getById(block.parentId), getById, seen));
};

const holdsReadOnly = (block: Block | undefined, getById: Lookup, seen: Set<string>): boolean =>
  (block?.contentIds ?? []).some((id) => {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    const child = getById(id);

    return child !== undefined && (child.toolReadOnly || holdsReadOnly(child, getById, seen));
  });

/**
 * Whether deleting a block would take a read-only block with it: the block
 * itself, a block above it, or any block below it.
 * @param block - the block to delete
 * @param getById - looks up a block by id
 */
export const removalTouchesReadOnly = (block: Block | undefined, getById: Lookup): boolean =>
  isBlockReadOnly(block, getById) || holdsReadOnly(block, getById, new Set());
