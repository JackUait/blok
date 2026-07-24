/**
 * Public type surface for the `@bloklabs/core/migrate` entry.
 *
 * Hand-authored and self-contained per the published-types-no-src law: it may
 * reference other files under `types/` but never anything under `src/`.
 */
import { OutputBlockData, OutputData } from './data-formats/output-data';

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
