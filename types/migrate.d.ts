/**
 * Public type surface for the `@bloklabs/core/migrate` entry.
 *
 * Hand-authored and self-contained per the published-types-no-src law: it may
 * reference other files under `types/` but never anything under `src/`.
 */
import { OutputBlockData, OutputData } from './data-formats/output-data';
import { BlockToolData } from './tools/block-tool-data';

/**
 * A single "old data shape → new data shape" rule for one block type.
 *
 * Must be a pure function of `data`: return the upgraded data, or the input
 * unchanged (or `undefined`) when it is already current — so it stays safe to
 * run on every load and idempotent across repeated runs. Unlike a Tool's
 * `upgradeData`, this rule lives OUTSIDE the tool class, so a host can migrate a
 * third-party tool it doesn't own, or its own tool without editing the class.
 * @param data - the stored block data (any shape ever written for this type)
 * @returns the data in the current shape (or the input when already current)
 */
export type BlockMigration = (data: BlockToolData) => BlockToolData | undefined | null;

/**
 * A map of block-type name → migration rule, keyed by the block `type` (tool
 * name). Supply it via editor config (`migrations`) to apply at load, or pass
 * it to {@link migrateBlocks} / {@link migrateOutputData} for a batch upgrade.
 */
export type BlockMigrations = Record<string, BlockMigration>;

/**
 * Apply host-supplied migrations across a block array, matching each block by
 * its `type`. Blocks with no matching rule pass through unchanged; envelope
 * fields (`id`, `type`, `tunes`, …) are preserved. A rule that throws is caught
 * and that block keeps its stored data.
 * @param blocks - blocks in Blok's output shape
 * @param migrations - the host's per-type migration map
 * @returns the blocks with migrated `data`
 */
export declare function migrateBlocks(blocks: OutputBlockData[], migrations: BlockMigrations): OutputBlockData[];

/**
 * Apply host-supplied migrations to a full OutputData envelope, preserving
 * `time`/`version` and replacing `blocks` with their migrated form — e.g. a
 * one-off batch upgrade of persisted records, without opening an editor.
 * @param data - a stored OutputData document
 * @param migrations - the host's per-type migration map
 * @returns the document with migrated blocks
 */
export declare function migrateOutputData(data: OutputData, migrations: BlockMigrations): OutputData;

/**
 * Migrate legacy / Editor.js-style blocks into Blok's hierarchical
 * flat-with-references format.
 *
 * Legacy nested shapes (list items, toggle/callout children, …) are expanded
 * into separate blocks linked by `parentId`/`content`, and blocks lacking an
 * `id` are stamped with one. Already-hierarchical blocks pass through
 * structurally unchanged, so calling this on current data (or twice) is safe.
 * @param blocks - blocks in any supported legacy or current shape
 * @returns blocks in Blok's hierarchical format
 */
export declare function migrateLegacyBlocks(blocks: OutputBlockData[]): OutputBlockData[];

/**
 * Migrate a full OutputData envelope, preserving `time`/`version` and replacing
 * `blocks` with their migrated form. Convenience wrapper around
 * {@link migrateLegacyBlocks} for consumers holding a saved document.
 * @param data - a stored OutputData document
 * @returns the document with migrated blocks
 */
export declare function migrateLegacyOutputData(data: OutputData): OutputData;

/**
 * Report whether a block array contains any legacy shape (a non-hierarchical
 * block or legacy nesting) that {@link migrateLegacyBlocks} would rewrite. Lets
 * consumers skip the migration pass — and its id-minting — when a document is
 * already current.
 * @param blocks - blocks to inspect
 * @returns true if migration would change the structure
 */
export declare function needsLegacyMigration(blocks: OutputBlockData[]): boolean;
