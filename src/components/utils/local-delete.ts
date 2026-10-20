import type { Block } from '../block';

/** Blocks a local edit deleted (not undo/redo, a peer, clear or teardown). Read by `removed()`. */
const deletedLocally = new WeakSet<Block>();

/**
 * Marks a block as deleted by a local edit, before core removes it.
 * @param block - the block
 */
export const markDeletedLocally = (block: Block): void => {
  deletedLocally.add(block);
};

/**
 * @param block - the block
 * @returns whether a local edit deleted it
 */
export const isDeletedLocally = (block: Block): boolean => deletedLocally.has(block);
