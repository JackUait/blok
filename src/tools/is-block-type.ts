import type { OutputBlockData } from '../../types/data-formats/output-data';
import type { BlokBlockDataMap } from '../../types/tools-entry';

/**
 * Type guard narrowing a saved block to a known block type so its `data` is
 * typed via {@link BlokBlockDataMap}. See the `isBlockType` declaration in
 * `types/tools-entry.d.ts` for the type-level contract.
 *
 * Runtime is a single identity comparison; the value it adds is the type
 * narrowing that removes hand-written `data as XData` casts at read sites.
 */
export function isBlockType<K extends keyof BlokBlockDataMap>(
  block: OutputBlockData,
  type: K,
): block is OutputBlockData<K, BlokBlockDataMap[K]> {
  return block.type === type;
}
