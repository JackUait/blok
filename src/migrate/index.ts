/**
 * Public data-migration entry (`@bloklabs/core/migrate`).
 *
 * Promotes Blok's internal legacy→hierarchical expansion — the same transform
 * the renderer runs automatically at load — so consumers can migrate a stored
 * document explicitly (e.g. a one-off batch upgrade of persisted records, or a
 * pre-load normalization step) instead of hand-rolling per-tool shape
 * conversion. The heavy lifting lives in ONE zero-dep grammar module shared
 * verbatim with the standalone codemod, so this surface cannot drift from the
 * runtime auto-migration.
 */
import type { OutputBlockData, OutputData } from '../../types';
import { expandToHierarchical } from '../components/utils/data-model-transform';
import { analyzeLegacyFormat } from '../components/migration/legacy-grammar.mjs';

/**
 * Host-supplied per-type block migrations. Lets a host declare "old data shape →
 * new data shape" rules for ANY block type from the outside — the same rules the
 * editor accepts via `config.migrations`, usable here for offline batch upgrades.
 */
export {
  migrateBlocks,
  migrateOutputData,
} from '../components/migration/block-migrations';
export type {
  BlockMigration,
  BlockMigrations,
} from '../components/migration/block-migrations';

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
export const migrateLegacyBlocks = (blocks: OutputBlockData[]): OutputBlockData[] => {
  return expandToHierarchical(blocks);
};

/**
 * Migrate a full {@link OutputData} envelope, preserving `time`/`version` and
 * replacing `blocks` with their migrated form. Convenience wrapper around
 * {@link migrateLegacyBlocks} for consumers holding a saved document.
 * @param data - a stored OutputData document
 * @returns the document with migrated blocks
 */
export const migrateLegacyOutputData = (data: OutputData): OutputData => {
  return {
    ...data,
    blocks: migrateLegacyBlocks(data.blocks),
  };
};

/**
 * Report whether a block array contains any legacy shape (a non-hierarchical
 * block or legacy nesting) that {@link migrateLegacyBlocks} would rewrite.
 * Lets consumers skip the migration pass — and its id-minting — when a document
 * is already current.
 * @param blocks - blocks to inspect
 * @returns true if migration would change the structure
 */
export const needsLegacyMigration = (blocks: OutputBlockData[]): boolean => {
  const analysis = analyzeLegacyFormat(blocks);

  return analysis.hasLegacyBlocks || analysis.hasNesting;
};
