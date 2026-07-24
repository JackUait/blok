/**
 * Host-supplied per-type block migrations.
 *
 * `upgradeData` lets a Tool migrate its OWN legacy data shape, but only from
 * inside the Tool class. These helpers let a host declare "old data shape → new
 * data shape" rules for ANY block type from the OUTSIDE — a third-party tool
 * whose class they don't control, their own tool without re-shipping it, or a
 * tool registered dynamically at config time.
 *
 * One pure engine (`applyBlockMigration`) backs both the editor-config path
 * (applied at load in `factory.composeBlock`, after the Tool's own
 * `upgradeData`) and the standalone `@bloklabs/core/migrate` batch API, so the
 * two can never drift. It is intentionally DOM-free and dependency-free.
 */
import type { BlockToolData } from '../../../types/tools';
import type { OutputBlockData, OutputData } from '../../../types/data-formats/output-data';

/**
 * A single "old data shape → new data shape" rule for one block type. Must be a
 * pure function of `data`: return the upgraded data, or the input unchanged (or
 * `undefined`) when it is already current — so it stays safe to run on every
 * load and idempotent across repeated runs.
 */
export type BlockMigration = (data: BlockToolData) => BlockToolData | undefined | null;

/**
 * A map of block-type name → migration rule. The key is the block `type`
 * (the tool name), e.g. `{ myCard: (data) => ... }`.
 */
export type BlockMigrations = Record<string, BlockMigration>;

/**
 * Run the host-supplied migration for one block's `data`, if a rule exists for
 * its type.
 *
 * Absent rule → `data` returned as-is. A rule returning `null`/`undefined` is
 * treated as "no change" (the input is returned). A throwing rule never breaks
 * load: the original data is returned and the failure is surfaced via the
 * optional `onError` callback, so a bad migration degrades to "unmigrated"
 * rather than a blank editor.
 * @param type - the block type (tool name)
 * @param data - the stored block data
 * @param migrations - the host's per-type migration map
 * @param onError - optional failure reporter (the load path logs a warning)
 * @returns the migrated data (or the original on absence/no-op/error)
 */
export function applyBlockMigration(
  type: string,
  data: BlockToolData,
  migrations: BlockMigrations | undefined,
  onError?: (type: string, error: unknown) => void
): BlockToolData {
  const migrate = migrations?.[type];

  if (typeof migrate !== 'function') {
    return data;
  }

  try {
    const result = migrate(data);

    return result == null ? data : result;
  } catch (error) {
    onError?.(type, error);

    return data;
  }
}

/**
 * Apply host-supplied migrations across a block array, matching each block by
 * its `type`. Blocks with no matching rule pass through unchanged; envelope
 * fields (`id`, `type`, `tunes`, …) are preserved.
 * @param blocks - blocks in Blok's output shape
 * @param migrations - the host's per-type migration map
 * @returns the blocks with migrated `data`
 */
export function migrateBlocks(
  blocks: OutputBlockData[],
  migrations: BlockMigrations
): OutputBlockData[] {
  return blocks.map((block) => {
    const data = applyBlockMigration(block.type, block.data, migrations);

    return data === block.data ? block : { ...block, data };
  });
}

/**
 * Apply host-supplied migrations to a full {@link OutputData} envelope,
 * preserving `time`/`version` and replacing `blocks` with their migrated form.
 * Convenience wrapper around {@link migrateBlocks} for a stored document — e.g.
 * a one-off batch upgrade of persisted records, without opening an editor.
 * @param data - a stored OutputData document
 * @param migrations - the host's per-type migration map
 * @returns the document with migrated blocks
 */
export function migrateOutputData(
  data: OutputData,
  migrations: BlockMigrations
): OutputData {
  return {
    ...data,
    blocks: migrateBlocks(data.blocks, migrations),
  };
}
