import type { LooseOutputData, OutputBlockData, OutputData } from '../../types/data-formats/output-data';
import type { BlokBlockDataMap } from '../../types/tools-entry';

/**
 * Collects every saved block of a given type from a document, typing each
 * result's `data` via {@link BlokBlockDataMap} instead of
 * `Record<string, unknown>`. The null-tolerant, collection counterpart of
 * {@link isBlockType}: every feature otherwise re-does the same
 * `(data?.blocks ?? []).filter(b => b.type === t)` plus a `data as XData` cast.
 *
 * See the `blocksOfType` declaration in `types/tools-entry.d.ts` for the
 * type-level contract (it narrows off the augmentable registry, so custom tools
 * registered via declaration merging are typed too).
 * @param data - a saved document (e.g. from `editor.save()`); nullish tolerated
 * @param type - a registered block type (a {@link BlokBlockDataMap} key)
 */
export function blocksOfType<K extends keyof BlokBlockDataMap>(
  data: OutputData | LooseOutputData | null | undefined,
  type: K,
): Array<OutputBlockData<K, BlokBlockDataMap[K]>> {
  const blocks = data?.blocks ?? [];

  return blocks.filter(
    (block): block is OutputBlockData<K, BlokBlockDataMap[K]> => block.type === type,
  );
}
