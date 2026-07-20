import type { OutputBlockData } from '../../../types';

/**
 * Deep-clone caller-provided document blocks at the editor's public
 * boundaries (constructor `data`, `blocks.render()`), so the editor never
 * mutates or retains caller-owned objects — host apps pass data straight from
 * their state stores, where it may be deep-frozen (Redux/Immer).
 *
 * Block data is JSON-serializable by contract; a block that still fails
 * structuredClone (e.g. carries a function) falls back to a shallow copy with
 * a copied `content` array, which at least detaches the references the editor
 * mutates in place.
 * @param blocks - caller-owned blocks array
 */
export function cloneOutputBlocks(blocks: OutputBlockData[]): OutputBlockData[] {
  return blocks.map((block) => {
    try {
      return structuredClone(block);
    } catch {
      return {
        ...block,
        content: Array.isArray(block.content) ? [ ...block.content ] : block.content,
      };
    }
  });
}
